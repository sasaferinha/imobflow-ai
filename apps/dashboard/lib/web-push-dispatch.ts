import webpush from 'web-push';
import { supabaseServiceRequest as db } from './supabase';
import { urgentAlertEligibleAt } from './conversation-urgency';
import { validPushEndpoint, validatePushSubscription, webPushConfig, type BrowserPushSubscription } from './web-push';

type Candidate = { subscription_id: string; lead_id: string; waiting_message_id: string; waiting_since: string; duty_priority_until: string | null; duty_preferred: boolean };
type Target = { bindingId: string; subscription: BrowserPushSubscription; waitingSince: string; dutyPriorityUntil: string | null; dutyPreferred: boolean };
type Send = (subscription: BrowserPushSubscription, payload: string, config: NonNullable<ReturnType<typeof webPushConfig>>) => Promise<number>;
/** No redirects, provider-only endpoints, fixed payload and a total request deadline. */
export const sendBrowserPush: Send = async (subscription, payload, config) => {
  const details = webpush.generateRequestDetails(subscription, payload, {
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
    TTL: 60, urgency: 'high', topic: 'imobflow-attendance', contentEncoding: 'aes128gcm',
  });
  const endpoint = validPushEndpoint(details.endpoint);
  if (endpoint !== subscription.endpoint) throw new Error('push_endpoint_changed');
  const response = await fetch(endpoint, { method: 'POST', headers: details.headers as HeadersInit,
    body: new Uint8Array(details.body || []), redirect: 'error', signal: AbortSignal.timeout(5000), cache: 'no-store' });
  const status = response.status;
  await response.body?.cancel();
  return status;
};
const eligible = (item: Pick<Target, 'waitingSince' | 'dutyPriorityUntil' | 'dutyPreferred'>) => {
  const at = urgentAlertEligibleAt(item, item.waitingSince);
  return at !== null && at <= Date.now();
};
/** At-most-once attempts: failures/timeouts remain terminal, avoiding uncertain re-sends. */
export async function dispatchBrowserPush(send: Send = sendBrowserPush) {
  const config = webPushConfig();
  if (!config || !config.schedulerConfigured) return { configured: false, sent: 0, failed: 0, cancelled: 0 };
  const candidates = await db<Candidate[]>('rpc/list_web_push_candidates', { method: 'POST', body: { p_limit: 60 }, timeoutMs: 5000 });
  const deadline = Date.now() + 40000, result = { configured: true, sent: 0, failed: 0, cancelled: 0 };
  let attempted = 0;
  for (const candidate of candidates) {
    if (Date.now() + 8000 > deadline || attempted >= 20) break;
    if (!eligible({ waitingSince: candidate.waiting_since, dutyPriorityUntil: candidate.duty_priority_until, dutyPreferred: candidate.duty_preferred })) continue;
    const attemptId = await db<string | null>('rpc/claim_web_push', { method:'POST', body:{p_subscription_id:candidate.subscription_id,p_lead_id:candidate.lead_id,p_waiting_message_id:candidate.waiting_message_id},timeoutMs:3000 });
    if (!attemptId) continue;
    attempted++;
    let state: 'sent' | 'failed' | 'cancelled' = 'cancelled', expired = false;
    try {
      // Re-read session, current ownership, bot mode and the same waiting cycle
      // immediately before transport; logout removes the binding. A hash-only
      // attempt receipt survives so re-login cannot repeat the same waiting alert.
      const target = await db<Target | null>('rpc/web_push_dispatch_target',{method:'POST',body:{p_attempt_id:attemptId},timeoutMs:3000});
      if (target && eligible(target)) {
        const subscription = validatePushSubscription(target.subscription);
        const status = await send(subscription, JSON.stringify({title:'ImobFlow',body:'Há atendimento aguardando um corretor.',url:'/painel#conversations',tag:'imobflow-attendance',bindingId:target.bindingId}), config);
        expired = status === 404 || status === 410;
        state = status >= 200 && status < 300 ? 'sent' : 'failed';
      }
    } catch { state = 'failed'; }
    await db('rpc/finish_web_push',{method:'POST',body:{p_attempt_id:attemptId,p_state:state,p_expired:expired},timeoutMs:3000});
    result[state]++;
  }
  return result;
}
