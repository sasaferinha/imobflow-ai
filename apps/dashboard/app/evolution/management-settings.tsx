'use client';

import { useState } from 'react';
import type { CrmCommand, CrmState } from '@/lib/evolution/model';
import { brokerComplianceIssues, managementSettings, type CommissionRule } from '@/lib/evolution/management';
import s from './evolution.module.css';

export default function ManagementSettings({ state, busy, execute }: { state: CrmState; busy: boolean; execute: (command: CrmCommand) => Promise<boolean> }) {
  const [config, setConfig] = useState(() => managementSettings(state));
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>(state.settings.buyerReportFrequency || 'monthly');
  const ruleFor = (brokerId: string): CommissionRule => config.commissions.find(rule => rule.brokerId === brokerId) || { brokerId, salePercent: 0, rentPercent: 0, fixedAmount: 0, notes: '' };
  const updateRule = (brokerId: string, patch: Partial<CommissionRule>) => setConfig(current => ({ ...current, commissions: [...current.commissions.filter(rule => rule.brokerId !== brokerId), { ...ruleFor(brokerId), ...patch }] }));
  return <section className={s.panel}>
    <div className={s.panelHead}><div><h2>Comissões e regras da equipe</h2><p>Condições definidas pelo administrador</p></div></div>
    <form className={s.settingsBody} onSubmit={async event => { event.preventDefault(); await execute({ type: 'settings', settings: { management: config, buyerReportFrequency: frequency } }); }}>
      <p>Comissão estimada = valor da proposta aceita × percentual + valor fixo. Para aluguel, a base é o aluguel mensal. O cálculo fica preservado no fechamento; mudanças nas regras valem para os próximos negócios.</p>
      <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Responsável</th><th>Venda (%)</th><th>Aluguel (%)</th><th>Fixo por negócio (R$)</th><th>Condições</th></tr></thead><tbody>{state.members.map(member => { const rule = ruleFor(member.id); return <tr key={member.id}><td>{member.name}</td>{(['salePercent', 'rentPercent', 'fixedAmount'] as const).map(key => <td key={key}><input aria-label={`${member.name}: ${key === 'salePercent' ? 'comissão venda' : key === 'rentPercent' ? 'comissão aluguel' : 'comissão fixa'}`} type="number" min="0" max={key === 'fixedAmount' ? 1000000000 : 100} step="0.01" value={rule[key]} onChange={event => updateRule(member.id, { [key]: Number(event.target.value) })} style={{ width: '100%', minWidth: 90 }} /></td>)}<td><input aria-label={`Condições de comissão de ${member.name}`} maxLength={2000} value={rule.notes} onChange={event => updateRule(member.id, { notes: event.target.value })} /></td></tr>; })}</tbody></table></div>
      <h3>Recebimento de novos leads</h3>
      <label><input type="checkbox" checked={config.blockNewLeads} onChange={event => setConfig(current => ({ ...current, blockNewLeads: event.target.checked }))} /> Bloquear novos leads enquanto houver registros pendentes</label>
      <label><input type="checkbox" checked={config.registrationRequired} onChange={event => setConfig(current => ({ ...current, registrationRequired: event.target.checked }))} /> Exigir registro de atendimento na conversa</label>
      <label><input type="checkbox" checked={config.overdueTasksBlock} onChange={event => setConfig(current => ({ ...current, overdueTasksBlock: event.target.checked }))} /> Bloquear por atividades atrasadas</label>
      <label>Prazo para regularizar (horas)<input type="number" min="1" max="8760" value={config.graceHours} onChange={event => setConfig(current => ({ ...current, graceHours: Number(event.target.value) }))} /></label>
      <p>O corretor mantém acesso aos clientes atuais para concluir os registros. O recebimento é liberado automaticamente após regularizar as pendências.</p>
      <label>Avisar plantonistas offline após (minutos)<input type="number" min="5" max="60" value={config.offlineFallbackMinutes} onChange={event => setConfig(current => ({ ...current, offlineFallbackMinutes: Number(event.target.value) }))} /></label>
      <p>Com prioridade de plantão ativada, o painel aberto mantém o corretor online. Quem estiver offline recebe o alerta após esse prazo. O administrador também é avisado dos clientes sem resposta no prazo de contato configurado.</p>
      {state.members.filter(member => member.role === 'broker').map(member => { const issues = brokerComplianceIssues(state, member.id); return issues.length ? <p key={member.id}><strong>{member.name}:</strong> {issues.length} pendência(s) para regularizar.</p> : null; })}
      <label>Período do relatório de compradores<select value={frequency} onChange={event => setFrequency(event.target.value as 'weekly' | 'monthly')}><option value="weekly">Semanal</option><option value="monthly">Mensal</option></select></label>
      <button className={s.primaryButton} disabled={busy}>{busy ? 'Salvando…' : 'Salvar regras da equipe'}</button>
    </form>
  </section>;
}

export function CommissionReport({ state, caseIds }: { state: CrmState; caseIds: string[] }) {
  const rows = state.records.filter(record => record.kind === 'cases' && record.data.status === 'Ganho' && record.commission && caseIds.includes(record.id));
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  return <section className={s.panel}><div className={s.panelHead}><div><h2>Comissões calculadas</h2><p>Estimativas preservadas nos fechamentos deste filtro</p></div><strong>{money.format(rows.reduce((sum, row) => sum + row.commission!.amount, 0))}</strong></div><div className={s.tableWrap}><table className={s.table}><thead><tr><th>Negócio</th><th>Responsável</th><th>Base</th><th>Regra</th><th>Comissão estimada</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{String(row.data.name)}</td><td>{state.members.find(member => member.id === row.commission!.brokerId)?.name || 'Responsável do fechamento'}</td><td>{money.format(row.commission!.dealAmount)}</td><td>{row.commission!.ratePercent}% + {money.format(row.commission!.fixedAmount)}</td><td>{money.format(row.commission!.amount)}</td></tr>)}</tbody></table>{!rows.length && <p className={s.settingsBody}>Nenhum fechamento com regra de comissão configurada neste filtro.</p>}</div></section>;
}
