import { supabaseCompanyId, supabaseRequest } from './supabase';
import { currentAccount } from './tenant-context';
import { isWhatsAppMediaPath, readStoredWhatsAppImage } from './whatsapp-media';
import {deliveryError,type DeliveryStatus} from './message-delivery';
import {sendQueuedMessage} from './message-outbox';

export type ConversationMessage = {
  id: string;
  leadId: string;
  side: 'incoming' | 'outgoing';
  text: string;
  time: string;
  images: string[];
  deliveryStatus?: DeliveryStatus;
  deliveryError?: string;
  sender?: string;
  canRetry?:boolean;
  attempts?:number;
  nextAttemptAt?:string;
  attendanceMode?:'automatic'|'human'|'paused';
  assignedBrokerId?:string|null;
};

export async function listConversationMessages(): Promise<ConversationMessage[]> {
  const conversations = await supabaseRequest<Record<string, unknown>[]>(
    `conversations?company_id=eq.${supabaseCompanyId()}&select=id,lead_id,assigned_broker_id,assigned_to,bot_paused`, { allRows: true },
  );
  if (!conversations.length) return [];
  const leadByConversation = new Map(conversations.map((row) => [String(row.id), String(row.lead_id)]));
  const conversationById=new Map(conversations.map(row=>[String(row.id),row]));
  const messages = await supabaseRequest<Record<string, unknown>[]>(
    `messages?company_id=eq.${supabaseCompanyId()}&select=*&order=created_at.asc`, { allRows: true },
  );
  const events=await supabaseRequest<Array<{external_message_id:string;status:DeliveryStatus;error_code:number|null}>>(`message_delivery_events?company_id=eq.${supabaseCompanyId()}&select=external_message_id,status,error_code`,{allRows:true});
  const queue=await supabaseRequest<Array<{id:string;state:string;attempts:number;next_attempt_at:string}>>(`message_outbox?company_id=eq.${supabaseCompanyId()}&select=id,state,attempts,next_attempt_at`,{allRows:true});
  const rank:Record<DeliveryStatus,number>={pending:0,sent:1,failed:2,delivered:3,read:4};
  const eventsById=new Map<string,typeof events[number]>();
  for(const event of events){const previous=eventsById.get(event.external_message_id);if(!previous||rank[event.status]>rank[previous.status])eventsById.set(event.external_message_id,event);}
  const jobsById=new Map(queue.map(job=>[job.id,job]));
  return messages.map((row) => {
    const message=mapMessage(row,leadByConversation.get(String(row.conversation_id))||'');
    const conversation=conversationById.get(String(row.conversation_id));
    message.assignedBrokerId=typeof conversation?.assigned_broker_id==='string'?conversation.assigned_broker_id:null;
    message.attendanceMode=conversation?.assigned_to?'human':conversation?.bot_paused?'paused':'automatic';
    const event=eventsById.get(String(row.external_message_id));
    if(event) {message.deliveryStatus=event.status;message.deliveryError=event.status==='failed'?deliveryError(event.error_code):undefined;}
    const job=jobsById.get(message.id);if(job){message.attempts=job.attempts;message.nextAttemptAt=job.state==='pending'?job.next_attempt_at:undefined;message.canRetry=job.state==='pending'&&job.attempts>0&&job.attempts<3&&Date.parse(job.next_attempt_at)<=Date.now();}
    return message;
  });
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
  let conversations = await supabaseRequest<Array<{ id: string }>>(lookup);
  if (!conversations.length) {
    conversations = await supabaseRequest<Array<{ id: string }>>('conversations', {
      method: 'POST', prefer: 'return=representation',
      body: { company_id: companyId, lead_id: input.leadId, channel: 'painel', external_conversation_id: `painel:${input.leadId}`, status: 'open', last_message_at: new Date().toISOString() },
    });
  }
  const conversationId = conversations[0].id;
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
    id: String(row.id), leadId,
    side: row.direction === 'incoming' || row.direction === 'Entrada' ? 'incoming' : 'outgoing',
    text: String(row.content || ''),
    sender: row.sender_type==='client'?'Cliente':row.sender_type==='ai'?'Automático':'Corretor',
    deliveryStatus: row.direction==='outgoing' ? (row.delivery_status as DeliveryStatus || (row.external_message_id?'sent':'pending')) : undefined,
    deliveryError: row.delivery_status==='failed'?deliveryError(typeof row.delivery_error_code==='number'?row.delivery_error_code:null):undefined,
    time: createdAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
    images: Array.isArray(row.media_urls) ? row.media_urls.filter((item): item is string => typeof item === 'string').map((item, index) =>
      isWhatsAppMediaPath(item, String(row.company_id || '')) ? `/api/conversations/media?messageId=${encodeURIComponent(String(row.id))}&index=${index}` : item,
    ) : [],
  };
}
