/** Commercial automation can identify engagement, never a visit or a deal. */
export type AutomaticConversationStage = 'Lead' | 'Atendimento';
export type ConversationStageMessage = {
  id: string;
  direction: string;
  sender_type?: string | null;
  created_at: string;
  delivery_status?: string | null;
  external_message_id?: string | null;
};

/**
 * More than three actual messages and a customer reply after the agency replied.
 * Queued/failed outgoing messages and repeated rows are not an exchange.
 * This reads message metadata only; content and AI interpretations cannot advance it.
 */
export function automaticConversationStage(messages: readonly ConversationStageMessage[]): AutomaticConversationStage {
  const unique = new Map<string, ConversationStageMessage>();
  for (const message of messages) {
    if (!message.id || !Number.isFinite(Date.parse(message.created_at))) continue;
    if (message.sender_type === 'system') continue;
    const incoming = ['incoming', 'Entrada'].includes(message.direction);
    // Older accepted provider replies predate delivery_status, but have a receipt.
    const sent = ['sent', 'delivered', 'read'].includes(message.delivery_status || '')
      || (message.delivery_status == null && Boolean(message.external_message_id));
    const outgoing = ['outgoing', 'Saída', 'Saida'].includes(message.direction) && sent;
    if (incoming || outgoing) unique.set(message.id, message);
  }
  const ordered = [...unique.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  let startedAt: number | undefined;
  let repliedAt: number | undefined;
  let customerReturned = false;
  let count = 0;
  for (const message of ordered) {
    const at = Date.parse(message.created_at);
    const incoming = ['incoming', 'Entrada'].includes(message.direction);
    if (startedAt === undefined) {
      if (!incoming) continue;
      startedAt = at;
    }
    count += 1;
    if (!incoming && at > startedAt && repliedAt === undefined) repliedAt = at;
    if (incoming && repliedAt !== undefined && at > repliedAt) customerReturned = true;
    if (count > 3 && customerReturned) return 'Atendimento';
  }
  return 'Lead';
}
