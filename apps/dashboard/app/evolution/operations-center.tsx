'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Actor, CrmCommand, CrmRecord, CrmState } from '@/lib/evolution/model';
import { canAccess } from '@/lib/evolution/model';
import { activeShifts, captureGoalProgress, catalogCompleteness, operationsSettings, operationsSummary } from '@/lib/evolution/operations';
import type { Kind } from '@/lib/evolution/schema';
import s from './operations-center.module.css';

type Values = Record<string, string | number | boolean>;
type Tab = 'attention' | 'catalog' | 'goals' | 'duty' | 'weekly' | 'distribution';
type Props = { preview?: boolean; state: CrmState; actor: Actor; busy: boolean; onCreate: (kind: Kind, defaults?: Values) => void; onSelect: (id: string) => void; onEdit: (record: CrmRecord) => void; onOpenConversations?: () => void; execute: (command: CrmCommand) => Promise<boolean> };
const value = (record: CrmRecord, key: string) => String(record.data[key] ?? '');
const name = (record: CrmRecord) => value(record, 'name') || 'Sem título';
const fmtDate = (input: string, time = true) => Number.isFinite(Date.parse(input)) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(input)) : 'Não informado';
const dateKey = (input: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(input);
const openFollowup = (record: CrmRecord) => !['Concluída', 'Cancelada'].includes(value(record, 'status'));
const TAB_LABELS: Record<Tab, string> = { attention: 'Acompanhamento', catalog: 'Qualidade da carteira', goals: 'Metas de captação', duty: 'Plantões', weekly: 'Resumo semanal', distribution: 'Redistribuição' };

export function CatalogHealth({ state, record, compact = false }: { state: CrmState; record: CrmRecord; compact?: boolean }) {
  if (!['leads', 'people', 'properties'].includes(record.kind)) return null;
  const result = catalogCompleteness(state, record);
  return <div className={`${s.catalogHealth} ${result.complete ? s.healthy : s.incomplete} ${compact ? s.compactHealth : ''}`}>
    <span><b>{result.percent}%</b> {result.complete ? 'Cadastro completo' : 'Cadastro pendente'}</span>
    {!compact && <><progress max={100} value={result.percent} aria-label="Completude do cadastro" /><small>{result.complete ? 'Informações essenciais preenchidas.' : `Falta completar: ${result.missing.join(', ')}.`}</small></>}
  </div>;
}

export function operationsCsv(rows: Array<Array<string | number>>) {
  return '\ufeff' + rows.map(row => row.map(cell => {
    // Spreadsheet applications must never interpret CRM text as a formula.
    const text = String(cell).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(';')).join('\r\n');
}

export default function OperationsCenter({ state, actor, busy, onCreate, onSelect, onEdit, onOpenConversations, preview = false }: Props) {
  const [tab, setTab] = useState<Tab>('attention');
  const [responsible, setResponsible] = useState('');
  const [followupFilter, setFollowupFilter] = useState('open');
  const [catalogKind, setCatalogKind] = useState('leads');
  const [weekStart, setWeekStart] = useState(() => {
    const today = new Date(`${dateKey(new Date())}T12:00:00-03:00`);
    today.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7);
    return dateKey(today);
  });
  const [notifications, setNotifications] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const emittedNotifications = useRef(new Set<string>());
  const isAdmin = actor.role === 'owner';
  const summary = operationsSummary(state, new Date(clock).toISOString());
  const config = operationsSettings(state);
  const memberName = (id: string) => state.members.find(member => member.id === id)?.name || 'Sem responsável';
  const filtered = (record: CrmRecord) => !responsible || value(record, 'assignedTo') === responsible;
  const followups = state.records.filter(record => record.kind === 'followups' && filtered(record)).sort((a, b) => value(a, 'dueAt').localeCompare(value(b, 'dueAt')));
  const pending = followups.filter(record => openFollowup(record) && value(record, 'status') !== 'Respondida');
  const late = pending.filter(record => Date.parse(value(record, 'dueAt')) < clock);
  const catalog = state.records.filter(record => record.kind === catalogKind && filtered(record) && !catalogCompleteness(state, record).complete);
  const goals = state.records.filter(record => record.kind === 'captureGoals' && filtered(record)).sort((a, b) => value(b, 'month').localeCompare(value(a, 'month')));
  const shifts = state.records.filter(record => record.kind === 'shifts' && filtered(record)).sort((a, b) => value(b, 'startsAt').localeCompare(value(a, 'startsAt')));
  const onDutyIds = new Set(activeShifts(state, new Date(clock).toISOString()).map(record => record.id));
  const weekly = useMemo(() => {
    const start = Date.parse(`${weekStart}T00:00:00-03:00`);
    const end = start + 7 * 86400000;
    const inWeek = (input: string) => Date.parse(input) >= start && Date.parse(input) < end;
    const records = state.records.filter(record => !responsible || value(record, 'assignedTo') === responsible);
    const ids = new Set(records.map(record => record.id));
    return {
      end: Number.isFinite(end) ? fmtDate(new Date(end - 1).toISOString(), false) : '—',
      leads: records.filter(record => record.kind === 'leads' && inWeek(record.createdAt)).length,
      cases: records.filter(record => record.kind === 'cases' && inWeek(record.createdAt)).length,
      events: state.events.filter(event => ids.has(event.recordId) && inWeek(event.at)),
      followups: records.filter(record => record.kind === 'followups' && inWeek(record.createdAt)).length,
      visits: records.filter(record => record.kind === 'tasks' && value(record, 'type') === 'Visita' && inWeek(value(record, 'dueAt'))),
      properties: records.filter(record => record.kind === 'properties' && inWeek(record.createdAt)).length,
    };
  }, [state, weekStart, responsible]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (preview || !notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const emitted = emittedNotifications.current;
    const check = () => {
      const overdue = state.records.filter(record => record.kind === 'followups' && value(record, 'assignedTo') === actor.brokerId && openFollowup(record) && value(record, 'status') !== 'Respondida' && Date.parse(value(record, 'dueAt')) < Date.now());
      const key = overdue.map(record => `${record.id}:${value(record, 'dueAt')}`).sort().join('|');
      if (!key || emitted.has(key)) return;
      emitted.add(key);
      try { new Notification('ImobFlow · acompanhamento pendente', { body: `Você tem ${overdue.length} cobrança(s) com prazo vencido. Abra a central de gestão para responder.`, tag: `imobflow-followups-${actor.companyId}-${actor.brokerId}` }); } catch { /* Browser policies may disable OS notifications; the in-app list remains available. */ }
    };
    check();
    const timer = window.setInterval(check, 60000);
    return () => window.clearInterval(timer);
  }, [preview, notifications, state, actor.companyId, actor.brokerId]);

  async function enableNotifications() {
    if (!('Notification' in window)) { setNotificationMessage('Este navegador não oferece notificações. Os avisos continuam nesta central.'); return; }
    try {
      const permission = await Notification.requestPermission();
      setNotifications(permission === 'granted');
      setNotificationMessage(permission === 'granted' ? 'Lembretes ativados enquanto esta central estiver aberta. A entrega depende do navegador e do sistema.' : 'Permissão não concedida. Os avisos continuam visíveis nesta central.');
    } catch { setNotificationMessage('Não foi possível ativar notificações neste navegador.'); }
  }
  function exportWeek() {
    const rows: Array<Array<string | number>> = [['Resumo semanal ImobFlow'], ['Período', weekStart, weekly.end], ['Escopo', responsible ? memberName(responsible) : isAdmin ? 'Carteira autorizada da empresa' : 'Minha carteira autorizada'], ['Novos leads', weekly.leads], ['Novos atendimentos', weekly.cases], ['Imóveis cadastrados', weekly.properties], ['Visitas com data na semana', weekly.visits.length], ['Cobranças criadas', weekly.followups], [], ['Data do evento', 'Responsável pela ação', 'Registro', 'Acontecimento'], ...weekly.events.map(event => [fmtDate(event.at), event.actorName, state.records.find(record => record.id === event.recordId)?.data.name as string || 'Registro autorizado', event.summary])];
    const blob = new Blob([operationsCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `imobflow-semana-${weekStart}.csv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={s.center}>
    <section className={s.hero}><div><span className={s.eyebrow}>ROTINA COM RESPONSÁVEL E PRAZO</span><h2>{isAdmin ? 'Sua equipe, acompanhada de perto.' : 'Seu próximo passo está aqui.'}</h2><p>{isAdmin ? 'Cobre retornos, acompanhe cadastros e organize a operação em um só lugar.' : 'Veja suas pendências, responda ao gestor e mantenha sua carteira organizada.'}</p></div>{isAdmin && <button className={s.primary} disabled={busy} onClick={() => onCreate('followups')}>+ Nova cobrança</button>}</section>
    <div className={s.stats}>
      <button className={s.stat} onClick={() => { setTab('attention'); setFollowupFilter('late'); }}><span>Cobranças vencidas</span><strong className={summary.followups.overdue ? s.dangerText : ''}>{summary.followups.overdue}</strong><small>Precisam de retorno</small></button>
      <button className={s.stat} onClick={() => { setTab('attention'); setFollowupFilter('review'); }}><span>Aguardando revisão</span><strong>{summary.followups.awaitingReview}</strong><small>Respostas enviadas ao gestor</small></button>
      <button className={s.stat} onClick={() => setTab('catalog')}><span>Cadastros incompletos</span><strong>{summary.catalog.incomplete}</strong><small>Leads, pessoas e imóveis</small></button>
      <button className={s.stat} onClick={() => setTab('duty')}><span>Plantões em andamento</span><strong>{summary.onDuty.length}</strong><small>Escalas ativas agora</small></button>
    </div>
    <nav className={s.tabs} aria-label="Áreas da central de gestão">{(Object.keys(TAB_LABELS) as Tab[]).filter(key => isAdmin || key !== 'distribution').map(key => <button key={key} aria-current={tab === key ? 'page' : undefined} className={tab === key ? s.activeTab : ''} onClick={() => setTab(key)}>{TAB_LABELS[key]}</button>)}</nav>
    <div className={s.toolbar}><div><h3>{TAB_LABELS[tab]}</h3><p>{preview ? 'Dados fictícios de demonstração, isolados da operação real.' : isAdmin ? 'Dados reais da carteira autorizada.' : 'Somente registros que você tem autorização para consultar.'}</p></div>{isAdmin && <label>Responsável<select value={responsible} onChange={event => setResponsible(event.target.value)}><option value="">Todos os responsáveis</option>{state.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}</div>

    {tab === 'attention' && <>
      <div className={s.actionBar}><div className={s.pills}>{[['open', 'Em aberto'], ['late', `Vencidas (${late.length})`], ['review', 'Para revisão'], ['all', 'Todas']].map(([key, text]) => <button key={key} aria-pressed={followupFilter === key} onClick={() => setFollowupFilter(key)}>{text}</button>)}</div><button className={s.secondary} disabled={preview} title={preview ? 'Notificações externas desativadas nesta demonstração.' : undefined} onClick={() => notifications ? setNotifications(false) : void enableNotifications()}>{notifications ? 'Desativar lembretes nesta sessão' : 'Ativar lembretes do navegador'}</button></div>
      {notificationMessage && <p className={s.note} role="status">{notificationMessage}</p>}
      <div className={s.followups}>{followups.filter(record => followupFilter === 'all' || (followupFilter === 'review' ? value(record, 'status') === 'Respondida' : followupFilter === 'late' ? late.includes(record) : openFollowup(record))).map(record => {
        const overdue = late.includes(record);
        return <article key={record.id} className={`${s.followup} ${overdue ? s.lateCard : ''}`}><div className={s.followupMain}><div className={s.tags}><span className={overdue ? s.dangerTag : s.tag}>{overdue ? 'Prazo vencido' : value(record, 'status')}</span>{value(record, 'priority') === 'Alta' && <span className={s.tag}>Alta prioridade</span>}</div><button className={s.titleButton} onClick={() => onSelect(record.id)}>{name(record)}</button><p>{value(record, 'request')}</p><div className={s.meta}><span>{memberName(value(record, 'assignedTo'))}</span><span>Prazo: {fmtDate(value(record, 'dueAt'))}</span>{value(record, 'caseId') && <button onClick={() => onSelect(value(record, 'caseId'))}>Ver atendimento ↗</button>}</div>{value(record, 'response') && <blockquote><b>Retorno do corretor</b>{value(record, 'response')}</blockquote>}{value(record, 'review') && <blockquote><b>Avaliação do gestor</b>{value(record, 'review')}</blockquote>}</div><div className={s.cardActions}><button className={s.secondary} onClick={() => onSelect(record.id)}>Histórico e detalhes</button>{canAccess(state, actor, record, 'write') && openFollowup(record) && <button className={s.primary} disabled={busy} onClick={() => onEdit(record)}>{isAdmin ? 'Revisar cobrança' : 'Responder ao gestor'}</button>}</div></article>;
      })}{!followups.some(record => followupFilter === 'all' || (followupFilter === 'review' ? value(record, 'status') === 'Respondida' : followupFilter === 'late' ? late.includes(record) : openFollowup(record))) && <Empty text="Nenhuma cobrança neste filtro." detail={isAdmin ? 'Crie uma cobrança com responsável, orientação e prazo. O retorno fica registrado no histórico.' : 'Quando o gestor solicitar um retorno, ele aparecerá aqui com o prazo combinado.'} />}</div>
      <p className={s.note}>Cobranças são internas. Nenhuma mensagem é enviada ao cliente. Uma resposta do corretor aguarda a revisão do gestor para ser concluída.</p>
    </>}

    {tab === 'catalog' && <><div className={s.actionBar}><label>Tipo de cadastro<select value={catalogKind} onChange={event => setCatalogKind(event.target.value)}><option value="leads">Leads</option><option value="people">Pessoas</option><option value="properties">Imóveis</option></select></label><span className={s.note}>{catalog.length} cadastro(s) pendente(s) no filtro</span></div><div className={s.grid}>{catalog.map(record => <article className={s.card} key={record.id}><div className={s.cardHead}><button className={s.titleButton} onClick={() => onSelect(record.id)}>{name(record)}</button><span className={s.tag}>{value(record, 'purpose') || 'Não informado'}</span></div><small>{memberName(value(record, 'assignedTo'))}</small><CatalogHealth state={state} record={record} /><button className={s.secondary} onClick={() => canAccess(state, actor, record, 'write') ? onEdit(record) : onSelect(record.id)}>{canAccess(state, actor, record, 'write') ? 'Completar cadastro' : 'Consultar ficha'}</button></article>)}{catalog.length === 0 && <Empty text="Nenhuma pendência neste filtro." detail="A completude considera os campos essenciais; ela não garante que os dados informados sejam verdadeiros." />}</div><p className={s.note}>Leads novos nunca são descartados por falta de dados. Informações não conhecidas continuam pendentes, sem preenchimento inventado.</p></>}

    {tab === 'goals' && <><div className={s.actionBar}><p className={s.note}>Quantidade de imóveis cadastrados no mês, por responsável e finalidade.</p>{isAdmin && <button className={s.primary} onClick={() => onCreate('captureGoals')}>+ Meta de captação</button>}</div><div className={s.grid}>{goals.map(goal => { const progress = captureGoalProgress(state, goal); return <article key={goal.id} className={s.card}><button className={s.titleButton} onClick={() => onSelect(goal.id)}>{name(goal)}</button><small>{memberName(value(goal, 'assignedTo'))} · {value(goal, 'month')} · {value(goal, 'purpose')}</small><div className={s.goalNumber}><strong>{progress.actual}</strong><span>/ {progress.target} imóveis</span></div><progress max={100} value={Math.min(100, progress.percent)} aria-label={`Progresso de ${name(goal)}`} /><span className={progress.remaining ? s.note : s.successText}>{progress.remaining ? `Faltam ${progress.remaining} imóveis para atingir a meta.` : 'Meta atingida.'}</span>{isAdmin && <button className={s.secondary} onClick={() => onCreate('followups', { name: `Acompanhar meta · ${name(goal)}`, assignedTo: goal.data.assignedTo, request: `Acompanhar a captação de ${value(goal, 'purpose').toLowerCase()} em ${value(goal, 'month')}. Meta: ${progress.target} imóveis; registrados até agora: ${progress.actual}. Informe seu próximo passo.`, priority: 'Normal' })}>Solicitar atualização</button>}</article>; })}{!goals.length && <Empty text="Nenhuma meta cadastrada." detail="O gestor define a quantidade e o mês. O progresso acompanha os imóveis efetivamente registrados." />}</div></>}

    {tab === 'duty' && <><div className={s.actionBar}><p className={s.note}>Horários no fuso de São Paulo. O plantão orienta a preferência, sem transferir carteiras sozinho.</p>{isAdmin && <button className={s.primary} onClick={() => onCreate('shifts')}>+ Escalar plantão</button>}</div><div className={s.grid}>{shifts.map(shift => <article key={shift.id} className={`${s.card} ${onDutyIds.has(shift.id) ? s.onDuty : ''}`}><div className={s.cardHead}><button className={s.titleButton} onClick={() => onSelect(shift.id)}>{name(shift)}</button><span className={s.tag}>{onDutyIds.has(shift.id) ? 'Em plantão agora' : value(shift, 'status') === 'Cancelado' ? 'Cancelado' : Date.parse(value(shift, 'endsAt')) < clock ? 'Encerrado' : 'Programado'}</span></div><strong>{memberName(value(shift, 'assignedTo'))}</strong><small>{value(shift, 'purpose') === 'Ambos' ? 'Venda e aluguel' : value(shift, 'purpose')}</small><dl className={s.schedule}><div><dt>Início</dt><dd>{fmtDate(value(shift, 'startsAt'))}</dd></div><div><dt>Fim</dt><dd>{fmtDate(value(shift, 'endsAt'))}</dd></div></dl>{isAdmin && <button className={s.secondary} onClick={() => onEdit(shift)}>Editar escala</button>}</article>)}{!shifts.length && <Empty text="Nenhum plantão cadastrado." detail="Cadastre os horários e a especialidade dos corretores que estarão disponíveis para novos contatos." />}</div></>}

    {tab === 'weekly' && <><div className={s.actionBar}><label>Semana a partir de<input type="date" value={weekStart} onChange={event => setWeekStart(event.target.value)} /></label><button className={s.secondary} disabled={!weekStart || !Number.isFinite(Date.parse(weekStart))} onClick={exportWeek}>Exportar resumo CSV</button></div><div className={s.reportBanner}><strong>{fmtDate(`${weekStart}T12:00:00-03:00`, false)} a {weekly.end}</strong><span>Resumo calculado automaticamente dos registros autorizados, sem envio externo.</span></div><div className={s.stats}>{[['Novos leads', weekly.leads], ['Novos atendimentos', weekly.cases], ['Imóveis cadastrados', weekly.properties], ['Visitas da semana', weekly.visits.length]].map(([title, count]) => <div className={s.stat} key={title}><span>{title}</span><strong>{count}</strong></div>)}</div><section className={s.report}><h4>Resumos automáticos no mural da equipe</h4>{state.records.filter(record => record.kind === 'notices' && value(record, 'name').startsWith('Resumo semanal · ')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(record => <button key={record.id} onClick={() => onSelect(record.id)}><span><strong>{name(record)}</strong><small>Publicado no mural · números consolidados da equipe</small></span><time>{fmtDate(record.createdAt)}</time></button>)}{!state.records.some(record => record.kind === 'notices' && value(record, 'name').startsWith('Resumo semanal · ')) && <p className={s.note}>{config.weeklyReportsEnabled ? 'A geração está habilitada. O primeiro resumo aparecerá após a execução da rotina programada.' : 'O gestor pode habilitar a publicação interna dos resumos nas Configurações.'}</p>}</section><section className={s.report}><h4>Movimentações registradas na semana</h4>{weekly.events.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30).map(event => <button key={event.id} onClick={() => onSelect(event.recordId)}><span><strong>{event.summary}</strong><small>{event.actorName}</small></span><time>{fmtDate(event.at)}</time></button>)}{!weekly.events.length && <Empty text="Sem movimentações registradas no período." detail="Eventos anteriores à implantação não são reconstruídos nem estimados." />}{weekly.events.length > 30 && <p className={s.note}>Exibindo as 30 movimentações mais recentes. A exportação contém todas as movimentações autorizadas do período.</p>}</section><p className={s.note}>Contagens por data de criação; visitas pela data agendada, independentemente do status. Não representam receita nem conversão. O fuso usado é São Paulo.</p></>}

    {tab === 'distribution' && isAdmin && <><div className={s.reportBanner}><strong>Revisão de carteira · {config.reassignmentDays} dias</strong><span>A lista sugere próximos responsáveis por especialidade, plantão e carga atual. Nenhum cliente é transferido nesta tela.</span></div><div className={s.followups}>{summary.redistribution.filter(item => !responsible || item.assignedTo === responsible).map(item => { const record = state.records.find(row => row.id === item.leadId); if (!record) return null; return <article className={s.followup} key={item.leadId}><div className={s.followupMain}><button className={s.titleButton} onClick={() => onSelect(item.leadId)}>{name(record)}</button><p>{item.reason}</p><div className={s.meta}><span>{memberName(item.assignedTo)}</span><span>{item.daysInactive} dia(s) sem atualização</span>{item.incomplete && <span>Cadastro incompleto</span>}</div><div className={s.recommendations}>{item.recommendations.slice(0, 3).map(member => <span key={member.id}><strong>{member.name}</strong><small>{member.onDuty ? 'Em plantão · ' : ''}{member.openCases} atendimento(s) aberto(s)</small></span>)}{!item.recommendations.length && <small>Nenhum outro corretor elegível para a finalidade.</small>}</div></div><div className={s.cardActions}><button className={s.secondary} onClick={() => onCreate('followups', { name: `Revisar carteira · ${name(record)}`, assignedTo: item.assignedTo, ...(item.caseIds[0] ? { caseId: item.caseIds[0] } : {}), request: `Revisar o cadastro e registrar o próximo passo para ${name(record)}. ${item.reason}`, priority: 'Alta' })}>Cobrar responsável atual</button><button className={s.secondary} onClick={() => record.legacy?.table === 'leads' && onOpenConversations ? onOpenConversations() : onSelect(item.leadId)}>{record.legacy?.table === 'leads' && onOpenConversations ? 'Revisar em Conversas' : 'Revisar ficha'}</button></div></article>; })}{summary.redistribution.filter(item => !responsible || item.assignedTo === responsible).length === 0 && <Empty text="Nenhum lead elegível para revisão." detail="A análise respeita os prazos, a finalidade e os compromissos em andamento. Ela não muda a carteira automaticamente." />}</div></>}
  </div>;
}

function Empty({ text, detail }: { text: string; detail: string }) { return <div className={s.empty}><strong>{text}</strong><p>{detail}</p></div>; }

export function OperationsSettings({ state, isAdmin, busy, execute }: Pick<Props, 'state' | 'busy' | 'execute'> & { isAdmin: boolean }) {
  const [config, setConfig] = useState(() => operationsSettings(state));
  return <section className={s.settings}><header><span className={s.eyebrow}>REGRAS DA OPERAÇÃO</span><h2>Mais consistência, sem perder os novos leads.</h2><p>Ative as validações depois de revisar o fluxo com sua equipe. Registros antigos são preservados.</p></header><form onSubmit={event => { event.preventDefault(); void execute({ type: 'settings', settings: { operations: config } }); }}>
    <div className={s.settingsColumns}><fieldset disabled={!isAdmin || busy}><legend>Avanço no funil</legend>{([
      ['funnelEnabled', 'Ativar validações de avanço', 'Os próximos avanços passam pelas regras selecionadas abaixo.'],
      ['requireCompleteCatalog', 'Exigir cadastro completo para avançar', 'Leads incompletos ainda podem entrar; o corretor completa antes de avançar.'],
      ['requireAttendanceBeforeSchedule', 'Exigir atendimento antes do agendamento', 'Mantém a sequência de atendimento antes de uma visita.'],
      ['requireVisitBeforeProposal', 'Exigir visita realizada antes da proposta', 'Ative apenas se esta for a regra comercial da sua empresa.'],
    ] as const).map(([key, title, text]) => <label className={s.check} key={key}><input type="checkbox" checked={Boolean(config[key])} onChange={event => setConfig(current => ({ ...current, [key]: event.target.checked }))} /><span><b>{title}</b><small>{text}</small></span></label>)}</fieldset><fieldset disabled={!isAdmin || busy}><legend>Revisão e rotina</legend><label className={s.check}><input type="checkbox" checked={config.reassignmentEnabled} onChange={event => setConfig(current => ({ ...current, reassignmentEnabled: event.target.checked }))} /><span><b>Ativar lista de revisão da carteira</b><small>Mostra candidatos e recomendações. Não realiza transferências automaticamente.</small></span></label><label className={s.field}>Prazo para revisar carteira inativa<span><input type="number" required min={1} max={365} value={config.reassignmentDays} onChange={event => setConfig(current => ({ ...current, reassignmentDays: Number(event.target.value) }))} />dias</span></label><label className={s.check}><input type="checkbox" checked={config.includeIncomplete} onChange={event => setConfig(current => ({ ...current, includeIncomplete: event.target.checked }))} /><span><b>Considerar cadastros incompletos</b><small>Incluí-los na revisão após o prazo configurado, sem apagar o contato.</small></span></label><label className={s.check}><input type="checkbox" checked={config.preferOnDuty} onChange={event => setConfig(current => ({ ...current, preferOnDuty: event.target.checked }))} /><span><b>Priorizar quem está de plantão</b><small>Orienta a ordem de recomendação entre corretores elegíveis.</small></span></label><label className={s.check}><input type="checkbox" checked={config.weeklyReportsEnabled} onChange={event => setConfig(current => ({ ...current, weeklyReportsEnabled: event.target.checked }))} /><span><b>Gerar resumo semanal no mural da equipe</b><small>O relatório consolidado fica visível para os corretores no mural. Não envia email nem mensagens aos clientes.</small></span></label><p className={s.safety}>Redistribuição automática permanece desligada. Configurar prazo e plantões não transfere clientes nem autoriza envios externos.</p></fieldset></div><footer><span>As regras são verificadas pelo servidor. Carteiras e registros anteriores são preservados.</span><button className={s.primary} disabled={!isAdmin || busy}>{busy ? 'Salvando…' : 'Salvar regras da operação'}</button></footer></form></section>;
}
