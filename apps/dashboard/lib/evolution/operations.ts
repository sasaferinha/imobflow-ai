import type { CrmMember, CrmRecord, CrmState, Value } from './model';

export type OperationsSettings = {
  funnelEnabled: boolean;
  requireCompleteCatalog: boolean;
  requireAttendanceBeforeSchedule: boolean;
  requireVisitBeforeProposal: boolean;
  reassignmentEnabled: boolean;
  reassignmentDays: number;
  includeIncomplete: boolean;
  preferOnDuty: boolean;
  weeklyReportsEnabled: boolean;
};
export const DEFAULT_OPERATIONS_SETTINGS: Readonly<OperationsSettings> = Object.freeze({
  funnelEnabled: false, requireCompleteCatalog: false, requireAttendanceBeforeSchedule: false,
  requireVisitBeforeProposal: false, reassignmentEnabled: false, reassignmentDays: 30,
  includeIncomplete: true, preferOnDuty: true, weeklyReportsEnabled: false,
});
export function operationsSettings(state: Pick<CrmState, 'settings'>): OperationsSettings {
  return { ...DEFAULT_OPERATIONS_SETTINGS, ...state.settings.operations };
}
const placeholders = new Set(['nao informado','nao informada','nao definido','nao definida','a definir','desconhecido','desconhecida','nao identificado','nao identificada']);
const present = (value: Value | undefined) => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && Boolean(value.trim()) && !placeholders.has(value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase());
const linkedPerson = (state: CrmState, record: CrmRecord) => state.records.find(r => r.kind === 'people' && r.id === record.data.personId);
/** Missing information is explicit: zero is valid for room counts, never for a budget. */
export function catalogCompleteness(state: CrmState, record: CrmRecord): { complete: boolean; percent: number; missing: string[] } {
  const d = record.data;
  let fields: Array<[string, boolean]> = [];
  if (record.kind === 'people') fields = [['Nome', present(d.name)],['Telefone ou email',present(d.phone)||present(d.email)],['Categoria',present(d.category)],['Responsável',present(d.assignedTo)]];
  if (record.kind === 'leads') {
    const person = linkedPerson(state, record);
    fields = [['Nome',present(d.name)],['Pessoa vinculada',Boolean(person)],['Telefone ou email',Boolean(person && (present(person.data.phone)||present(person.data.email)))],['Responsável',present(d.assignedTo)],['Origem',present(d.source)],['Finalidade',['Venda','Aluguel'].includes(String(d.purpose))],['Tipo de imóvel',present(d.propertyType)],['Cidade ou região',present(d.city)||present(d.region)],['Orçamento máximo',Number(d.budgetMax)>0]];
  }
  if (record.kind === 'properties') fields = [['Título',present(d.name)],['Código',present(d.code)],['Finalidade',present(d.purpose)],['Preço',Number(d.price)>0],['Responsável',present(d.assignedTo)],['Tipo de imóvel',present(d.propertyType)],['Cidade',present(d.city)],['Bairro',present(d.district)||present(d.neighborhoodId)],['Endereço',present(d.address)],['Área',Number(d.area)>0],['Descrição',present(d.description)],['Foto',present(d.photoUrl)]];
  const missing = fields.filter(([,ok])=>!ok).map(([name])=>name);
  return { complete: missing.length === 0, percent: fields.length ? Math.round(100 * (fields.length - missing.length) / fields.length) : 100, missing };
}
export function captureGoalProgress(state: CrmState, goal: CrmRecord) {
  const month = String(goal.data.month);
  const actual = state.records.filter(r => r.kind === 'properties' && r.data.assignedTo === goal.data.assignedTo && r.data.purpose === goal.data.purpose && Number.isFinite(Date.parse(r.createdAt)) && new Date(Date.parse(r.createdAt)-3*3600000).toISOString().slice(0,7) === month).length;
  const target = Number(goal.data.target) || 0;
  return { actual, target, percent: target > 0 ? Math.round(actual / target * 100) : 0, remaining: Math.max(0,target-actual) };
}
export function activeShifts(state: CrmState, now = new Date().toISOString()): CrmRecord[] {
  const time = Date.parse(now);
  return state.records.filter(r=>r.kind==='shifts' && r.data.status==='Ativo' && Date.parse(String(r.data.startsAt))<=time && Date.parse(String(r.data.endsAt))>time);
}
export type AssigneeRecommendation = Pick<CrmMember,'id'|'name'> & { onDuty: boolean; openCases: number };
export function recommendAssignees(state: CrmState, purpose: string, currentAssignee: string, now = new Date().toISOString()): AssigneeRecommendation[] {
  if (!['Venda','Aluguel'].includes(purpose)) return [];
  const shifts = activeShifts(state,now), preferDuty = operationsSettings(state).preferOnDuty;
  return state.members.filter(m=>m.role==='broker' && m.id!==currentAssignee && (m.specialization===purpose || m.specialization==='Ambos')).map(m=>({id:m.id,name:m.name,onDuty:shifts.some(s=>s.data.assignedTo===m.id && (s.data.purpose===purpose||s.data.purpose==='Ambos')),openCases:state.records.filter(r=>r.kind==='cases' && r.data.assignedTo===m.id && r.data.status==='Aberto').length})).sort((a,b)=>(preferDuty ? Number(b.onDuty)-Number(a.onDuty) : 0) || a.openCases-b.openCases || a.id.localeCompare(b.id));
}
export type RedistributionCandidate = { leadId: string; caseIds: string[]; assignedTo: string; daysInactive: number; incomplete: boolean; reason: string; recommendations: AssigneeRecommendation[] };
/** Suggestions only. Reassignment needs an explicit owner command with fresh CAS. */
export function redistributionCandidates(state: CrmState, now = new Date().toISOString()): RedistributionCandidate[] {
  const settings = operationsSettings(state);
  if (!settings.reassignmentEnabled) return [];
  const time = Date.parse(now), result: RedistributionCandidate[] = [];
  for (const lead of state.records.filter(r=>r.kind==='leads' && r.data.status!=='Descartado' && !['Convertido','Descartado'].includes(String(r.legacy?.lifecycleStatus)))) {
    const cases = state.records.filter(r=>r.kind==='cases' && r.data.leadId===lead.id);
    // Do not steal a portfolio with an active appointment, negotiation or confirmed outcome.
    if (cases.some(r=>r.data.status!=='Aberto')) continue;
    const caseIds = cases.map(r=>r.id);
    if (state.records.some(r=>caseIds.includes(String(r.data.caseId)) && (r.kind==='proposals' && ['Enviada','Em negociação','Aceita'].includes(String(r.data.status)) || r.kind==='tasks' && ['Pendente','Confirmada'].includes(String(r.data.status)) && Date.parse(String(r.data.dueAt))>=time))) continue;
    const latest = Math.max(Date.parse(lead.updatedAt),...cases.map(r=>Date.parse(r.updatedAt)),...state.events.filter(e=>e.recordId===lead.id || caseIds.includes(e.recordId) || caseIds.includes(e.caseId||'')).map(e=>Date.parse(e.at)));
    if (!Number.isFinite(latest)) continue;
    const daysInactive = Math.max(0,Math.floor((time-latest)/86400000));
    const incomplete = !catalogCompleteness(state,lead).complete;
    if (daysInactive < settings.reassignmentDays) continue;
    if (incomplete && !settings.includeIncomplete) continue;
    const assignedTo = String(lead.data.assignedTo||'');
    result.push({leadId:lead.id,caseIds,assignedTo,daysInactive,incomplete,reason:incomplete?'Sem atualização e cadastro incompleto':'Sem atualização no período configurado',recommendations:recommendAssignees(state,String(lead.data.purpose),assignedTo,now)});
  }
  return result.sort((a,b)=>b.daysInactive-a.daysInactive || a.leadId.localeCompare(b.leadId));
}
export function operationsSummary(state: CrmState, now = new Date().toISOString()) {
  const followups = state.records.filter(r=>r.kind==='followups');
  const pending = followups.filter(r=>['Pendente','Em andamento'].includes(String(r.data.status)));
  const catalog = state.records.filter(r=>['people','leads','properties'].includes(r.kind));
  const incomplete = catalog.filter(r=>!catalogCompleteness(state,r).complete).length;
  return { followups:{pending:pending.length,overdue:pending.filter(r=>Date.parse(String(r.data.dueAt))<Date.parse(now)).length,awaitingReview:followups.filter(r=>r.data.status==='Respondida').length,completed:followups.filter(r=>r.data.status==='Concluída').length}, catalog:{total:catalog.length,incomplete,complete:catalog.length-incomplete}, goals:state.records.filter(r=>r.kind==='captureGoals').map(goal=>({goal,...captureGoalProgress(state,goal)})),onDuty:activeShifts(state,now),redistribution:redistributionCandidates(state,now) };
}

