import { canAccess, freshness, type Actor, type CrmState } from './model';
import { NEGOTIATION_STAGES } from './schema';

/** The compact view reuses the same records; it never changes assignment/stages. */
export function mobileWorkspace(state: CrmState, actor: Actor, requestedBroker = '', now = new Date().toISOString()) {
  const brokerId = actor.role === 'owner' ? requestedBroker : actor.brokerId;
  const records = state.records.filter(record => canAccess(state, actor, record));
  const cases = records.filter(record => record.kind === 'cases' && record.data.journey === 'Negociação' && (!brokerId || record.data.assignedTo === brokerId));
  const caseIds = new Set(cases.map(record => record.id));
  const tasks = records.filter(record => record.kind === 'tasks' && caseIds.has(String(record.data.caseId)) && (!brokerId || record.data.assignedTo === brokerId));
  const time = Date.parse(now);
  const due = (value: unknown) => { const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER; };
  const activeVisits = tasks.filter(record => record.data.type === 'Visita' && ['Pendente', 'Confirmada'].includes(String(record.data.status)))
    .sort((a, b) => Number(Boolean(b.data.visitStartedAt)) - Number(Boolean(a.data.visitStartedAt)) || due(a.data.dueAt) - due(b.data.dueAt));
  const completedVisits = tasks.filter(record => record.data.type === 'Visita' && record.data.status === 'Realizada').sort((a,b) => due(b.data.visitEndedAt || b.data.dueAt) - due(a.data.visitEndedAt || a.data.dueAt));
  const pending = tasks.filter(record => record.data.type !== 'Visita' && ['Pendente', 'Confirmada'].includes(String(record.data.status)) && due(record.data.dueAt) <= time).sort((a,b) => due(a.data.dueAt) - due(b.data.dueAt));
  const open = cases.filter(record => record.data.status === 'Aberto');
  const review = open.filter(record => freshness(record, state.settings, now) === 'overdue' || due(record.data.nextActivityAt) <= time).sort((a,b) => due(a.data.nextActivityAt || a.updatedAt) - due(b.data.nextActivityAt || b.updatedAt));
  return { brokerId, open, activeVisits, completedVisits, pending, review,
    stages: NEGOTIATION_STAGES.map(stage => ({ stage, records: open.filter(record => record.data.stage === stage) })),
    won: cases.filter(record => record.data.status === 'Ganho').length };
}
