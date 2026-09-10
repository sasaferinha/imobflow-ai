import { supabaseServiceRequest } from './supabase';

type AttendanceConnection = { webhookUrl: string; secret: string };

function configuredAttendanceConnection(): AttendanceConnection | null {
  const webhookUrl = process.env.N8N_ATTENDANCE_WEBHOOK_URL?.trim() || '';
  const secret = process.env.N8N_ATTENDANCE_WEBHOOK_SECRET?.trim() || '';
  try {
    const url = new URL(webhookUrl);
    if (url.protocol !== 'https:' || !secret || secret.length < 16) return null;
    return { webhookUrl: url.toString(), secret };
  } catch {
    return null;
  }
}

function responseText(value: unknown): string {
  if (typeof value === 'string') return value.trim().slice(0, 4000);
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  for (const key of ['suggestion', 'message', 'output', 'text', 'response']) {
    if (typeof row[key] === 'string' && row[key].trim()) return row[key].trim().slice(0, 4000);
  }
  return '';
}

/** Calls n8n after a verified inbound provider event. Meta receives an automatic
 * reply only after its API accepts the response, and that accepted response is
 * then recorded in the tenant's conversation. */
export async function requestAttendanceSuggestion(input: {
  companyId: string;
  leadId: string;
  conversationId: string;
  incomingExternalMessageId: string;
  message: string;
  hasImage: boolean;
  recipientPhone: string;
  phoneNumberId: string;
  accessToken: string | null;
  apiVersion: string;
  occurredAt: string;
}) {
  const connection = configuredAttendanceConnection();
  const elapsed = Date.now() - Date.parse(input.occurredAt);
  if (!connection || !input.accessToken || !/^\d{5,30}$/.test(input.recipientPhone) || !/^\d{5,30}$/.test(input.phoneNumberId)
    || !/^v\d{1,3}\.\d{1,2}$/.test(input.apiVersion) || !Number.isFinite(elapsed) || elapsed < -300_000 || elapsed > 24 * 60 * 60 * 1000) {
    return { requested: false as const };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(connection.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ImobFlow-Secret': connection.secret },
      body: JSON.stringify({ message: input.message, conversationId: input.conversationId, leadId: input.leadId, hasImage: input.hasImage }),
      signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`n8n respondeu ${response.status}`);
    const raw = await response.text();
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* A resposta pode ser texto simples. */ }
    const suggestion = responseText(payload);
    if (!suggestion) return { requested: true as const, sent: false as const };
    const delivery = await fetch(`https://graph.facebook.com/${input.apiVersion}/${input.phoneNumberId}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to: input.recipientPhone,
        type: 'text', text: { preview_url: false, body: suggestion },
      }), cache: 'no-store',
    });
    if (!delivery.ok) throw new Error(`Meta não aceitou a resposta (${delivery.status}).`);
    const receipt = await delivery.json() as { messages?: Array<{ id?: unknown }> };
    const providerMessageId = receipt.messages?.[0]?.id;
    if (typeof providerMessageId !== 'string' || !providerMessageId.trim() || providerMessageId.length > 500) throw new Error('A Meta não confirmou a resposta automática.');
    try {
      await supabaseServiceRequest('messages', {
        method: 'POST',
        body: {
          company_id: input.companyId,
          conversation_id: input.conversationId,
          direction: 'outgoing',
          sender_type: 'ai',
          content: suggestion,
          external_message_id: providerMessageId,
        },
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('duplicate key')) throw error;
    }
    return { requested: true as const, sent: true as const };
  } finally {
    clearTimeout(timeout);
  }
}
