import { supabaseCompanyId, supabaseRequest } from './supabase';
import { currentAccount } from './tenant-context';
import { isWhatsAppMediaPath, isWhatsAppAudioPath, readStoredWhatsAppImage } from './whatsapp-media';
import {deliveryError,type DeliveryStatus} from './message-delivery';
import {sendQueuedMessage} from './message-outbox';

export type ConversationAttendanceSummary = {
  leadId: string;
  attendanceMode: 'automatic' | 'human' | 'paused' | 'closed' | 'unknown';
  assignedTo: string | null;
  assignedBrokerId: string | null;
};

export type ConversationMessage = {
  id: string;
  createdAt?: string;
  leadId: string;
  side: 'incoming' | 'outgoing';
  text: string;
  time: string;
  images: string[];
  audios?: string[];
  deliveryStatus?: DeliveryStatus;
  deliveryError?: string;
  sender?: string;
  canRetry?:boolean;
  attempts?:number;
  nextAttemptAt?:string;
  attendanceMode?:ConversationAttendanceSummary['attendanceMode'];
  assignedBrokerId?:string|null;
};

export async function listConversationMessages(): Promise<ConversationMessage[]> {
  return (await listConversationData()).messages;
}

export async function listConversationData(input: { leadId?: string; before?: string } = {}): Promise<{ messages: ConversationMessage[]; attendance: ConversationAttendanceSummary[]; nextCursor: string | null }> {
  const companyId = supabaseCompanyId();
  if (input.leadId && !/^[0-9a-f-]{36}$/i.test(input.leadId)) throw new Error('invalid_conversation_page');
  let cursorFilter = '';
  if (input.before) {
    const [timestamp, id, ...extra] = input.before.split('|');
    if (!input.leadId || extra.length || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)) || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid_conversation_page');
    cursorFilter = `&or=${encodeURIComponent(`(created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id}))`)}`;
  }
  const conversations = await supabaseRequest<Record<string, unknown>[]>(
    `conversations?company_id=eq.${companyId}${input.leadId ? `&lead_id=eq.${input.leadId}` : ''}&select=id,lead_id,status,assigned_broker_id,assigned_to,bot_paused`, { allRows: true },
  );
  if (!conversations.length) return { messages: [], attendance: [], nextCursor: null };
  const leadByConversation = new Map(conversations.map((row) => [String(row.id), String(row.lead_id)]));
  const attendanceByConversation = new Map(conversations.map(row => [String(row.id), {
    leadId: String(row.lead_id),
    attendanceMode: row.status === 'closed' || row.status === 'Encerrada' ? 'closed'
      : !['open', 'Aberta'].includes(String(row.status)) ? 'unknown'
      : row.assigned_to ? 'human' : row.bot_paused ? 'paused' : 'automatic',
    assignedTo: typeof row.assigned_to === 'string' ? row.assigned_to : null,
    assignedBrokerId: typeof row.assigned_broker_id === 'string' ? row.assigned_broker_id : null,
  } satisfies ConversationAttendanceSummary]));
  const pageSize = input.leadId ? 50 : 200;
  const rows = await supabaseRequest<Record<string, unknown>[]>(
    `messages?company_id=eq.${companyId}${input.leadId ? `&conversation_id=in.(${conversations.map(row => String(row.id)).join(',')})` : ''}${cursorFilter}&select=*&order=created_at.desc,id.desc&limit=${pageSize + 1}`,
  );
  const page = rows.slice(0, pageSize);
  const oldest = page[page.length - 1];
  const nextCursor = rows.length > pageSize && oldest ? `${oldest.created_at}|${oldest.id}` : null;
  const messages = page.reverse();
  // Only enrich messages actually shown, never scan the company's delivery history.
  const externalIds = messages.map(row => row.external_message_id).filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9._=+/-]+$/.test(id));
  const readEvents = async () => {
    const result: Array<{external_message_id:string;status:DeliveryStatus;error_code:number|null}> = [];
    const ids = [...new Set(externalIds)];
    // Provider IDs may be long; keep each REST URL below common proxy limits.
    for (let offset = 0; offset < ids.length;) {
      const batch: string[] = [];
      let length = 0;
      while (offset < ids.length && length + encodeURIComponent(ids[offset]).length + 12 <= 5000) {
        length += encodeURIComponent(ids[offset]).length + 12;
        batch.push(ids[offset++]);
      }
      // Schema caps provider IDs at 500 characters, so a nonempty batch always fits.
      if (!batch.length) throw new Error('Identificador de mensagem inválido.');
      result.push(...await supabaseRequest<typeof result>(`message_delivery_events?company_id=eq.${companyId}&external_message_id=in.${encodeURIComponent(`(${batch.map(id => `"${id}"`).join(',')})`)}&select=external_message_id,status,error_code&limit=${batch.length * 4}`));
    }
    return result;
  };
  const [events, queue] = await Promise.all([
    readEvents(),
    messages.length ? supabaseRequest<Array<{id:string;state:string;attempts:number;next_attempt_at:string}>>(`message_outbox?company_id=eq.${companyId}&id=in.(${messages.map(row => String(row.id)).join(',')})&select=id,state,attempts,next_attempt_at`,{allRows:true}) : [],
  ]);
  const rank:Record<DeliveryStatus,number>={pending:0,sent:1,failed:2,delivered:3,read:4};
  const eventsById=new Map<string,typeof events[number]>();
  for(const event of events){const previous=eventsById.get(event.external_message_id);if(!previous||rank[event.status]>rank[previous.status])eventsById.set(event.external_message_id,event);}
  const jobsById=new Map(queue.map(job=>[job.id,job]));
  const mappedMessages = messages.map((row) => {
    const message=mapMessage(row,leadByConversation.get(String(row.conversation_id))||'');
    const attendance = attendanceByConversation.get(String(row.conversation_id));
    message.assignedBrokerId = attendance?.assignedBrokerId;
    message.attendanceMode = attendance?.attendanceMode;
    const event=eventsById.get(String(row.external_message_id));
    if(event) {message.deliveryStatus=event.status;message.deliveryError=event.status==='failed'?deliveryError(event.error_code):undefined;}
    const job=jobsById.get(message.id);if(job){message.attempts=job.attempts;message.nextAttemptAt=job.state==='pending'?job.next_attempt_at:undefined;message.canRetry=job.state==='pending'&&job.attempts>0&&job.attempts<3&&Date.parse(job.next_attempt_at)<=Date.now();}
    return message;
  });
  return { messages: mappedMessages, attendance: [...attendanceByConversation.values()], nextCursor };
}

