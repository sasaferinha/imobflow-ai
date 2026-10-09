import type { CrmState } from './model';

/** Previous complete calendar week in São Paulo, never a partial rolling window. */
export function previousReportWeek(now = new Date()) {
  const local = new Date(now.getTime() - 3 * 3600000);
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const end = new Date(monday.getTime() + 3 * 3600000);
  const start = new Date(end.getTime() - 7 * 86400000);
  return { key: start.toISOString().slice(0, 10), start: start.toISOString(), end: end.toISOString() };
}

export function weeklyReport(state: CrmState, now = new Date()) {
  const week = previousReportWeek(now);
  const inside = (value: string) => Date.parse(value) >= Date.parse(week.start) && Date.parse(value) < Date.parse(week.end);
  const records = state.records;
  const count = (kind: string) => records.filter(r => r.kind === kind && inside(r.createdAt)).length;
  const won = new Set(state.events.filter(e => inside(e.at) && e.changes?.status?.to === 'Ganho').map(e => e.caseId || e.recordId)).size;
  const currentOpen = records.filter(r => r.kind === 'cases' && r.data.status === 'Aberto').length;
  const overdue = records.filter(r => r.kind === 'followups' && ['Pendente','Em andamento'].includes(String(r.data.status)) && Date.parse(String(r.data.dueAt)) < now.getTime()).length;
  return { ...week, title: `Resumo semanal · ${week.key}`, text: [
    `Período: ${week.start.slice(0, 10)} a ${new Date(Date.parse(week.end) - 86400000).toISOString().slice(0, 10)} (São Paulo).`,
    `Novos leads: ${count('leads')}. Novos atendimentos: ${count('cases')}. Imóveis cadastrados: ${count('properties')}.`,
    `Propostas criadas: ${count('proposals')}. Resultados ganhos registrados no histórico: ${won}.`,
    `Na geração deste relatório: ${currentOpen} atendimentos abertos e ${overdue} cobranças vencidas.`,
    'Resumo interno automático, sem envio de mensagens ou emails. Contagens de criação usam a data original do cadastro; resultados só incluem eventos registrados no CRM, sem reconstruir histórico ausente.',
  ].join('\n') };
}