/** Return a user-readable prerequisite, never infer a completed business event from text. */
export function funnelBlockReason(state: CrmState, record: CrmRecord, previous?: CrmRecord): string | null {
  const config = operationsSettings(state);
  if (!config.funnelEnabled || record.kind!=='cases' || record.data.journey!=='Negociação' || record.data.stage===previous?.data.stage) return null;
  const stages = ['Lead','Atendimento','Agendamento','Visita','Proposta','Negociado'];
  const target = stages.indexOf(String(record.data.stage));
  if (target <= stages.indexOf(String(previous?.data.stage||'Lead'))) return null;
  if (config.requireCompleteCatalog && target>=1) {
    const lead = state.records.find(r=>r.kind==='leads' && r.id===record.data.leadId);
    const completion = lead ? catalogCompleteness(state,lead) : null;
    if (!completion?.complete) return `Complete o cadastro antes de avançar: ${completion?.missing.join(', ') || 'lead vinculado ao atendimento'}. O contato foi preservado.`;
  }
  if (config.requireAttendanceBeforeSchedule && target>=2) {
    const attended = state.events.some(e=>e.recordId===record.id && (e.registration?.action==='attendance' || e.changes?.stage?.to==='Atendimento'));
    if (!attended) return 'Registre o atendimento antes de agendar ou avançar na negociação.';
  }
  if (config.requireVisitBeforeProposal && target>=4 && !state.records.some(r=>r.kind==='tasks' && r.data.caseId===record.id && r.data.type==='Visita' && r.data.status==='Realizada')) return 'Registre uma visita realizada antes de avançar para proposta. O gestor pode desativar essa exigência quando a visita não fizer parte do processo.';
  return null;
}
