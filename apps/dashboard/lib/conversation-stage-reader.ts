import { supabaseRequest } from './supabase';
import { automaticConversationStage, type AutomaticConversationStage, type ConversationStageMessage } from './conversation-stage';

type MessageRow = ConversationStageMessage & { company_id: string; conversation_id: string };
type DeliveryEvent = { external_message_id: string; status: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = 'id,company_id,conversation_id,direction,sender_type,created_at,delivery_status,external_message_id';
const MAX_OUTGOING_PAGES = 4;
class IncompleteStageEvidence extends Error {}

/**
 * Only enough metadata to prove engagement. A long transcript never needs to be
 * downloaded. Each conversation is classified independently, with four workers.
 * At most 10 requests per conversation. Unknown entries
 * are omitted when the evidence budget/time is exhausted; callers retain the
 * recorded canonical/manual stage, which may differ from a previous derived view.
 */
export async function readAutomaticConversationStages(companyId: string, conversationIds: readonly string[]): Promise<Map<string, AutomaticConversationStage>> {
  if (!uuid.test(companyId) || conversationIds.some(id => !uuid.test(id))) throw new Error('Identificador de conversa inválido.');
  const ids = [...new Set(conversationIds)];
  const stages = new Map<string, AutomaticConversationStage>();
  const request = async <T>(path: string): Promise<T> => {
    try { return await supabaseRequest<T>(path, { timeoutMs: 4000 }); }
    catch { throw new IncompleteStageEvidence(); }
  };
  const messages = async (conversationId: string, filters: Record<string, string>) => {
    const query = new URLSearchParams({ company_id: `eq.${companyId}`, conversation_id: `eq.${conversationId}`, select: columns, ...filters });
    const rows = await request<MessageRow[]>(`messages?${query}`);
    if (!Array.isArray(rows) || rows.length > Number(filters.limit) || rows.some(row => row.company_id !== companyId || row.conversation_id !== conversationId
      || !uuid.test(row.id) || !Number.isFinite(Date.parse(row.created_at)))) throw new Error('Não foi possível validar a etapa da conversa.');
    return rows;
  };
  const classify = async (conversationId: string) => {
    const incomingFilter = { direction: 'in.(incoming,Entrada)', sender_type: 'in.(client,Cliente)' };
    const first = await messages(conversationId, { ...incomingFilter, order: 'created_at.asc,id.asc', limit: '4' });
    // More than one customer message is necessary, regardless of agency follow-ups.
    if (first.length < 2) return 'Lead' as const;
    const latest = first.length < 4 ? first.at(-1)! : (await messages(conversationId, { ...incomingFilter, order: 'created_at.desc,id.desc', limit: '1' }))[0];
    if (!latest || Date.parse(latest.created_at) <= Date.parse(first[0].created_at)) return 'Lead' as const;
    const incoming = [...first, latest];
    const outgoing: MessageRow[] = [];
    let cursor: MessageRow | undefined;
    for (let pageNumber = 0; pageNumber < MAX_OUTGOING_PAGES && outgoing.length < 4; pageNumber += 1) {
      const filters: Record<string, string> = {
        direction: 'in.(outgoing,Saída,Saida)', sender_type: 'in.(human,ai,automation,Corretor,"Agente de IA")',
        created_at: `gt.${first[0].created_at}`,
        or: '(delivery_status.in.(sent,delivered,read),and(delivery_status.is.null,external_message_id.not.is.null))',
        order: 'created_at.asc,id.asc', limit: '4',
      };
      if (cursor) filters.and = `(or(created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})))`;
      const page = await messages(conversationId, filters);
      if (!page.length) break;
      const externalIds = [...new Set(page.map(row => row.external_message_id).filter((id): id is string => Boolean(id)))];
      const events = externalIds.length ? await request<DeliveryEvent[]>(`message_delivery_events?${new URLSearchParams({
        company_id: `eq.${companyId}`, external_message_id: `in.(${externalIds.map(id => JSON.stringify(id)).join(',')})`,
        select: 'external_message_id,status', limit: String(externalIds.length * 4),
      })}`) : [];
      if (!Array.isArray(events) || events.some(event => !externalIds.includes(event.external_message_id))) throw new Error('Não foi possível validar a entrega das mensagens.');
      for (const message of page) {
        const receipts = [message.delivery_status, ...events.filter(event => event.external_message_id === message.external_message_id).map(event => event.status)];
        // A delivery/read receipt wins over an earlier failed attempt.
        const failed = receipts.includes('failed') && !receipts.some(status => status === 'delivered' || status === 'read');
        if (!failed) outgoing.push(message);
      }
      const stage = automaticConversationStage([...incoming, ...outgoing]);
      if (stage === 'Atendimento') return stage;
      // Any later agency reply is also after the customer's last response.
      if (!outgoing.some(message => Date.parse(message.created_at) < Date.parse(latest.created_at))
        && Date.parse(page.at(-1)!.created_at) >= Date.parse(latest.created_at)) break;
      if (page.length < 4) break;
      if (pageNumber === MAX_OUTGOING_PAGES - 1 && outgoing.length < 4) throw new IncompleteStageEvidence();
      const next = page.at(-1)!;
      if (cursor && (Date.parse(next.created_at) < Date.parse(cursor.created_at)
        || (next.created_at === cursor.created_at && next.id <= cursor.id))) throw new Error('Não foi possível paginar a etapa da conversa.');
      cursor = next;
    }
    return automaticConversationStage([...incoming, ...outgoing]);
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const stage = await classify(id);
        if (stage) stages.set(id, stage);
      } catch (error) {
        if (!(error instanceof IncompleteStageEvidence)) throw error;
        console.warn('conversation_stage_evidence_incomplete');
      }
    }
  }));
  return stages;
}
