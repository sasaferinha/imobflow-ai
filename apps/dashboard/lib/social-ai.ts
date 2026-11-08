import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { supabaseServiceRequest as db } from './supabase';
import { readSocialThreadForAI, sendSocialAutomatedMessage } from './social-messaging';
import { publicSocialProfile, socialUuid } from './social-model';
import { transcribeSocialAudio } from './social-audio';
import { basicPreferences, requestsHuman } from './ai/basic-qualification';
import { configuredAIProvider } from './ai/openai-provider';
import { extractedPreferences, qualificationQuestion, toAIProfile, QUALIFICATION_COMPLETE_MESSAGE, type InterestProfile } from './ai/qualification';
import { needsBrokerAnswer } from './ai/conversation-understanding';
import { readTenantAISettings } from './ai/tenant-settings-server';
import { handoffCopy, serviceAllowed, tenantQualificationQuestion, unsupportedServiceReply } from './ai/tenant-runtime';

type SocialAIInput = { companyId: string; threadId: string; leadId: string; messageId: string };
type SocialAIJob = SocialAIInput & { leaseId: string; attempts: number };
type Outcome = 'done' | 'retry' | 'failed';
class SocialAIDeadline extends Error {}
function remaining(deadline: number, minimum = 250) {
  const available = deadline-Date.now();
  if (available < minimum) throw new SocialAIDeadline();
  return Math.min(3000, available);
}

async function runTurn(input: SocialAIInput, deadline: number): Promise<Outcome> {
  const thread = await readSocialThreadForAI(input.companyId, input.threadId, deadline);
  if (!thread || thread.leadId !== input.leadId || thread.mode !== 'automatic' || thread.incomingMessageId !== input.messageId) return 'done';
  remaining(deadline, 4500);
  const settings = await readTenantAISettings(input.companyId);
  if (settings.automaticMode !== 'qualify') return 'done';
  const message = thread.messages.find(item => item.id === input.messageId && item.direction === 'incoming');
  if (!message) return 'done';
  const [prior] = await db<Array<{ reply: string; handoff: boolean }>>(`social_ai_turns?company_id=eq.${input.companyId}&thread_id=eq.${input.threadId}&message_id=eq.${input.messageId}&select=reply,handoff&limit=1`, { timeoutMs: remaining(deadline) });
  let patch: InterestProfile = {}, handoff = prior?.handoff || false, reply = prior?.reply || '';
  if (!prior) {
    if (message.mediaType === 'audio') {
      remaining(deadline, 6500);
      message.text = await transcribeSocialAudio(input.companyId,input.threadId,input.messageId, Math.min(deadline-4500, Date.now()+20000)) || '';
    }
    const current = publicSocialProfile(thread.lead.interest_profile) as InterestProfile;
    patch = basicPreferences(message.text, current);
    handoff = requestsHuman(message.text) || needsBrokerAnswer(message.text) || !message.text.trim();
    const provider = configuredAIProvider();
    if (provider && !handoff) {
      remaining(deadline, 11000);
      try {
        const result = await provider.extractLeadProfile({ message: message.text, currentProfile: toAIProfile(current), recentMessages: thread.messages.slice(-7,-1).map(item => ({ role: item.direction === 'incoming' ? 'user' as const : 'assistant' as const, content: item.text })) });
        patch = { ...extractedPreferences(result.data), ...patch };
        handoff = result.data.requestsHumanHandoff;
      } catch { /* Keep conservative local qualification if the provider is unavailable. */ }
    }
    const profile = { ...current, ...patch };
    reply = tenantQualificationQuestion(profile, settings, qualificationQuestion(profile));
    if (!serviceAllowed(settings, profile.purpose)) { reply = unsupportedServiceReply(settings); handoff = true; }
    else if (handoff || reply === QUALIFICATION_COMPLETE_MESSAGE) {
      reply = handoffCopy(settings, message.text.trim() ? 'Vou encaminhar sua conversa para um corretor continuar o atendimento por aqui.' : 'Recebi sua mensagem. Vou pedir a um corretor para conferir o conteúdo e continuar por aqui.'); handoff = true;
    }
  }
  remaining(deadline, 4500);
  if (!isDeepStrictEqual(settings, await readTenantAISettings(input.companyId))) return 'done';
  const turn = await db<{ ready: boolean; reply?: string; handoff?: boolean }>('rpc/prepare_social_ai_turn', { method: 'POST', timeoutMs: remaining(deadline), body: {
    p_company_id: input.companyId, p_thread_id: input.threadId, p_message_id: input.messageId,
    p_patch: patch, p_reply: reply.slice(0,2000), p_handoff: handoff, p_expected_profile: thread.profileSnapshot,
  } });
  if (!turn.ready || !turn.reply) return 'done';
  // A prepared reply survives a deadline. Retry uses its existing text and the
  // immutable incoming-message ID, never a new outbound idempotency key.
  remaining(deadline, 4500);
  const result = await sendSocialAutomatedMessage({ companyId: input.companyId, threadId: input.threadId, incomingMessageId: input.messageId, requestId: input.messageId, content: turn.reply, deadline });
  if (!result.messages.length || result.messages.some(item => ['pending','sending'].includes(item.status))) return 'retry';
  if (turn.handoff) await db('rpc/finish_social_ai_turn', { method: 'POST', timeoutMs: remaining(deadline), body: { p_company_id: input.companyId, p_thread_id: input.threadId, p_message_id: input.messageId } });
  return result.messages.some(item => ['unknown','failed'].includes(item.status)) ? 'failed' : 'done';
}

