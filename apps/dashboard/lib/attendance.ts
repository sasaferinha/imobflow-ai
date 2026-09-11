import { supabaseServiceRequest } from './supabase';
import { isSimpleGreeting, qualificationQuestion, type InterestProfile } from './ai/qualification';
import { basicPreferences, requestsHuman } from './ai/basic-qualification';
import { businessTime } from './business-hours';
import { readBusinessHours } from './conversation-settings';
import {sendQueuedMessage} from './message-outbox';

const FALLBACK_MESSAGE = 'Recebemos sua mensagem. Um corretor dará continuidade ao seu atendimento.';
export const attendanceTime = businessTime;
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

export async function buildAttendanceReply(input: AttendanceInput): Promise<string> {
  const [lead] = await supabaseServiceRequest<LeadRow[]>(`leads?company_id=eq.${input.companyId}&id=eq.${input.leadId}&select=interest_profile,goal,property_type,region,budget_max,updated_at&limit=1`);
  if (!lead) return FALLBACK_MESSAGE;
  const current = currentPreferences(lead);
  if (isSimpleGreeting(input.message)) return `Olá! ${qualificationQuestion(current)}`;
  if (input.hasImage && (!input.message.trim() || input.message === '[Foto]')) return 'Recebemos sua foto. Pode descrever o que você gostaria de encontrar nesse imóvel?';
  try {
    // The essential reply never waits for an optional model (including invalid
    // keys, exhausted credits or a provider that hangs). AI remains available
    // in the separate enrichment flow, not in this delivery-critical path.
    if (requestsHuman(input.message)) {
      return FALLBACK_MESSAGE;
    }
    const patch = basicPreferences(input.message, current);
    if (Object.keys(patch).length) {
      const saved = await supabaseServiceRequest<boolean>('rpc/merge_attendance_profile', { method: 'POST', body: {
        p_company_id: input.companyId, p_lead_id: input.leadId, p_version: lead.updated_at, p_profile: patch,
      } });
      if (!saved) return 'Recebemos sua atualização. Vamos conferir suas preferências antes de continuar.';
    }
    return qualificationQuestion({ ...current, ...patch });
  } catch { console.error('attendance_profile_unavailable'); return qualificationQuestion(current); }
}

/** Only called with an inbound event verified and saved by the Meta webhook.
 * Opportunities never call this function. All failures remain outside webhook ACK. */
export async function respondToIncomingMessage(input: AttendanceInput) {
  const elapsed = Date.now() - Date.parse(input.occurredAt);
  if (!/^\d{5,30}$/.test(input.recipientPhone) || !/^\d{5,30}$/.test(input.phoneNumberId)
    || !/^v\d{1,3}\.\d{1,2}$/.test(input.apiVersion) || !Number.isFinite(elapsed) || elapsed < -300_000 || elapsed >= 86400000) return;
  const settings = await readBusinessHours(input.companyId);
  const now = attendanceTime(new Date(), settings);
  const key = now.afterHours ? `after-hours:${input.conversationId}:${now.closedPeriod}` : `reply:${input.incomingExternalMessageId}`;
  const reserved = await supabaseServiceRequest<boolean>('rpc/claim_attendance_reply', { method: 'POST', body: {
    p_company_id: input.companyId, p_conversation_id: input.conversationId, p_external_id: input.incomingExternalMessageId, p_key: key,
  } });
  if (!reserved) return;
  try {
    const content = now.afterHours ? settings.awayMessage : await buildAttendanceReply(input);
    const id=await supabaseServiceRequest<string>('rpc/enqueue_conversation_message',{method:'POST',body:{p_company_id:input.companyId,p_conversation_id:input.conversationId,p_key:key,p_content:content,p_broker_id:null}});
    await sendQueuedMessage(input.companyId,id);
  } catch {
    await supabaseServiceRequest('rpc/finish_attendance_reply', { method: 'POST', body: {
      p_company_id: input.companyId, p_key: key, p_provider_id: null, p_content: null,
    } });
    console.error('attendance_delivery_uncertain');
  } finally {
    if(requestsHuman(input.message))await supabaseServiceRequest(`conversations?company_id=eq.${input.companyId}&id=eq.${input.conversationId}`,{method:'PATCH',body:{bot_paused:true}});
  }
}
