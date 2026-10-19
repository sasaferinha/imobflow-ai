import { businessTime, type BusinessHours } from './business-hours';
import { readBusinessHours } from './conversation-settings';
import { supabaseServiceRequest } from './supabase';

export const URGENT_WINDOW_MAX_AGE_MS = 30_000;

/** A short freshness window, capped at the first local closing boundary.
 * Business schedules use minute precision. Checking the next UTC minute also
 * covers local midnight and IANA daylight-saving transitions without fixed offsets.
 */
export function urgentAlertActiveUntil(settings: BusinessHours, now = Date.now()): number | null {
  if (!Number.isFinite(now) || businessTime(new Date(now), settings).afterHours) return null;
  const expiresAt = now + URGENT_WINDOW_MAX_AGE_MS;
  const nextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
  return nextMinute <= expiresAt && businessTime(new Date(nextMinute), settings).afterHours ? nextMinute : expiresAt;
}

/** Never silently run the old unanswered-message / one-time-push policy. */
export async function requireUrgentAlertPolicy() {
  const version = await supabaseServiceRequest<number>('rpc/urgent_alert_policy_version', { method: 'POST', body: {}, timeoutMs: 3000 });
  if (version !== 3) throw new Error('urgent_alert_policy_unavailable');
}

export async function readUrgentAlertWindow(companyId: string) {
  const settings = await readBusinessHours(companyId);
  return urgentAlertActiveUntil(settings);
}
