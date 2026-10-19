import webpush from 'web-push';
import { supabaseServiceRequest as db } from './supabase';
import { urgentAlertEligibleAt } from './conversation-urgency';
import { validPushEndpoint, validatePushSubscription, webPushConfig, type BrowserPushSubscription } from './web-push';
import { readBusinessHours } from './conversation-settings';
import type { BusinessHours } from './business-hours';
import { urgentAlertActiveUntil, readUrgentAlertWindow, requireUrgentAlertPolicy } from './urgent-alert-hours';

type Candidate = { company_id: string; subscription_id: string; lead_id: string; waiting_message_id: string; waiting_since: string; duty_priority_until: string | null; duty_preferred: boolean };
type Target = { companyId: string; bindingId: string; subscription: BrowserPushSubscription; waitingSince: string; dutyPriorityUntil: string | null; dutyPreferred: boolean };
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
/** Each attempt is terminal. A separate reminder is permitted only after the
 * database's atomic five-minute cooldown; never replay missed reminders in a burst.
 */
export async function dispatchBrowserPush(send: Send = sendBrowserPush) {
  const config = webPushConfig();
  if (!config || !config.schedulerConfigured) return { configured: false, sent: 0, failed: 0, cancelled: 0 };
  const deadline = Date.now() + 45000, result = { configured: true, sent: 0, failed: 0, cancelled: 0 };
  await requireUrgentAlertPolicy();
  const candidates: Candidate[] = [];
  const schedules = new Map<string, BusinessHours | null>();
  // Collect before claims: claiming changes the candidate set, so offset paging
  // during writes would skip contacts. Closed companies must not hide the next page.
  for (let page = 0; page < 10 && candidates.length < 20 && Date.now() + 18000 < deadline; page++) {
    const rows = await db<Candidate[]>('rpc/list_web_push_candidates', { method: 'POST', body: { p_limit: 60, p_offset: page * 60 }, timeoutMs: 5000 });
    for (const candidate of rows) {
      if (candidates.length >= 20 || Date.now() + 18000 >= deadline) break;
      if (!candidate.company_id || !eligible({ waitingSince: candidate.waiting_since, dutyPriorityUntil: candidate.duty_priority_until, dutyPreferred: candidate.duty_preferred })) continue;
      if (!schedules.has(candidate.company_id)) {
        try { schedules.set(candidate.company_id, await readBusinessHours(candidate.company_id)); }
        catch { schedules.set(candidate.company_id, null); }
      }
      const schedule = schedules.get(candidate.company_id);
      if (schedule && urgentAlertActiveUntil(schedule) !== null) candidates.push(candidate);
    }
    if (rows.length < 60) break;
  }
  let attempted = 0;
  for (const candidate of candidates) {
    if (Date.now() + 18000 > deadline || attempted >= 20) break;
    const schedule = schedules.get(candidate.company_id);
    if (!schedule || urgentAlertActiveUntil(schedule) === null) continue;
    if (!eligible({ waitingSince: candidate.waiting_since, dutyPriorityUntil: candidate.duty_priority_until, dutyPreferred: candidate.duty_preferred })) continue;
    const attemptId = await db<string | null>('rpc/claim_web_push', { method:'POST', body:{p_subscription_id:candidate.subscription_id,p_lead_id:candidate.lead_id,p_waiting_message_id:candidate.waiting_message_id},timeoutMs:3000 });
    if (!attemptId) continue;
    attempted++;
    let state: 'sent' | 'failed' | 'cancelled' = 'cancelled', expired = false;
    try {
      // Re-read session and current ownership immediately before transport.
      // AI replies do not imply human acceptance. Re-read the company's schedule
      // too, so a closing boundary or changed settings cannot use an old approval.
      const target = await db<Target | null>('rpc/web_push_dispatch_target',{method:'POST',body:{p_attempt_id:attemptId},timeoutMs:3000});
      if (target && target.companyId === candidate.company_id && eligible(target)) {
        const expiresAt = await readUrgentAlertWindow(target.companyId);
        if (expiresAt !== null && expiresAt > Date.now()) {
          const subscription = validatePushSubscription(target.subscription);
          const status = await send(subscription, JSON.stringify({title:'ImobFlow',body:'Há atendimento aguardando um corretor.',url:'/painel#conversations',tag:'imobflow-attendance',bindingId:target.bindingId,expiresAt}), config);
          expired = status === 404 || status === 410;
          state = status >= 200 && status < 300 ? 'sent' : 'failed';
        }
      }
    } catch { state = 'failed'; }
    await db('rpc/finish_web_push',{method:'POST',body:{p_attempt_id:attemptId,p_state:state,p_expired:expired},timeoutMs:3000});
    result[state]++;
  }
  return result;
}
