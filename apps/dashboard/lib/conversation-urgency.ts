import { dutyPriorityBlocked, type ConversationInboxItem } from './conversation-inbox';
import type { ConversationAttendanceSummary, ConversationMessage } from './conversations';
import type { LeadProfile } from './leads';

export const URGENT_SNAPSHOT_MAX_AGE_MS = 30_000;
export const DUTY_URGENT_AFTER_MS = 2 * 60_000;
export const GENERAL_URGENT_AFTER_MS = 5 * 60_000;
export type UrgentQueueSnapshot = { actorId: string; fetchedAt: number; data: { leadId: string; waitingSince: string }[] };

/** The authenticated server confirms ownership/eligibility; the UI only narrows scope. */
export function visibleUrgentQueue({ snapshot, visibleLeadIds, currentBrokerId, ready, demonstration, now }: {
  snapshot: UrgentQueueSnapshot | null; visibleLeadIds: ReadonlySet<string>; currentBrokerId?: string;
  ready: boolean; demonstration: boolean; now: number;
}) {
  if (!ready || demonstration || !currentBrokerId || !snapshot || snapshot.actorId !== currentBrokerId
    || !Number.isFinite(snapshot.fetchedAt) || !Number.isFinite(now) || now < snapshot.fetchedAt
    || now - snapshot.fetchedAt > URGENT_SNAPSHOT_MAX_AGE_MS) return [];
  const seen = new Set<string>();
  return snapshot.data.filter(item => {
    if (!item || typeof item.leadId !== 'string' || !visibleLeadIds.has(item.leadId) || seen.has(item.leadId)
      || !Number.isFinite(Date.parse(item.waitingSince)) || Date.parse(item.waitingSince) > snapshot.fetchedAt) return false;
    seen.add(item.leadId); return true;
  }).sort((a, b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince) || a.leadId.localeCompare(b.leadId));
}

/** Reusable on the server as well; it grants no claim/send permission. */
export function urgentAlertEligibleAt(item: Pick<ConversationInboxItem, 'dutyPriorityUntil' | 'dutyPreferred'>, waitingSince: string): number | null {
  const waiting = Date.parse(waitingSince);
  if (!Number.isFinite(waiting)) return null;
  if (item.dutyPriorityUntil) {
    const until = Date.parse(item.dutyPriorityUntil);
    if (!Number.isFinite(until)) return null;
    // An old roster reservation must not make a later waiting cycle urgent immediately.
    if (waiting >= until) return waiting + GENERAL_URGENT_AFTER_MS;
    // The server's immutable five-minute reservation is the intake clock.
    return item.dutyPreferred
      ? Math.max(waiting + DUTY_URGENT_AFTER_MS, until - GENERAL_URGENT_AFTER_MS + DUTY_URGENT_AFTER_MS)
      : Math.max(waiting + GENERAL_URGENT_AFTER_MS, until);
  }
  // Without confirmed duty eligibility, never notify a non-duty broker early.
  return waiting + GENERAL_URGENT_AFTER_MS;
}
export type UrgentConversationSnapshot = {
  actorId: string;
  fetchedAt: number;
  leads: Pick<LeadProfile, 'id' | 'assignedTo' | 'lifecycleStatus'>[];
  attendance: ConversationAttendanceSummary[];
  messages: Pick<ConversationMessage, 'id' | 'leadId' | 'side' | 'createdAt'>[];
  inbox: ConversationInboxItem[];
};

/** A read receipt is not a reply, and an unread message is not proof of abandonment. */
export function urgentConversationCandidates({ snapshot, visibleLeadIds, currentBrokerId, ready, demonstration, now }: {
  snapshot: UrgentConversationSnapshot | null;
  visibleLeadIds: ReadonlySet<string>;
  currentBrokerId?: string;
  ready: boolean;
  demonstration: boolean;
  now: number;
}): { leadId: string; waitingSince: string }[] {
  if (!ready || demonstration || !currentBrokerId || !snapshot || snapshot.actorId !== currentBrokerId
    || !Number.isFinite(snapshot.fetchedAt) || !Number.isFinite(now)
    || now < snapshot.fetchedAt || now - snapshot.fetchedAt > URGENT_SNAPSHOT_MAX_AGE_MS) return [];
  const messages = new Map(snapshot.messages.map(message => [message.id, message]));
  const candidates: { leadId: string; waitingSince: string }[] = [];
  for (const lead of snapshot.leads) {
    if (!visibleLeadIds.has(lead.id) || lead.assignedTo !== null
      || !['Novo', 'Em atendimento', 'Visita', 'Proposta'].includes(lead.lifecycleStatus)) continue;
    const attendance = snapshot.attendance.filter(item => item.leadId === lead.id);
    // All channels must agree: never infer ownership from a label or stale unread count.
    // Automatic mode is allowed only with a confirmed incoming message still waiting
    // after the configured delay. A newer bot reply suppresses the notice below.
    if (!attendance.length || attendance.some(item => item.assignedTo !== null || item.assignedBrokerId !== null
      || !['paused', 'human', 'automatic'].includes(item.attendanceMode))) continue;
    const items = snapshot.inbox.filter(item => item.leadId === lead.id);
    if (!items.length || items.some(item => dutyPriorityBlocked(item, now)
      || (item.dutyPriorityUntil && !Number.isFinite(Date.parse(item.dutyPriorityUntil)))
      || !Number.isFinite(Date.parse(item.lastMessageAt)) || Date.parse(item.lastMessageAt) > now)) continue;
    const latest = [...items].sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)
      || b.lastMessageId.localeCompare(a.lastMessageId))[0];
    const message = messages.get(latest.lastMessageId);
    // The inbox may already be newer than the paginated history. Wait for confirmation.
    if (!latest.incomingCount || !message || message.leadId !== lead.id || message.side !== 'incoming') continue;
    const history = snapshot.messages.filter(item => item.leadId === lead.id && item.createdAt
      && Number.isFinite(Date.parse(item.createdAt)) && Date.parse(item.createdAt) <= Date.parse(latest.lastMessageAt))
      .sort((a, b) => Date.parse(a.createdAt!) - Date.parse(b.createdAt!) || a.id.localeCompare(b.id));
    const lastReplyIndex = history.findLastIndex(item => item.side === 'outgoing');
    const waitingSince = history.slice(lastReplyIndex + 1).find(item => item.side === 'incoming')?.createdAt || latest.lastMessageAt;
    const eligibleAt = urgentAlertEligibleAt(latest, waitingSince);
    if (eligibleAt === null || eligibleAt > now) continue;
    candidates.push({ leadId: lead.id, waitingSince });
  }
  return candidates.sort((a, b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince) || a.leadId.localeCompare(b.leadId));
}
