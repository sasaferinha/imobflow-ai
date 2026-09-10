import { IncomingWhatsAppMessage, normalizePhone } from './meta-whatsapp';
import { supabaseServiceRequest } from './supabase';
import { persistIncomingWhatsAppImage } from './whatsapp-media';

type LeadRow = { id: string; phone: string | null };
type ConversationRow = { id: string };

export async function saveIncomingWhatsAppMessage(input: IncomingWhatsAppMessage) {
  const duplicate = await supabaseServiceRequest<Array<{ id: string }>>(
    `messages?company_id=eq.${input.companyId}&external_message_id=eq.${encodeURIComponent(input.externalMessageId)}&select=id&limit=1`,
  );
  if (duplicate.length) return { saved: false as const };

  const leads = await supabaseServiceRequest<LeadRow[]>(
    `leads?company_id=eq.${input.companyId}&select=id,phone`, { allRows: true },
  );
  let leadId = leads.find((lead) => normalizePhone(lead.phone || '') === input.phone)?.id;
  if (!leadId) {
    const [created] = await supabaseServiceRequest<Array<{ id: string }>>('leads', {
      method: 'POST', prefer: 'return=representation',
      body: {
        company_id: input.companyId,
        name: input.contactName || 'Contato WhatsApp',
        phone: `+${input.phone}`,
        source: 'WhatsApp',
        details: 'Lead criado automaticamente a partir de uma mensagem recebida no WhatsApp.',
        last_contact_at: input.occurredAt || new Date().toISOString(),
      },
    });
    leadId = created?.id;
  }
  if (!leadId) throw new Error('Não foi possível localizar o lead do WhatsApp.');

  const lookup = `conversations?company_id=eq.${input.companyId}&lead_id=eq.${leadId}&select=id&limit=1`;
  let conversations = await supabaseServiceRequest<ConversationRow[]>(lookup);
  if (!conversations.length) {
    conversations = await supabaseServiceRequest<ConversationRow[]>('conversations', {
      method: 'POST', prefer: 'return=representation',
      body: {
        company_id: input.companyId,
        lead_id: leadId,
        channel: 'WhatsApp',
        external_conversation_id: `whatsapp:${input.phone}`,
        status: 'Aberta',
        last_message_at: input.occurredAt || new Date().toISOString(),
      },
    });
  }
  const conversationId = conversations[0]?.id;
  if (!conversationId) throw new Error('Não foi possível criar a conversa do WhatsApp.');
  try {
    const mediaUrls = input.media ? [await persistIncomingWhatsAppImage({
      companyId: input.companyId, mediaId: input.media.id, mimeType: input.media.mimeType,
      accessToken: input.accessToken, apiVersion: input.apiVersion,
    })] : [];
    await supabaseServiceRequest('messages', {
      method: 'POST',
      body: {
        company_id: input.companyId,
        conversation_id: conversationId,
        direction: 'incoming',
        sender_type: 'client',
        content: input.text,
        media_urls: mediaUrls,
        external_message_id: input.externalMessageId,
        created_at: input.occurredAt || new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate key')) return { saved: false as const };
    throw error;
  }
  await supabaseServiceRequest(`conversations?id=eq.${conversationId}`, {
    method: 'PATCH', body: { last_message_at: input.occurredAt || new Date().toISOString() },
  });
  await supabaseServiceRequest(`leads?id=eq.${leadId}&company_id=eq.${input.companyId}`, {
    method: 'PATCH', body: { last_contact_at: input.occurredAt || new Date().toISOString() },
  });
  return {
    saved: true as const, companyId: input.companyId, leadId, conversationId,
    incomingExternalMessageId: input.externalMessageId, message: input.text, hasImage: Boolean(input.media),
    recipientPhone: input.phone, phoneNumberId: input.phoneNumberId, accessToken: input.accessToken,
    apiVersion: input.apiVersion, occurredAt: input.occurredAt || new Date().toISOString(),
  };
}
