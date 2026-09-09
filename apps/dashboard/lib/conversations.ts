import { supabaseCompanyId, supabaseRequest } from './supabase';

export type ConversationMessage = {
  id: string;
  leadId: string;
  side: 'incoming' | 'outgoing';
  text: string;
  time: string;
  images: string[];
};

export async function listConversationMessages(): Promise<ConversationMessage[]> {
  const conversations = await supabaseRequest<Record<string, unknown>[]>(
    `conversations?company_id=eq.${supabaseCompanyId()}&select=id,lead_id`,
  );
  if (!conversations.length) return [];
  const conversationIds = conversations.map((row) => String(row.id));
  const leadByConversation = new Map(conversations.map((row) => [String(row.id), String(row.lead_id)]));
  const messages = await supabaseRequest<Record<string, unknown>[]>(
    `messages?company_id=eq.${supabaseCompanyId()}&conversation_id=in.(${conversationIds.join(',')})&select=*&order=created_at.asc`,
  );
  return messages.map((row) => mapMessage(row, leadByConversation.get(String(row.conversation_id)) || ''));
}

export async function createConversationMessage(input: {
  leadId: string;
  content: string;
  images?: string[];
  propertyId?: string | null;
}): Promise<ConversationMessage> {
  const companyId = supabaseCompanyId();
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
  const [message] = await supabaseRequest<Record<string, unknown>[]>('messages', {
    method: 'POST', prefer: 'return=representation',
    body: { company_id: companyId, conversation_id: conversationId, direction: 'outgoing', sender_type: 'human', content: input.content, media_urls: verifiedImages },
  });
  await supabaseRequest(`conversations?id=eq.${conversationId}`, { method: 'PATCH', body: { last_message_at: new Date().toISOString() } });
  if (input.propertyId) {
    await supabaseRequest('lead_property_events', {
      method: 'POST',
      body: { company_id: companyId, lead_id: input.leadId, property_id: input.propertyId, event_type: 'Enviado' },
    });
  }
  return mapMessage(message, input.leadId);
}

function mapMessage(row: Record<string, unknown>, leadId: string): ConversationMessage {
  const createdAt = new Date(String(row.created_at));
  return {
    id: String(row.id), leadId,
    side: row.direction === 'incoming' || row.direction === 'Entrada' ? 'incoming' : 'outgoing',
    text: String(row.content || ''),
    time: createdAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
    images: Array.isArray(row.media_urls) ? row.media_urls.filter((item): item is string => typeof item === 'string') : [],
  };
}
