'use client';

import { useEffect, useState } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import type { BuyerReport, BuyerReportFrequency } from '@/lib/evolution/buyer-report';
import type { ScheduledBuyerReport } from '@/lib/evolution/buyer-report-store';
import s from './buyer-report-panel.module.css';

const currency = (value: number | null) => value === null ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
type ReportResponse = BuyerReport & { scheduled: ScheduledBuyerReport[]; scheduleReady: boolean };

export default function BuyerReportPanel({ frequency }: { frequency: BuyerReportFrequency }) {
  const [report, setReport] = useState<ReportResponse | null>(null), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const demo = isProductDemo();
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController(); let active = true;
    void dashboardFetch('/api/reports/buyers', { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json() as ReportResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Não foi possível consultar os compradores.');
      if (!Array.isArray(body.periods) || !body.periods.length) throw new Error('Relatório inválido.');
      if (active) { setReport(body); setError(''); setSelected(previous => body.periods.some((period: { key: string }) => period.key === previous) ? previous : body.periods[0].key); }
    }).catch(failure => { if (active) { setReport(null); setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o relatório.'); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [frequency, revision, demo]);
  const period = report?.periods.find(item => item.key === selected);
  return <section className={s.panel} aria-label="Relatório de compradores">
    <header className={s.header}><div><span className={s.eyebrow}>MARKETING · ADMINISTRADOR</span><h2>Perfil de quem compra</h2><p>Compras confirmadas e preferências registradas para orientar suas campanhas.</p></div><button type="button" disabled={loading || demo} onClick={() => { setLoading(true); setError(''); setRevision(value => value + 1); }}>{loading && !demo ? 'Atualizando…' : 'Atualizar relatório'}</button></header>
    {demo && <p>Os relatórios reais ficam disponíveis na conta da imobiliária, após os primeiros fechamentos registrados.</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      {report.scheduled.length > 0 && <p role="status">Relatório automático pronto: período {report.scheduled[0].periodKey}, gerado em {date(report.scheduled[0].generatedAt)}. Somente administradores têm acesso.</p>}
      {!report.scheduleReady && <p className={s.note}>O histórico automático aguarda atualização do banco. A consulta atual permanece disponível.</p>}
      <div className={s.filters}><label>Período ({report.frequency === 'weekly' ? 'semanal' : 'mensal'})<select value={selected} onChange={event => setSelected(event.target.value)}>{report.periods.map(item => <option key={item.key} value={item.key}>{date(item.start)} a {date(new Date(Date.parse(item.end) - 1).toISOString())}{item.current ? ' · em andamento' : ''}</option>)}</select></label><small>Atualizado em {new Date(report.generatedAt).toLocaleString('pt-BR')}. A frequência pode ser alterada nas configurações.</small></div>
      {period && <>
        <div className={s.metrics}><div><span>Compradores únicos</span><strong>{period.customers}</strong></div><div><span>Compras confirmadas</span><strong>{period.sales}</strong></div><div><span>Valor negociado conhecido</span><strong>{currency(period.totalAmount)}</strong></div><div><span>Ticket médio conhecido</span><strong>{currency(period.averageAmount)}</strong></div></div>
        {period.sales ? <><div className={s.grids}>{([['Origens dos compradores', period.sources], ['Localização dos imóveis comprados', period.regions], ['Tipos de imóveis comprados', period.propertyTypes], ['Orçamento declarado', period.budgets], ['Forma de pagamento declarada', period.financing]] as const).map(([title, rows]) => <section key={title}><h3>{title}</h3><ul>{rows.map(row => <li key={row.label}><span>{row.label}</span><strong>{row.count}</strong></li>)}</ul></section>)}</div>
          <h3>Compradores e intenções registradas</h3><div className={s.tableWrap}><table><thead><tr><th>Cliente / corretor</th><th>Compra</th><th>Perfil comercial</th></tr></thead><tbody>{period.buyers.map(buyer => <tr key={buyer.caseId}><td><strong>{buyer.name}</strong><span>{buyer.broker}</span><span>{buyer.source}</span></td><td><strong>{buyer.property}</strong><span>{currency(buyer.amount)} · {date(buyer.closedAt)}</span><span>{buyer.region}</span></td><td><span>Interesse: {buyer.wantedRegion}</span><span>Orçamento: {currency(buyer.budgetMax)} · {buyer.financing}</span><span>Prazo: {buyer.timeline}</span><span>{buyer.preferences}</span></td></tr>)}</tbody></table></div></> : <p>Nenhuma compra confirmada neste período. Os dados aparecem após registrar o fechamento da negociação.</p>}
        <p className={s.note}>Relatório recalculado ao abrir ou atualizar, com base nos registros atuais. Fechamentos desfeitos ficam fora do total. Valores usam propostas aceitas; {period.missingAmount} compra(s) sem valor confirmado. Informações ausentes permanecem “Não informado”. Os perfis não inferem idade, renda ou outros atributos pessoais.</p>
      </>}
      {report.undatedSales > 0 && <p className={s.note}>{report.undatedSales} compra(s) sem data de fechamento verificável não entraram nos períodos.</p>}
      {report.scheduled.length > 0 && <details><summary>Relatórios gerados automaticamente ({report.frequency === 'weekly' ? 'toda semana' : 'todo mês'})</summary><p className={s.note}>Retratos preservados na data da geração. Correções posteriores aparecem na consulta atual acima.</p><div className={s.tableWrap}><table><thead><tr><th>Período</th><th>Gerado em</th><th>Compradores</th><th>Compras</th><th>Valor conhecido</th></tr></thead><tbody>{report.scheduled.map(item => <tr key={item.periodKey}><td>{item.periodKey}</td><td>{date(item.generatedAt)}</td><td>{item.report.customers}</td><td>{item.report.sales}</td><td>{currency(item.report.totalAmount)}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>;
}