export async function createConversationMessage(input: {
  leadId: string;
  content: string;
  images?: string[];
  propertyId?: string | null;
  requestId: string;
  templateName?: string;
}): Promise<ConversationMessage> {
  const companyId = supabaseCompanyId();
  const account = currentAccount();
  if (!account) throw new Error('Entre na sua conta para continuar.');
  const leads = await supabaseRequest<Array<{ id: string }>>(
    `leads?id=eq.${encodeURIComponent(input.leadId)}&company_id=eq.${companyId}&select=id&limit=1`,
  );
  if (!leads.length) throw new Error('Lead não encontrado nesta imobiliária.');
  let verifiedImages = input.images || [];
  if (input.propertyId) {
    const properties = await supabaseRequest<Array<{ id: string; status: string; images: unknown }>>(
      `properties?id=eq.${encodeURIComponent(input.propertyId)}&company_id=eq.${companyId}&select=id,status,images&limit=1`,
    );
    if (!properties.length) throw new Error('Imóvel não encontrado nesta imobiliária.');
    if (properties[0].status === 'Vendido' || properties[0].status === 'Alugado') {
      throw new Error('Este imóvel não está mais disponível para envio.');
    }
    verifiedImages = Array.isArray(properties[0].images)
      ? properties[0].images.filter((item): item is string => typeof item === 'string').slice(0, 5)
      : [];
  }
  const lookup = `conversations?company_id=eq.${companyId}&lead_id=eq.${encodeURIComponent(input.leadId)}&select=id&limit=1`;
  let conversations = await supabaseRequest<Array<{ id: string; assigned_broker_id?: string | null; assigned_to?: string | null }>>(lookup.replace('select=id', 'select=id,assigned_broker_id,assigned_to'));
  if (!conversations.length) {
    conversations = await supabaseRequest<Array<{ id: string; assigned_broker_id?: string | null; assigned_to?: string | null }>>('conversations', {
      method: 'POST', prefer: 'return=representation',
      body: { company_id: companyId, lead_id: input.leadId, channel: 'painel', external_conversation_id: `painel:${input.leadId}`, status: 'open', last_message_at: new Date().toISOString() },
    });
  }
  const conversationId = conversations[0].id;
  if (account.role === 'owner' && conversations[0].assigned_broker_id !== account.brokerId) {
    await supabaseRequest(
      `conversations?company_id=eq.${companyId}&id=eq.${conversationId}`,
      { method: 'PATCH', body: { assigned_broker_id: account.brokerId, assigned_to: account.name, bot_paused: true } },
    );
    await supabaseRequest(
      `leads?company_id=eq.${companyId}&id=eq.${encodeURIComponent(input.leadId)}`,
      { method: 'PATCH', body: { assigned_to: account.name } },
    );
  }
  const messageId=await supabaseRequest<string>('rpc/enqueue_conversation_message',{method:'POST',body:{p_company_id:companyId,p_conversation_id:conversationId,p_key:`human:${account.brokerId}:${input.requestId}`,p_content:input.content,p_broker_id:account.brokerId,p_template_name:input.templateName||null}});
  // Property links are sent in the text; local previews are not represented as delivered media.
  void verifiedImages;
  await sendQueuedMessage(companyId,messageId);
  const [message]=await supabaseRequest<Record<string,unknown>[]>(`messages?company_id=eq.${companyId}&id=eq.${messageId}&select=*&limit=1`);
  if (input.propertyId && message.delivery_status==='sent') {
    await supabaseRequest('lead_property_events', {
      method: 'POST',
      body: { company_id: companyId, lead_id: input.leadId, property_id: input.propertyId, event_type: 'Enviado' },
    });
  }
  return mapMessage(message, input.leadId);
}

