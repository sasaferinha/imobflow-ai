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
  const cases = new Map(records.filter(record => record.kind === 'cases').map(record => [record.id, record]));
  const latestWins = new Map<string, string>();
  const edited = new Set<string>();
  const reopened = new Set<string>();
  for (const event of state.events) {
    if (!cases.has(event.recordId)) continue;
    if (event.changes?.status?.to === 'Ganho' && Number.isFinite(Date.parse(event.at))) {
      const previous = latestWins.get(event.recordId);
      if (!previous || Date.parse(event.at) >= Date.parse(previous)) latestWins.set(event.recordId, event.at);
    }
    if (!inside(event.at)) continue;
    if (event.changes?.status?.from === 'Ganho' && event.changes.status.to === 'Aberto') reopened.add(event.id);
    if (event.registration?.action === 'correct_close') {
      try {
        const correction = JSON.parse(event.registration.fingerprint);
        if (correction?.caseId === event.recordId && correction.data?.mode === 'edit') edited.add(event.registration.requestId);
      } catch { /* An incomplete historical event is not evidence of a correction. */ }
    }
  }
  // The current confirmed outcome uses its latest actual acceptance, not an old
  // win that was undone and then confirmed again in another reporting week.
  const won = [...latestWins].filter(([id, at]) => cases.get(id)?.data.status === 'Ganho' && inside(at)).length;
  const currentOpen = records.filter(r => r.kind === 'cases' && r.data.status === 'Aberto').length;
  const overdue = records.filter(r => r.kind === 'followups' && ['Pendente','Em andamento'].includes(String(r.data.status)) && Date.parse(String(r.data.dueAt)) < now.getTime()).length;
  return { ...week, title: `Resumo semanal · ${week.key}`, text: [
    `Período: ${week.start.slice(0, 10)} a ${new Date(Date.parse(week.end) - 86400000).toISOString().slice(0, 10)} (São Paulo).`,
    `Novos leads: ${count('leads')}. Novos atendimentos: ${count('cases')}. Imóveis cadastrados: ${count('properties')}.`,
    `Propostas criadas: ${count('proposals')}. Fechamentos registrados na semana e ainda confirmados: ${won}.`,
    `Correções de dados de fechamento na semana: ${edited.size}. Fechamentos desfeitos na semana: ${reopened.size}.`,
    `Na geração deste relatório: ${currentOpen} atendimentos abertos e ${overdue} cobranças vencidas.`,
    'Resumo interno automático, sem envio de mensagens ou emails. Contagens de criação usam a data original do cadastro; resultados só incluem eventos registrados no CRM, sem reconstruir histórico ausente. Fechamentos consideram a última confirmação dos atendimentos que permanecem ganhos na geração deste resumo; os desfeitos ficam fora do total. Correções e estornos contam ações registradas no período.',
  ].join('\n') };
}
