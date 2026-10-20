import { supabaseRequest } from './supabase';
import { currentAccount } from './tenant-context';

export const INSTAGRAM_INBOX_LIMIT = 100;
export const INSTAGRAM_HISTORY_LIMIT = 40;
const SOURCE = 'Instagram Direct';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export type InstagramInboxMessage = { id: string; text: string; at: string };
export type InstagramInboxContact = {
  id: string;
  name: string;
  assignedTo: string | null;
  messages: InstagramInboxMessage[];
  lastMessageAt: string | null;
};
export type InstagramInbox = {
  contacts: InstagramInboxContact[];
  limit: 100;
  readOnly: true;
  connectionStatus: 'not_verified';
};

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 35) return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) return false;
  if (parts[5] !== 'Z' && (Number(parts[5].slice(1, 3)) > 23 || Number(parts[5].slice(4)) > 59)) return false;
  const day = Date.parse(`${parts[1]}T00:00:00Z`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === parts[1] && Number.isFinite(Date.parse(value));
}

/** Only stored text/timestamps are projected. Missing dates or text are never synthesized. */
export function instagramMessages(value: unknown): InstagramInboxMessage[] {
  if (!Array.isArray(value)) return [];
  const ordered: InstagramInboxMessage[] = [];
  for (const item of value) {
    const row = object(item);
    if (!row || typeof row.id !== 'string' || !row.id.trim() || row.id.length > 255 || /[\u0000-\u001f\u007f]/.test(row.id)) continue;
    if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2000 || !validTimestamp(row.at)) continue;
    // Text stays plain text: consumers must render it as text, never as HTML.
    ordered.push({ id: row.id, text: row.text, at: row.at });
  }
  ordered.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const latest = ordered.filter(message => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  }).slice(0, INSTAGRAM_HISTORY_LIMIT);
  return latest.reverse();
}

/** Defense in depth on the server query; never export the raw social profile. */
export function instagramInboxContacts(value: unknown, companyId: string): InstagramInboxContact[] {
  if (!UUID.test(companyId) || !Array.isArray(value)) throw new Error('instagram_inbox_unavailable');
  const contacts: InstagramInboxContact[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, INSTAGRAM_INBOX_LIMIT)) {
    const row = object(item);
    if (!row || row.company_id !== companyId || row.source !== SOURCE || typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id)) continue;
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200) continue;
    if (row.assigned_to !== null && row.assigned_to !== undefined && (typeof row.assigned_to !== 'string' || row.assigned_to.length > 160)) continue;
    seen.add(row.id);
    const messages = instagramMessages(row.social_messages);
    contacts.push({
      id: row.id,
      name: row.name,
      assignedTo: typeof row.assigned_to === 'string' && row.assigned_to.trim() ? row.assigned_to : null,
      messages,
      lastMessageAt: messages.at(-1)?.at ?? null,
    });
  }
  return contacts.sort((a, b) =>
    (b.lastMessageAt === null ? -Infinity : Date.parse(b.lastMessageAt)) - (a.lastMessageAt === null ? -Infinity : Date.parse(a.lastMessageAt)) ||
    a.id.localeCompare(b.id));
}

export async function readInstagramInbox(signal?: AbortSignal): Promise<InstagramInbox> {
  const actor = currentAccount();
  if (!actor || !UUID.test(actor.companyId) || !['owner', 'broker'].includes(actor.role)) throw new Error('instagram_inbox_unavailable');
  signal?.throwIfAborted();
  // ImobFlow uses custom server sessions, not a per-company Supabase JWT.
  // supabaseRequest currently delegates to the privileged transport: the
  // session-derived filter and returned-row checks are essential. This mirrors
  // the existing inbox's tenant-wide read scope for owners and brokers.
  // The selection is the 100 newest registered contacts, then ordered by their
  // retained messages below; it is not a complete/global activity history.
  const rows = await supabaseRequest<unknown>(
    `leads?company_id=eq.${encodeURIComponent(actor.companyId)}&source=eq.${encodeURIComponent(SOURCE)}&select=id,company_id,name,assigned_to,source,social_messages:interest_profile->socialMessages&order=created_at.desc,id.asc&limit=${INSTAGRAM_INBOX_LIMIT}`,
    { timeoutMs: 5000 },
  );
  // The shared transport has a bounded timeout but no caller-signal option.
  // Do not return a completed result after the requesting client has aborted.
  signal?.throwIfAborted();
  return {
    contacts: instagramInboxContacts(rows, actor.companyId),
    limit: INSTAGRAM_INBOX_LIMIT,
    readOnly: true,
    connectionStatus: 'not_verified',
  };
}
