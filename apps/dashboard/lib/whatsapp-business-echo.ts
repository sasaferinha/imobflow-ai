import { incomingAudio, incomingImage, readableText, type IncomingWhatsAppMessage, type MetaWhatsAppConnection } from './meta-whatsapp';
import { supabaseServiceRequest as db } from './supabase';
import { persistIncomingWhatsAppImage } from './whatsapp-media';

type BusinessEcho = Record<string, unknown> & { to?: string; id?: string; timestamp?: string; type?: string };
type BusinessEchoValue = { metadata?: { phone_number_id?: string }; message_echoes?: BusinessEcho[] };

// Meta Coexistence: messages authored in the Business app are outgoing echoes.
// They must never pass through inbound qualification or the outbound send queue.
export function parseBusinessAppMessages(payload: unknown, connections: MetaWhatsAppConnection[]): IncomingWhatsAppMessage[] {
  const root = payload as { object?: string; entry?: Array<{ changes?: Array<{ field?: string; value?: BusinessEchoValue }> }> } | null;
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return [];
  const output: IncomingWhatsAppMessage[] = [];
  for (const entry of root.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== 'smb_message_echoes') continue;
      const value = change.value;
      const connection = connections.find(c => c.enabled && c.phoneNumberId === value?.metadata?.phone_number_id);
      if (!connection || !Array.isArray(value?.message_echoes)) continue;
      for (const row of value.message_echoes) {
        if (!row || typeof row !== 'object') continue;
        const phone = typeof row.to === 'string' ? row.to.replace(/^\+/, '') : '';
        const externalMessageId = typeof row.id === 'string' ? row.id : '';
        const timestamp = typeof row.timestamp === 'string' && /^\d{1,13}$/.test(row.timestamp) ? Number(row.timestamp) * 1000 : NaN;
        if (!/^\d{5,20}$/.test(phone) || !externalMessageId || externalMessageId.length > 255 || !Number.isFinite(timestamp) || timestamp < 0 || timestamp > Date.now() + 300000) continue;
        // Edit/revoke are updates, not new authored messages. Do not invent one.
        if (['edit', 'revoke', 'reaction'].includes(row.type ?? '')) continue;
        const media = incomingAudio(row) || incomingImage(row);
        const labels: Record<string, string> = { audio: 'Áudio enviado pelo WhatsApp Business', image: 'Foto enviada pelo WhatsApp Business', document: 'Documento enviado pelo WhatsApp Business', video: 'Vídeo enviado pelo WhatsApp Business', sticker: 'Figurinha enviada pelo WhatsApp Business', location: 'Localização enviada pelo WhatsApp Business', contacts: 'Contato enviado pelo WhatsApp Business' };
        const text = readableText(row) || media?.caption || labels[row.type ?? ''];
        if (!text) continue;
        output.push({ companyId: connection.companyId, phoneNumberId: connection.phoneNumberId, phone, externalMessageId, text, contactName: null, occurredAt: new Date(timestamp).toISOString(), media, accessToken: connection.accessToken, apiVersion: connection.apiVersion });
      }
    }
  }
  return output;
}

export async function saveBusinessAppMessage(input: IncomingWhatsAppMessage) {
  const result = await db<{ saved: boolean; messageId?: string }>('rpc/receive_business_app_message', {
    method: 'POST', body: { p_company_id: input.companyId, p_phone: input.phone, p_phone_number_id: input.phoneNumberId, p_external_id: input.externalMessageId, p_content: input.text, p_occurred_at: input.occurredAt },
  });
  if (result.saved && result.messageId && input.media) {
    let mediaUrls: string[] = [];
    let content = input.text;
    try {
      mediaUrls = [await persistIncomingWhatsAppImage({ companyId: input.companyId, mediaId: input.media.id, mimeType: input.media.mimeType, accessToken: input.accessToken, apiVersion: input.apiVersion, kind: input.media.kind })];
    } catch { content += '\n[Arquivo indisponível no painel. Consulte o WhatsApp Business.]'; }
    await db(`messages?company_id=eq.${input.companyId}&id=eq.${result.messageId}`, { method: 'PATCH', body: { media_urls: mediaUrls, content } });
  }
  return result;
}