async function executeJob(job: SocialAIJob, deadline: number): Promise<Outcome> {
  let outcome: Outcome = 'retry', code: string | null = null;
  try { outcome = await runTurn(job, deadline-2000); }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/social_handoff|social_window_closed|social_connection_unavailable/.test(message)) { outcome = 'done'; code = 'precondition_changed'; }
    else code = error instanceof SocialAIDeadline ? 'deadline' : 'temporary_failure';
  }
  await db('rpc/finish_social_ai_job', { method: 'POST', timeoutMs: remaining(deadline), body: { p_company_id: job.companyId, p_message_id: job.messageId, p_lease_id: job.leaseId, p_outcome: outcome, p_error_code: code } });
  return outcome;
}

/** The verified webhook supplies scope; a durable DB job is required to proceed. */
export async function processSocialAI(input: SocialAIInput) {
  if (![input.companyId,input.threadId,input.leadId,input.messageId].every(socialUuid)) return;
  const deadline = Date.now()+55000;
  const job = await db<SocialAIJob | null>('rpc/claim_social_ai_job', { method: 'POST', timeoutMs: remaining(deadline), body: { p_lease_id: randomUUID(), p_company_id: input.companyId, p_message_id: input.messageId } });
  if (!job) return;
  if (job.companyId !== input.companyId || job.threadId !== input.threadId || job.leadId !== input.leadId || job.messageId !== input.messageId) throw new Error('social_ai_scope');
  await executeJob(job, deadline);
}

/** Existing secret-protected cron recovers interrupted jobs within a 20s budget. */
export async function recoverSocialAI(deadline = Date.now()+20000) {
  const stopAt = Math.min(deadline, Date.now()+20000);
  let processed = 0, deferred = 0, failed = 0;
  while (processed < 10 && Date.now()+15000 < stopAt) {
    const job = await db<SocialAIJob | null>('rpc/claim_social_ai_job', { method: 'POST', timeoutMs: remaining(stopAt), body: { p_lease_id: randomUUID(), p_company_id: null, p_message_id: null } });
    if (!job) break;
    const outcome = await executeJob(job, stopAt);
    processed++; if (outcome === 'retry') deferred++; if (outcome === 'failed') failed++;
  }
  return { processed, deferred, failed };
}
