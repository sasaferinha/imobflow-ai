import { createHash, createHmac, randomUUID } from 'node:crypto';
import { supabaseServiceRequest } from '../supabase';
import { canAccess, CrmError, type Actor, type CrmCommand, type CrmRecord, type CrmState } from './model';

type FeedbackRow = { id: string; company_id: string; case_key: string; property_key: string; property_name: string; purpose: string; token_hash: string; expires_at: string; created_at: string; submitted_at: string | null; visit_score: number | null; property_score: number | null; interest: string | null; comment: string | null; outbox_message_id: string | null; visit_key: string | null; visit_started_at: string | null; visit_ended_at: string | null; visit_broker_id: string | null; person_key: string | null };
export type FeedbackTarget = { caseId: string; visitId?: string };
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
/** A visit selects its own property, never the current property of its case. */
export function feedbackVisit(state: CrmState, item: CrmRecord, visitId?: string) {
  const visits = state.records.filter(record => record.kind === 'tasks' && record.data.caseId === item.id && record.data.type === 'Visita' && record.data.status === 'Realizada' && record.data.propertyId);
  if (visitId) {
    const visit = visits.find(record => record.id === visitId);
    if (!visit || !visit.data.visitStartedAt || !visit.data.visitEndedAt) throw new CrmError('Encerre esta visita antes de obter sua avaliação.');
    return visit;
  }
  if (visits.length > 1) throw new CrmError('Escolha a visita que deseja avaliar para vincular o imóvel e o cliente corretos.');
  return visits[0];
}
export function feedbackProperty(state: CrmState, item: CrmRecord, visitId?: string) {
  const visit = feedbackVisit(state, item, visitId);
  const id = visit?.data.propertyId || (item.data.stage === 'Negociado' && item.data.status === 'Ganho' ? item.data.propertyId : '');
  const property = state.records.find(record => record.kind === 'properties' && record.id === id);
  if (!property) throw new CrmError('Conclua uma visita ou a negociação e vincule o imóvel antes de solicitar a avaliação.');
  return property;
}
export async function listCaseFeedback(actor: Actor, state: CrmState, caseId: string, visitId?: string) {
  const item = authorizedCase(actor, state, caseId);
  if (visitId) { const visit = feedbackVisit(state, item, visitId); if (!visit || !canAccess(state, actor, visit)) throw new CrmError('Visita indisponível.', 404); }
  const rows = await supabaseServiceRequest<FeedbackRow[]>(`property_feedback_requests?company_id=eq.${encodeURIComponent(actor.companyId)}&case_key=eq.${encodeURIComponent(caseId)}${visitId ? `&visit_key=eq.${encodeURIComponent(visitId)}` : ''}&select=*&order=created_at.desc&limit=50`);
  return Promise.all(rows.map(async row => {
    if (row.company_id !== actor.companyId || row.case_key !== caseId || (visitId && row.visit_key !== visitId)) throw new Error('feedback_scope');
    let deliveryStatus: string | null = null;
    if (row.outbox_message_id) {
      const messages = await supabaseServiceRequest<Array<{ state: string }>>(`message_outbox?company_id=eq.${encodeURIComponent(actor.companyId)}&id=eq.${encodeURIComponent(row.outbox_message_id)}&select=state&limit=1`);
      deliveryStatus = messages[0]?.state || 'uncertain';
    }
    return { id: row.id, propertyName: row.property_name, visitId: row.visit_key, visitStartedAt: row.visit_started_at, visitEndedAt: row.visit_ended_at,
      brokerName: state.members.find(member => member.id === row.visit_broker_id)?.name || null,
      expiresAt: row.expires_at, createdAt: row.created_at, submittedAt: row.submitted_at, visitScore: row.visit_score, propertyScore: row.property_score, interest: row.interest, comment: row.comment, deliveryStatus, url: row.submitted_at || Date.parse(row.expires_at) <= Date.now() ? null : feedbackUrl(row) };
  }));
}
/** Link creation never sends a message, including calls from older clients. */
export async function ensureCaseFeedback(actor: Actor, state: CrmState, caseId: string, _legacySend = false, visitId?: string) {
  void _legacySend; // Preserve old callers without reintroducing automatic delivery.
  const item = authorizedCase(actor, state, caseId, true), visit = feedbackVisit(state, item, visitId), property = feedbackProperty(state, item, visitId);
  if (!canAccess(state, actor, property) || (visit && !canAccess(state, actor, visit))) throw new CrmError('Imóvel ou visita indisponível.', 404);
  const contact = state.records.find(record => record.kind === 'people' && record.id === item.data.personId);
  const source = item.legacy?.table === 'leads' ? item.legacy : contact?.legacy?.table === 'leads' ? contact.legacy : undefined;
  const id = randomUUID(), token = feedbackToken(id), exactVisit = visit && visit.data.visitStartedAt && visit.data.visitEndedAt;
  const row = await supabaseServiceRequest<FeedbackRow>(exactVisit ? 'rpc/ensure_visit_feedback_request' : 'rpc/ensure_property_feedback_request', { method: 'POST', body: {
    p_company_id: actor.companyId, p_actor_id: actor.brokerId, p_id: id, p_case_key: item.id, p_property_key: property.id,
    p_lead_id: source?.id || null, p_property_name: String(property.data.name).slice(0, 300), p_purpose: property.data.purpose,
    p_token_hash: feedbackTokenHash(token), ...(exactVisit ? { p_visit_key: visit.id } : {}),
  } });
  if (row.company_id !== actor.companyId || row.case_key !== caseId || row.property_key !== property.id || (exactVisit && row.visit_key !== visit.id)) throw new Error('feedback_scope');
  return { reason: 'Link pronto. Copie e envie ao cliente quando desejar; nenhuma mensagem foi enviada.', requests: await listCaseFeedback(actor, state, caseId, visitId) };
}
export function feedbackTargetsForCommand(state: CrmState, command: CrmCommand): FeedbackTarget[] {
  if (command.type === 'visit-progress' && command.action === 'finish') {
    const visit = state.records.find(row => row.id === command.id && row.kind === 'tasks');
    return visit?.data.caseId ? [{ caseId: String(visit.data.caseId), visitId: visit.id }] : [];
  }
  return [];
}
export function feedbackCaseIdsForCommand(state: CrmState, command: CrmCommand): string[] { return feedbackTargetsForCommand(state, command).map(target => target.caseId); }
export async function getPublicFeedback(token: string) {
  if (!validFeedbackToken(token)) return null;
  const rows = await supabaseServiceRequest<Array<{ company_id: string; property_name: string; purpose: string; submitted_at: string | null; expires_at: string; visit_ended_at: string | null }>>(`property_feedback_requests?token_hash=eq.${feedbackTokenHash(token)}&select=company_id,property_name,purpose,submitted_at,expires_at,visit_ended_at&limit=1`);
  const row = rows[0];
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  const [company] = await supabaseServiceRequest<Array<{ name: string }>>(`companies?id=eq.${encodeURIComponent(row.company_id)}&select=name&limit=1`);
  let brandName = company?.name || 'Sua imobiliária', logoUrl = '', primaryColor = '#147bb6';
  try {
    const [website] = await supabaseServiceRequest<Array<{ published: { brandName?: unknown; logoUrl?: unknown; primaryColor?: unknown } | null }>>(`company_websites?company_id=eq.${encodeURIComponent(row.company_id)}&select=published&limit=1`);
    const content = website?.published;
    if (typeof content?.brandName === 'string' && content.brandName.trim()) brandName = content.brandName.slice(0, 120);
    if (typeof content?.primaryColor === 'string' && /^#[a-f0-9]{6}$/i.test(content.primaryColor)) primaryColor = content.primaryColor;
    if (typeof content?.logoUrl === 'string' && content.logoUrl.length <= 2048) { const url = new URL(content.logoUrl); if (url.protocol === 'https:' && !url.username && !url.password) logoUrl = url.href; }
  } catch { /* Company name remains available without a published website. */ }
  return { propertyName: row.property_name, purpose: row.purpose, submitted: Boolean(row.submitted_at), visitEndedAt: row.visit_ended_at, brandName, logoUrl, primaryColor };
}
export function validateFeedbackAnswer(raw: unknown): { visitScore: number | null; propertyScore: number; interest: string | null; comment: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => !['visitScore', 'propertyScore', 'interest', 'comment'].includes(key))
    || (body.visitScore !== undefined && body.visitScore !== null && (!Number.isInteger(body.visitScore) || Number(body.visitScore) < 0 || Number(body.visitScore) > 5))
    || !Number.isInteger(body.propertyScore) || Number(body.propertyScore) < 1 || Number(body.propertyScore) > 5
    || (body.interest !== undefined && body.interest !== null && (typeof body.interest !== 'string' || !['Sim', 'Talvez', 'Não'].includes(body.interest)))
    || (body.comment !== undefined && (typeof body.comment !== 'string' || body.comment.trim().length > 2000))) return null;
  return { visitScore: body.visitScore == null ? null : Number(body.visitScore), propertyScore: Number(body.propertyScore), interest: body.interest == null ? null : String(body.interest), comment: typeof body.comment === 'string' ? body.comment.trim() : '' };
}