export async function readConversationImage(messageId: string, index: number) {
  const companyId = supabaseCompanyId();
  if (!/^[0-9a-f-]{36}$/i.test(messageId) || !Number.isInteger(index) || index < 0 || index > 4) throw new Error('Foto inválida.');
  const messages = await supabaseRequest<Array<{ media_urls: unknown }>>(
    `messages?id=eq.${encodeURIComponent(messageId)}&company_id=eq.${companyId}&select=media_urls&limit=1`,
  );
  const path = Array.isArray(messages[0]?.media_urls) && typeof messages[0].media_urls[index] === 'string' ? messages[0].media_urls[index] : '';
  if (!isWhatsAppMediaPath(path, companyId)) throw new Error('Foto não encontrada.');
  return readStoredWhatsAppImage(path);
}

function mapMessage(row: Record<string, unknown>, leadId: string): ConversationMessage {
  const createdAt = new Date(String(row.created_at));
  return {
    id: String(row.id), leadId, createdAt: String(row.created_at),
    side: row.direction === 'incoming' || row.direction === 'Entrada' ? 'incoming' : 'outgoing',
    text: String(row.content || ''),
    sender: row.source_channel==='whatsapp_business'?'WhatsApp Business':row.sender_type==='client'?'Cliente':row.sender_type==='ai'?'Automático':'Corretor',
    deliveryStatus: row.direction==='outgoing' ? (row.delivery_status as DeliveryStatus || (row.external_message_id?'sent':'pending')) : undefined,
    deliveryError: row.delivery_status==='failed'?deliveryError(typeof row.delivery_error_code==='number'?row.delivery_error_code:null):undefined,
    time: createdAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
    images: mediaLinks(row, false),
    audios: mediaLinks(row, true),
  };
}

function mediaLinks(row: Record<string, unknown>, audio: boolean): string[] {
  if (!Array.isArray(row.media_urls)) return [];
  const companyId = String(row.company_id || '');
  return row.media_urls.flatMap((item: unknown, index: number) => {
    if (typeof item !== 'string' || isWhatsAppAudioPath(item, companyId) !== audio) return [];
    if (isWhatsAppMediaPath(item, companyId)) return [`/api/conversations/media?messageId=${encodeURIComponent(String(row.id))}&index=${index}`];
    // Never expose another tenant's private path as a public image URL.
    return !audio && item.startsWith('https://') ? [item] : [];
  });
}
