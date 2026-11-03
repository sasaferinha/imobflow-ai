import { createHash, createHmac, randomUUID } from 'node:crypto';
import { supabaseServiceRequest } from '../supabase';
import { sendQueuedMessage } from '../message-outbox';
import { canAccess, CrmError, type Actor, type CrmCommand, type CrmRecord, type CrmState } from './model';

type FeedbackRow = { id: string; company_id: string; case_key: string; property_key: string; property_name: string; purpose: string; token_hash: string; expires_at: string; created_at: string; submitted_at: string | null; visit_score: number | null; property_score: number | null; interest: string | null; comment: string | null; outbox_message_id: string | null };
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
export const feedbackTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const validFeedbackToken = (token: string) => tokenPattern.test(token);
export function feedbackToken(id: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('feedback_signing_unavailable');
  return `${id}.${createHmac('sha256', secret).update(`imobflow:property-feedback:v1:${id}`).digest('base64url')}`;
}
function publicOrigin() {
  const url = new URL(process.env.APP_BASE_URL || process.env.SITE_URL || 'http://localhost:3000');
  if (url.username || url.password || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('feedback_origin_unavailable');
  return url.origin;
}
function feedbackUrl(row: FeedbackRow) {
  const token = feedbackToken(row.id);
  return feedbackTokenHash(token) === row.token_hash ? `${publicOrigin()}/avaliacao/${token}` : null;
}
function authorizedCase(actor: Actor, state: CrmState, caseId: string, write = false) {
  const item = state.records.find(record => record.id === caseId && record.kind === 'cases');
  if (!item || !canAccess(state, actor, item, write ? 'write' : 'read')) throw new CrmError('Atendimento indisponível.', 404);
  return item;
}
export function feedbackProperty(state: CrmState, item: CrmRecord) {
  const finished = state.records.filter(record => record.kind === 'tasks' && record.data.caseId === item.id && record.data.type === 'Visita' && record.data.status === 'Realizada' && record.data.propertyId);
  const propertyIds = [...new Set(finished.map(record => String(record.data.propertyId)))];
  const id = item.data.propertyId || (propertyIds.length === 1 ? propertyIds[0] : '');
  const eligible = item.data.stage === 'Negociado' && item.data.status === 'Ganho' || finished.some(record => record.data.propertyId === id);
  const property = state.records.find(record => record.kind === 'properties' && record.id === id);
  if (!eligible || !property) throw new CrmError('Conclua uma visita ou a negociação e vincule o imóvel antes de solicitar a avaliação.');
  return property;
}
export async function listCaseFeedback(actor: Actor, state: CrmState, caseId: string) {
  authorizedCase(actor, state, caseId);
  const rows = await supabaseServiceRequest<FeedbackRow[]>(`property_feedback_requests?company_id=eq.${encodeURIComponent(actor.companyId)}&case_key=eq.${encodeURIComponent(caseId)}&select=*&order=created_at.desc&limit=20`);
  return Promise.all(rows.map(async row => {
    let deliveryStatus: string | null = null;
    if (row.outbox_message_id) {
      const messages = await supabaseServiceRequest<Array<{ state: string }>>(`message_outbox?company_id=eq.${encodeURIComponent(actor.companyId)}&id=eq.${encodeURIComponent(row.outbox_message_id)}&select=state&limit=1`);
      deliveryStatus = messages[0]?.state || 'uncertain';
    }
    return { id: row.id, propertyName: row.property_name, expiresAt: row.expires_at, createdAt: row.created_at, submittedAt: row.submitted_at, visitScore: row.visit_score, propertyScore: row.property_score, interest: row.interest, comment: row.comment, deliveryStatus, url: row.submitted_at || Date.parse(row.expires_at) <= Date.now() ? null : feedbackUrl(row) };
  }));
}
export async function ensureCaseFeedback(actor: Actor, state: CrmState, caseId: string, send: boolean) {
  const item = authorizedCase(actor, state, caseId, true);
  const property = feedbackProperty(state, item);
  if (!canAccess(state, actor, property)) throw new CrmError('Imóvel indisponível.', 404);
  const contact = state.records.find(record => record.kind === 'people' && record.id === item.data.personId);
  const source = item.legacy?.table === 'leads' ? item.legacy : contact?.legacy?.table === 'leads' ? contact.legacy : undefined;
  const id = randomUUID(), token = feedbackToken(id);
  const row = await supabaseServiceRequest<FeedbackRow>('rpc/ensure_property_feedback_request', { method: 'POST', body: {
    p_company_id: actor.companyId, p_actor_id: actor.brokerId, p_id: id, p_case_key: item.id, p_property_key: property.id,
    p_lead_id: source?.id || null, p_property_name: String(property.data.name).slice(0, 300), p_purpose: property.data.purpose,
    p_token_hash: feedbackTokenHash(token),
  } });
  let reason = 'Link pronto para enviar ao cliente.';
  const url = feedbackUrl(row);
  if (send && url && !row.submitted_at && Date.parse(row.expires_at) > Date.now()) {
    const queued = await supabaseServiceRequest<{ outboxId?: string; reason?: string }>('rpc/queue_property_feedback', { method: 'POST', body: {
      p_company_id: actor.companyId, p_actor_id: actor.brokerId, p_request_id: row.id,
      p_content: `Queremos saber sua opinião sobre a visita e o imóvel. Avalie sua experiência por este link: ${url}`,
    } });
    reason = queued.reason || 'Avaliação colocada na fila do WhatsApp. Confira o status de entrega.';
    if (queued.outboxId) await sendQueuedMessage(actor.companyId, queued.outboxId);
  }
  return { reason, requests: await listCaseFeedback(actor, state, caseId) };
}

export function feedbackCaseIdsForCommand(state: CrmState, command: CrmCommand): string[] {
  if (command.type === 'register' && ['close', 'visit'].includes(command.action)) return [command.caseId];
  if (command.type === 'visit-progress' && command.action === 'finish') {
    const record = state.records.find(row => row.id === command.id && row.kind === 'tasks');
    return record?.data.caseId ? [String(record.data.caseId)] : [];
  }
  if (command.type === 'save' && ['tasks', 'proposals'].includes(command.kind)) {
    if (!command.id && typeof command.data.caseId === 'string' && ['Realizada', 'Aceita'].includes(String(command.data.status))) return [command.data.caseId];
    const record = state.records.find(row => row.id === command.id && row.kind === command.kind);
    return record?.data.caseId && (record.kind === 'tasks' && record.data.type === 'Visita' && record.data.status === 'Realizada' || record.kind === 'proposals' && record.data.status === 'Aceita') ? [String(record.data.caseId)] : [];
  }
  return [];
}
export async function getPublicFeedback(token: string) {
  if (!validFeedbackToken(token)) return null;
  const rows = await supabaseServiceRequest<Array<{ property_name: string; purpose: string; submitted_at: string | null; expires_at: string }>>(`property_feedback_requests?token_hash=eq.${feedbackTokenHash(token)}&select=property_name,purpose,submitted_at,expires_at&limit=1`);
  const row = rows[0];
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return { propertyName: row.property_name, purpose: row.purpose, submitted: Boolean(row.submitted_at) };
}
export function validateFeedbackAnswer(raw: unknown): { visitScore: number; propertyScore: number; interest: string; comment: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => !['visitScore', 'propertyScore', 'interest', 'comment'].includes(key))
    || !Number.isInteger(body.visitScore) || Number(body.visitScore) < 0 || Number(body.visitScore) > 5
    || !Number.isInteger(body.propertyScore) || Number(body.propertyScore) < 1 || Number(body.propertyScore) > 5
    || typeof body.interest !== 'string' || !['Sim', 'Talvez', 'Não'].includes(body.interest)
    || typeof body.comment !== 'string' || body.comment.trim().length > 2000) return null;
  return { visitScore: Number(body.visitScore), propertyScore: Number(body.propertyScore), interest: body.interest, comment: body.comment.trim() };
}
