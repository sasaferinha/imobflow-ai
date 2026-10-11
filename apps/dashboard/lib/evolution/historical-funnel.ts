import { CAPTURE_STAGES, NEGOTIATION_STAGES } from './schema';
import type { CrmState } from './model';

export type HistoricalFunnelFilter = { from?: string; to?: string; purpose?: string; journey?: string; assignedTo?: string };
export type HistoricalFunnelRow = { stage: string; caseIds: string[]; count: number; cohortRate: number | null; previousStage: string | null; previousCaseIds: string[]; convertedCaseIds: string[]; conversionRate: number | null };

function dayBoundary(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const utc = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== value) return NaN;
  return utc + 3 * 3600000;
}

/** Read-only analysis of authorized case records; never creates historical events. */
export function historicalFunnel(state: CrmState, filter: HistoricalFunnelFilter = {}, now = new Date().toISOString()) {
  const asOf = Date.parse(now), start = filter.from ? dayBoundary(filter.from) : -Infinity;
  const end = filter.to ? dayBoundary(filter.to) + 86400000 : Infinity;
  const invalidRange = !Number.isFinite(asOf) || Number.isNaN(start) || Number.isNaN(end) || start >= end;
  const journey = filter.journey === 'Captação' ? 'Captação' : 'Negociação';
  const stages = journey === 'Captação' ? CAPTURE_STAGES : NEGOTIATION_STAGES;
  const cohort = state.records.filter(record => {
    const createdAt = Date.parse(record.createdAt);
    return !invalidRange && record.kind === 'cases' && record.data.journey === journey
      && Number.isFinite(createdAt) && createdAt <= asOf && createdAt >= start && createdAt < end
      && (!filter.purpose || record.data.purpose === filter.purpose)
      && (!filter.assignedTo || record.data.assignedTo === filter.assignedTo);
  });
  const cases = new Map(cohort.map(record => [record.id, record]));
  const evidence = new Map<string, Map<string, Set<number>>>();
  const validEvents = state.events.filter(event => {
    const record = cases.get(event.recordId), at = Date.parse(event.at);
    return record && Number.isFinite(at) && at >= Date.parse(record.createdAt) && at <= asOf;
  });
  const latestWin = new Map<string, number>();
  for (const event of validEvents) if (event.changes?.status?.to === 'Ganho') {
    latestWin.set(event.recordId, Math.max(latestWin.get(event.recordId) ?? -Infinity, Date.parse(event.at)));
  }
  const currentClosings = new Map<string, number>();
  for (const event of validEvents) {
    const record = cases.get(event.recordId)!;
    if (record.data.status === 'Ganho' && record.data.stage === 'Negociado'
      && record.data.closedAt === event.at && event.changes?.status?.to === 'Ganho'
      && event.changes.closedAt?.to === record.data.closedAt && latestWin.get(record.id) === Date.parse(event.at)) currentClosings.set(record.id, Date.parse(event.at));
  }
  const add = (caseId: string, stage: unknown, at: number) => {
    if (typeof stage !== 'string' || !stages.includes(stage)) return;
    if (stage === 'Negociado' && currentClosings.get(caseId) !== at) return;
    if (!evidence.has(caseId)) evidence.set(caseId, new Map());
    const history = evidence.get(caseId)!;
    if (!history.has(stage)) history.set(stage, new Set());
    history.get(stage)!.add(at);
  };
  const actions: Record<string, string> = { lead: 'Lead', attendance: 'Atendimento', schedule: 'Agendamento', visit: 'Visita', proposal: 'Proposta', close: 'Negociado' };
  const registrations = new Set<string>();
  for (const event of validEvents) {
    const at = Date.parse(event.at);
    add(event.recordId, event.changes?.stage?.to, at);
    if (!event.registration || registrations.has(event.registration.requestId)) continue;
    try {
      const payload = JSON.parse(event.registration.fingerprint);
      if (payload?.caseId !== event.recordId || payload.action !== event.registration.action) continue;
      // A follow-up attempt alone is not evidence of an additional attended stage.
      if (payload.action === 'attendance' && payload.data?.outcome !== 'Contato realizado') continue;
      registrations.add(event.registration.requestId);
      add(event.recordId, actions[payload.action], at);
    } catch { /* Missing/invalid evidence is reported, not reconstructed. */ }
  }
  const cohortIds = cohort.map(record => record.id);
  const rows: HistoricalFunnelRow[] = stages.map((stage, index) => {
    const caseIds = cohortIds.filter(id => evidence.get(id)?.has(stage));
    const previousStage = stages[index - 1] || null;
    const previousCaseIds = previousStage ? cohortIds.filter(id => evidence.get(id)?.has(previousStage)) : [];
    const convertedCaseIds = previousStage ? previousCaseIds.filter(id => {
      const previous = Math.min(...evidence.get(id)!.get(previousStage)!);
      return [...(evidence.get(id)?.get(stage) || [])].some(at => at >= previous);
    }) : [];
    return { stage, caseIds, count: caseIds.length, cohortRate: cohortIds.length ? caseIds.length / cohortIds.length : null, previousStage, previousCaseIds, convertedCaseIds, conversionRate: previousCaseIds.length ? convertedCaseIds.length / previousCaseIds.length : null };
  });
  return { cohortIds, noEvidenceIds: cohortIds.filter(id => !evidence.has(id)), rows, asOf: now, invalidRange };
}
