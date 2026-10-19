import type { ConversationInboxItem } from './conversation-inbox';

export const URGENT_SNAPSHOT_MAX_AGE_MS = 30_000;
export const DUTY_URGENT_AFTER_MS = 2 * 60_000;
export const GENERAL_URGENT_AFTER_MS = 5 * 60_000;
export type UrgentQueueSnapshot = { actorId: string; fetchedAt: number; activeUntil: number | null; data: { leadId: string; waitingSince: string }[] };

/** The authenticated server confirms ownership/eligibility; the UI only narrows scope. */
export function visibleUrgentQueue({ snapshot, visibleLeadIds, currentBrokerId, ready, demonstration, now }: {
  snapshot: UrgentQueueSnapshot | null; visibleLeadIds: ReadonlySet<string>; currentBrokerId?: string;
  ready: boolean; demonstration: boolean; now: number;
}) {
  if (!ready || demonstration || !currentBrokerId || !snapshot || snapshot.actorId !== currentBrokerId
    || !Number.isFinite(snapshot.fetchedAt) || !Number.isFinite(now) || now < snapshot.fetchedAt
    || typeof snapshot.activeUntil !== 'number' || !Number.isFinite(snapshot.activeUntil) || now >= snapshot.activeUntil
    || now - snapshot.fetchedAt > URGENT_SNAPSHOT_MAX_AGE_MS) return [];
  const seen = new Set<string>();
  return snapshot.data.filter(item => {
    if (!item || typeof item.leadId !== 'string' || !visibleLeadIds.has(item.leadId) || seen.has(item.leadId)
      || !Number.isFinite(Date.parse(item.waitingSince)) || Date.parse(item.waitingSince) > snapshot.fetchedAt) return false;
    seen.add(item.leadId); return true;
  }).sort((a, b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince) || a.leadId.localeCompare(b.leadId));
}

/** Uses the server-confirmed first client arrival, not the last unanswered message.
 * Automatic replies and read receipts do not reset this clock or grant claim permission. */
export function urgentAlertEligibleAt(item: Pick<ConversationInboxItem, 'dutyPriorityUntil' | 'dutyPreferred'>, waitingSince: string): number | null {
  const waiting = Date.parse(waitingSince);
  if (!Number.isFinite(waiting)) return null;
  if (item.dutyPriorityUntil) {
    const until = Date.parse(item.dutyPriorityUntil);
    if (!Number.isFinite(until)) return null;
    // An old roster reservation must not grant early preference to a later intake.
    if (waiting >= until) return waiting + GENERAL_URGENT_AFTER_MS;
    // A reservation created after intake cannot restart the client's waiting clock.
    return waiting + (item.dutyPreferred ? DUTY_URGENT_AFTER_MS : GENERAL_URGENT_AFTER_MS);
  }
  // Without confirmed duty eligibility, never notify a non-duty broker early.
  return waiting + GENERAL_URGENT_AFTER_MS;
}
