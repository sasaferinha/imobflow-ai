import { supabaseServiceRequest } from './supabase';
import { configuredAIProvider } from './ai/openai-provider';
import { extractedPreferences, isSimpleGreeting, qualificationQuestion, toAIProfile, type InterestProfile } from './ai/qualification';
import type { LLMConversationMessage } from './ai/provider';
import { createHmac } from 'node:crypto';

const AFTER_HOURS_MESSAGE = 'Olá! Nosso atendimento encerrou às 18h. Retornaremos amanhã. Obrigado pela mensagem!';
const FALLBACK_MESSAGE = 'Recebemos sua mensagem. Um corretor dará continuidade ao seu atendimento.';
export function attendanceTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value || '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, afterHours: Number(value('hour')) >= 18 };
}
export type AttendanceInput = {
  companyId: string; leadId: string; conversationId: string; incomingExternalMessageId: string;
  message: string; hasImage: boolean; recipientPhone: string; phoneNumberId: string;
  accessToken: string | null; apiVersion: string; occurredAt: string;
};
type LeadRow = { interest_profile: InterestProfile; goal: string; property_type: string; region: string; budget_max: number; updated_at: string };
function currentPreferences(row: LeadRow): InterestProfile {
  const known = (value: string) => Boolean(value && !['não informado','nao informado','null','undefined','-'].includes(value.trim().toLowerCase()));
  return { ...row.interest_profile,
    ...(['Comprar','Alugar'].includes(row.goal) ? { purpose: row.goal === 'Comprar' ? 'Venda' as const : 'Aluguel' as const } : {}),
    ...(known(row.property_type) ? { propertyType: row.property_type } : {}),
    ...(known(row.region) ? { regions: row.region.split(/[,;/]/).map(s => s.trim()).filter(Boolean) } : {}),
    ...(row.budget_max > 0 ? { budgetMax: Number(row.budget_max) } : {}) };
}

async function replyText(input: AttendanceInput): Promise<string> {
  const [lead] = await supabaseServiceRequest<LeadRow[]>(`leads?company_id=eq.${input.companyId}&id=eq.${input.leadId}&select=interest_profile,goal,property_type,region,budget_max,updated_at&limit=1`);
  if (!lead) return FALLBACK_MESSAGE;
  const current = currentPreferences(lead);
  if (isSimpleGreeting(input.message)) return `Olá! ${qualificationQuestion(current)}`;
  if (input.hasImage && (!input.message.trim() || input.message === '[Foto]')) return 'Recebemos sua foto. Pode descrever o que você gostaria de encontrar nesse imóvel?';
  const provider = configuredAIProvider();
  if (!provider) return FALLBACK_MESSAGE;
  try {
    const rateKey = process.env.SUPABASE_SECRET_KEY || process.env.META_APP_SECRET || 'imobflow';
    const allowed = await supabaseServiceRequest<boolean>('rpc/consume_rate_limit', { method: 'POST', body: {
      p_bucket: `attendance-ai:${input.companyId}`,
      p_identifier_hash: createHmac('sha256', rateKey).update(input.leadId).digest('hex'),
      p_window_seconds: 3600, p_limit: 30,
    } });
    if (!allowed) return FALLBACK_MESSAGE;
    const history = await supabaseServiceRequest<Array<{ direction: string; content: string }>>(
      `messages?company_id=eq.${input.companyId}&conversation_id=eq.${input.conversationId}&select=direction,content&order=created_at.desc&limit=6`);
    const recentMessages: LLMConversationMessage[] = history.reverse().map(m => ({ role: m.direction === 'incoming' ? 'user' : 'assistant', content: m.content.slice(0, 800) }));
    const result = await provider.extractLeadProfile({ message: input.message, currentProfile: toAIProfile(current), recentMessages });
    const patch = extractedPreferences(result.data);
    if (Object.keys(patch).length) {
      const saved = await supabaseServiceRequest<boolean>('rpc/merge_attendance_profile', { method: 'POST', body: {
        p_company_id: input.companyId, p_lead_id: input.leadId, p_version: lead.updated_at, p_profile: patch,
      } });
      if (!saved) return 'Recebemos sua atualização. Vamos conferir suas preferências antes de continuar.';
    }
    if (result.data.requestsHumanHandoff) {
      await supabaseServiceRequest(`conversations?company_id=eq.${input.companyId}&id=eq.${input.conversationId}`, { method: 'PATCH', body: { bot_paused: true } });
      return FALLBACK_MESSAGE;
    }
    return qualificationQuestion({ ...current, ...patch });
  } catch { console.error('attendance_ai_unavailable'); return FALLBACK_MESSAGE; }
}

/** Only called with an inbound event verified and saved by the Meta webhook.
 * Opportunities never call this function. All failures remain outside webhook ACK. */
export async function respondToIncomingMessage(input: AttendanceInput) {
  const elapsed = Date.now() - Date.parse(input.occurredAt);
  if (!input.accessToken || !/^\d{5,30}$/.test(input.recipientPhone) || !/^\d{5,30}$/.test(input.phoneNumberId)
    || !/^v\d{1,3}\.\d{1,2}$/.test(input.apiVersion) || !Number.isFinite(elapsed) || elapsed < -300_000 || elapsed >= 86400000) return;
  const now = attendanceTime();
  const key = now.afterHours ? `after-hours:${input.conversationId}:${now.date}` : `reply:${input.incomingExternalMessageId}`;
  const reserved = await supabaseServiceRequest<boolean>('rpc/claim_attendance_reply', { method: 'POST', body: {
    p_company_id: input.companyId, p_conversation_id: input.conversationId, p_external_id: input.incomingExternalMessageId, p_key: key,
  } });
  if (!reserved) return;
  const content = now.afterHours ? AFTER_HOURS_MESSAGE : await replyText(input);
  try {
    const delivery = await fetch(`https://graph.facebook.com/${input.apiVersion}/${input.phoneNumberId}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000), cache: 'no-store',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: input.recipientPhone,
        type: 'text', text: { preview_url: false, body: content } }),
    });
    if (!delivery.ok) throw new Error('provider_rejected');
    const receipt = await delivery.json() as { messages?: Array<{ id?: unknown }> };
    const id = receipt.messages?.[0]?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 500) throw new Error('invalid_receipt');
    await supabaseServiceRequest('rpc/finish_attendance_reply', { method: 'POST', body: {
      p_company_id: input.companyId, p_key: key, p_provider_id: id, p_content: content,
    } });
  } catch {
    await supabaseServiceRequest('rpc/finish_attendance_reply', { method: 'POST', body: {
      p_company_id: input.companyId, p_key: key, p_provider_id: null, p_content: null,
    } });
    console.error('attendance_delivery_uncertain');
  }
}
