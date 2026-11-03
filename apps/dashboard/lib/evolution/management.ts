import type { Actor, CaseFilter, CrmRecord, CrmState } from './model';

export type CommissionRule = { brokerId: string; salePercent: number; rentPercent: number; fixedAmount: number; notes: string };
export type ManagementSettings = { commissions: CommissionRule[]; blockNewLeads: boolean; registrationRequired: boolean; overdueTasksBlock: boolean; graceHours: number; offlineFallbackMinutes: number };
export type CommissionSnapshot = { brokerId: string; amount: number; dealAmount: number; ratePercent: number; fixedAmount: number; calculatedAt: string };
export const DEFAULT_MANAGEMENT_SETTINGS: ManagementSettings = { commissions: [], blockNewLeads: false, registrationRequired: true, overdueTasksBlock: false, graceHours: 24, offlineFallbackMinutes: 5 };
export function managementSettings(state: Pick<CrmState, 'settings'>): ManagementSettings { return { ...DEFAULT_MANAGEMENT_SETTINGS, ...state.settings.management }; }

export function validateManagementSettings(value: unknown, state: CrmState): ManagementSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuração de gestão inválida.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(DEFAULT_MANAGEMENT_SETTINGS, key))) throw new Error('Regra de gestão não permitida.');
  const result = { ...managementSettings(state), ...input } as ManagementSettings;
  if (['blockNewLeads', 'registrationRequired', 'overdueTasksBlock'].some(key => typeof result[key as keyof ManagementSettings] !== 'boolean')) throw new Error('Ative ou desative as regras de atendimento.');
  if (!Number.isInteger(result.graceHours) || result.graceHours < 1 || result.graceHours > 8760) throw new Error('O prazo para regularização deve ser de 1 a 8760 horas.');
  if (!Number.isInteger(result.offlineFallbackMinutes) || result.offlineFallbackMinutes < 5 || result.offlineFallbackMinutes > 60) throw new Error('O aviso para corretores offline deve aguardar de 5 a 60 minutos.');
  if (!Array.isArray(result.commissions) || result.commissions.length > 500) throw new Error('Lista de comissões inválida.');
  const seen = new Set<string>();
  result.commissions = result.commissions.map(rule => {
    if (!rule || typeof rule !== 'object' || Object.keys(rule).some(key => !['brokerId','salePercent','rentPercent','fixedAmount','notes'].includes(key)) || typeof rule.brokerId !== 'string' || seen.has(rule.brokerId) || !state.members.some(member => member.id === rule.brokerId)) throw new Error('Selecione um responsável válido e sem duplicação para a comissão.');
    seen.add(rule.brokerId);
    if (![rule.salePercent, rule.rentPercent, rule.fixedAmount].every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0) || rule.salePercent > 100 || rule.rentPercent > 100 || rule.fixedAmount > 1e9) throw new Error('Comissão: percentuais de 0 a 100 e valor fixo positivo.');
    if (typeof rule.notes !== 'string' || rule.notes.length > 2000) throw new Error('Descreva a regra de comissão em até 2000 caracteres.');
    return { ...rule, notes: rule.notes.trim() };
  });
  return result;
}

/** Filters are enforced for personal indicators even when a shared module grants read access. */
export function personalFunnelFilter(actor: Actor, filter: CaseFilter): CaseFilter {
  return actor.role === 'owner' ? filter : { ...filter, assignedTo: actor.brokerId };
}

/** Snapshot on acceptance; later changes to a broker's rule do not rewrite earned commissions. */
export function commissionForClosing(state: CrmState, record: CrmRecord, amount: number, now: string): CommissionSnapshot | undefined {
  const rule = managementSettings(state).commissions.find(item => item.brokerId === record.data.assignedTo);
  if (!rule || !Number.isFinite(amount) || amount <= 0) return undefined;
  const ratePercent = record.data.purpose === 'Aluguel' ? rule.rentPercent : rule.salePercent;
  return { brokerId: rule.brokerId, dealAmount: amount, ratePercent, fixedAmount: rule.fixedAmount, amount: Math.round((amount * ratePercent / 100 + rule.fixedAmount) * 100) / 100, calculatedAt: now };
}

export type ComplianceIssue = { caseId: string; recordId: string; message: string };
export function brokerComplianceIssues(state: CrmState, brokerId: string, now = new Date().toISOString()): ComplianceIssue[] {
  const config = managementSettings(state), time = Date.parse(now);
  if (!config.blockNewLeads || !Number.isFinite(time) || state.members.find(member => member.id === brokerId)?.role === 'owner') return [];
  const cases = state.records.filter(record => record.kind === 'cases' && record.data.assignedTo === brokerId && record.data.status === 'Aberto');
  const issues: ComplianceIssue[] = [];
  for (const record of cases) {
    const base = Date.parse(String(record.data.assignedAt || record.createdAt));
    if (!Number.isFinite(base) || time - base < config.graceHours * 3600000) continue;
    if (config.registrationRequired && record.data.journey !== 'Captação' && !state.events.some(event => (event.caseId === record.id || event.recordId === record.id) && event.actorId === brokerId && Date.parse(event.at) >= base && (event.registration && ['attendance','schedule','visit','proposal','close'].includes(event.registration.action) || event.changes?.visitStartedAt?.to || event.changes?.visitEndedAt?.to))) issues.push({ caseId: record.id, recordId: record.id, message: `Registre o atendimento de ${String(record.data.name || 'um cliente')}.` });
    if (config.overdueTasksBlock) for (const task of state.records.filter(item => item.kind === 'tasks' && item.data.caseId === record.id && ['Pendente','Confirmada'].includes(String(item.data.status)) && Date.parse(String(item.data.dueAt)) + config.graceHours * 3600000 <= time)) issues.push({ caseId: record.id, recordId: task.id, message: `Conclua ou reagende ${String(task.data.name || 'a atividade pendente')}.` });
  }
  return issues;
}
