export type ConversationInboxItem = {
  conversationId: string; leadId: string; lastMessageId: string;
  lastMessageAt: string; lastMessageText: string | null; incomingCount: number; unread: number;
};
export type ConversationReadPosition = { conversationId: string; position: number };

export function inboxByLead(items: ConversationInboxItem[]) {
  const result = new Map<string, ConversationInboxItem>();
  for (const item of items) {
    const previous = result.get(item.leadId);
    if (!previous) result.set(item.leadId, {...item});
    else {
      const latest = Date.parse(item.lastMessageAt) > Date.parse(previous.lastMessageAt) ? item : previous;
      result.set(item.leadId, {...latest, unread: previous.unread + item.unread});
    }
  }
  return result;
}

export function compareInboxActivity(left?: {lastMessageAt?: string; lastMessageId?: string}, right?: {lastMessageAt?: string; lastMessageId?: string}) {
  return (Date.parse(right?.lastMessageAt || '') || 0) - (Date.parse(left?.lastMessageAt || '') || 0)
    || (right?.lastMessageId || '').localeCompare(left?.lastMessageId || '');
}
