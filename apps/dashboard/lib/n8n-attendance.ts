import { supabaseServiceRequest } from './supabase';

type AttendanceConnection = { webhookUrl: string; secret: string };
type AttendancePhase = 'n8n' | 'meta' | 'database';
type AttendanceDiagnostic = {
  phase: AttendancePhase;
  reason: string;
  httpStatus?: number;
  providerCode?: number;
  providerSubcode?: number;
};
class AttendanceError extends Error {
  constructor(readonly diagnostic: AttendanceDiagnostic) {
    super(diagnostic.reason);
  }
}
const AFTER_HOURS_MESSAGE = 'Olá! Nosso atendimento encerrou às 18h. Retornaremos amanhã a partir das 8h. Obrigado pela mensagem!';

export function attendanceFailureDiagnostic(error: unknown): AttendanceDiagnostic {
  return error instanceof AttendanceError ? error.diagnostic : { phase: 'n8n', reason: 'attendance_unexpected_failure' };
}

function configuredAttendanceConnection(): { connection: AttendanceConnection; reason?: never } | { connection: null; reason: string } {
  const webhookUrl = process.env.N8N_ATTENDANCE_WEBHOOK_URL?.trim() || '';
  const secret = process.env.N8N_ATTENDANCE_WEBHOOK_SECRET?.trim() || '';
  if (!webhookUrl) return { connection: null, reason: 'n8n_webhook_url_missing' };
  if (!secret) return { connection: null, reason: 'n8n_webhook_secret_missing' };
  if (secret.length < 16) return { connection: null, reason: 'n8n_webhook_secret_invalid' };
  try {
    const url = new URL(webhookUrl);
    if (url.protocol !== 'https:') return { connection: null, reason: 'n8n_webhook_url_invalid' };
    return { connection: { webhookUrl: url.toString(), secret } };
  } catch {
    return { connection: null, reason: 'n8n_webhook_url_invalid' };
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

function saoPauloTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) };
}

async function sendWhatsAppText(input: { phoneNumberId: string; accessToken: string; apiVersion: string; recipientPhone: string; text: string }) {
  const delivery = await fetch(`https://graph.facebook.com/${input.apiVersion}/${input.phoneNumberId}/messages`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: input.recipientPhone,
      type: 'text', text: { preview_url: false, body: input.text },
    }), cache: 'no-store',
  });
  if (!delivery.ok) {
    let providerError: Record<string, unknown> = {};
    try {
      const payload = await delivery.json() as { error?: unknown };
      if (payload?.error && typeof payload.error === 'object') providerError = payload.error as Record<string, unknown>;
    } catch {}
    const numericCode = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 99_999_999 ? value : undefined;
    throw new AttendanceError({
      phase: 'meta', reason: 'meta_response_rejected', httpStatus: delivery.status,
      providerCode: numericCode(providerError.code), providerSubcode: numericCode(providerError.error_subcode),
    });
  }
  const receipt = await delivery.json() as { messages?: Array<{ id?: unknown }> };
  const providerMessageId = receipt.messages?.[0]?.id;
  if (typeof providerMessageId !== 'string' || !providerMessageId.trim() || providerMessageId.length > 500) {
    throw new AttendanceError({ phase: 'meta', reason: 'meta_receipt_missing' });
  }
  return providerMessageId;
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
  const elapsed = Date.now() - Date.parse(input.occurredAt);
  if (!input.accessToken) return { requested: false as const, reason: 'meta_access_token_missing' };
  if (!/^\d{5,30}$/.test(input.recipientPhone)) return { requested: false as const, reason: 'recipient_phone_invalid' };
  if (!/^\d{5,30}$/.test(input.phoneNumberId)) return { requested: false as const, reason: 'phone_number_id_invalid' };
  if (!/^v\d{1,3}\.\d{1,2}$/.test(input.apiVersion)) return { requested: false as const, reason: 'meta_api_version_invalid' };
  if (!Number.isFinite(elapsed)) return { requested: false as const, reason: 'inbound_timestamp_invalid' };
  if (elapsed < -300_000) return { requested: false as const, reason: 'inbound_timestamp_future' };
  if (elapsed > 24 * 60 * 60 * 1000) return { requested: false as const, reason: 'inbound_outside_reply_window' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  let phase: AttendancePhase = 'database';
  try {
    const now = saoPauloTime();
    if (now.hour >= 18) {
      const marker = `after-hours:${input.conversationId}:${now.date}`;
      const prior = await supabaseServiceRequest<Array<{ id: string }>>(
        `messages?company_id=eq.${input.companyId}&conversation_id=eq.${input.conversationId}&external_message_id=eq.${encodeURIComponent(marker)}&select=id&limit=1`,
      );
      if (prior.length) return { requested: false as const, afterHours: true as const, reason: 'after_hours_reply_already_sent' };
      phase = 'meta';
      const providerMessageId = await sendWhatsAppText({
        phoneNumberId: input.phoneNumberId, accessToken: input.accessToken, apiVersion: input.apiVersion,
        recipientPhone: input.recipientPhone, text: AFTER_HOURS_MESSAGE,
      });
      phase = 'database';
      await supabaseServiceRequest('messages', {
        method: 'POST', body: {
          company_id: input.companyId, conversation_id: input.conversationId, direction: 'outgoing', sender_type: 'ai',
          content: AFTER_HOURS_MESSAGE, external_message_id: marker,
        },
      });
      return { requested: false as const, afterHours: true as const, sent: true as const, providerMessageId, reason: 'after_hours_reply_accepted' };
    }
    const configuration = configuredAttendanceConnection();
    if (!configuration.connection) return { requested: false as const, reason: configuration.reason };
    const connection = configuration.connection;
    phase = 'n8n';
    const response = await fetch(connection.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ImobFlow-Secret': connection.secret },
      body: JSON.stringify({ message: input.message, conversationId: input.conversationId, leadId: input.leadId, hasImage: input.hasImage }),
      signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) throw new AttendanceError({ phase: 'n8n', reason: 'n8n_response_rejected', httpStatus: response.status });
    const raw = await response.text();
    let payload: unknown = raw;
    try { payload = JSON.parse(raw); } catch { /* A resposta pode ser texto simples. */ }
    const suggestion = responseText(payload);
    if (!suggestion) return { requested: true as const, sent: false as const, reason: 'n8n_response_empty' };
    phase = 'meta';
    const providerMessageId = await sendWhatsAppText({
      phoneNumberId: input.phoneNumberId, accessToken: input.accessToken, apiVersion: input.apiVersion,
      recipientPhone: input.recipientPhone, text: suggestion,
    });
    phase = 'database';
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
    return { requested: true as const, sent: true as const, reason: 'attendance_reply_accepted' };
  } catch (error) {
    if (error instanceof AttendanceError) throw error;
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new AttendanceError({ phase, reason: `${phase}_${timedOut ? 'request_timeout' : 'request_failed'}` });
  } finally {
    clearTimeout(timeout);
  }
}
