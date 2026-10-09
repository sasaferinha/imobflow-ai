'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { canAccess, dashboardMetrics, filterCases, freshness, type Actor, type CrmState, type CrmRecord, type CrmCommand as Command } from '@/lib/evolution/model';
import { CAPTURE_STAGES, MODULES, NEGOTIATION_STAGES, type Field, type Kind } from '@/lib/evolution/schema';
import s from './evolution.module.css';
import AccountMenu from './account-menu';
import OperationsCenter, { CatalogHealth, OperationsSettings } from './operations-center';
import { operationsSummary } from '@/lib/evolution/operations';

export type OperationalPage = 'conversations' | 'opportunities' | 'appointments' | 'imports' | 'integrations' | 'account' | 'brokers' | 'results' | 'operational-goals' | 'portfolio' | 'customer-base';
type Page = Kind | 'dashboard' | 'reports' | 'members' | 'settings' | 'operations' | OperationalPage;
const OPERATIONAL_TITLES: Record<OperationalPage, string> = {
  conversations: 'Conversas', opportunities: 'Oportunidades', appointments: 'Agenda de visitas', imports: 'Importar clientes', integrations: 'Integrações', account: 'Minha conta', brokers: 'Corretores e acessos', results: 'Resultados da operação', 'operational-goals': 'Metas da operação', portfolio: 'Catálogo e fotos', 'customer-base': 'Carteira de clientes',
};
const isOperationalPage = (page: string): page is OperationalPage => Object.hasOwn(OPERATIONAL_TITLES, page);
type Values = Record<string, string | number | boolean>;
type Filters = { from: string; to: string; assignedTo: string; purpose: string; stage: string; journey: string; freshness: string; status: string };
type Editor = { kind: Kind; record?: CrmRecord; defaults?: Values };
const INITIAL_FILTERS: Filters = { from: '', to: '', assignedTo: '', purpose: '', stage: '', journey: '', freshness: '', status: '' };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('pt-BR');
const v = (record: CrmRecord, key: string) => String(record.data[key] ?? '');
const n = (record: CrmRecord, key: string) => Number(record.data[key] ?? 0) || 0;
const label = (record: CrmRecord) => v(record, 'name') || MODULES[record.kind].singular;
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
const validDate = (value: string) => value && Number.isFinite(Date.parse(value));
const date = (value: string, time = false) => validDate(value) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) }).format(new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value)) : '—';
const FRESHNESS_LABELS: Record<string, string> = { current: 'Em dia', near: 'Atenção', overdue: 'Atrasado' };
const FRESHNESS_KEYS: Record<string, string> = { 'Em dia': 'current', 'Atenção': 'near', Atrasado: 'overdue' };
const monthInSaoPaulo = (value: unknown) => {
  if (typeof value !== 'string' || !validDate(value)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value));
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
};
const STATUS_COLORS: Record<string, string> = { Aberto: 'blue', Pendente: 'amber', Confirmada: 'blue', Realizada: 'green', Ganho: 'green', Negociado: 'green', Captado: 'green', Aceita: 'green', Disponível: 'green', Devolvida: 'green', Perdido: 'red', Recusada: 'red', Expirada: 'red', Ausência: 'red', Cancelada: 'gray', Pausado: 'amber', Reservado: 'amber', Retirada: 'amber', Quente: 'red', Morno: 'amber', Frio: 'blue', Vendido: 'gray', Alugado: 'gray', 'Em atendimento': 'blue', Descartado: 'gray' };

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
    home: <><path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7" /></>,
    cases: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 12a22 22 0 0 0 18 0M10 13h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2M8 18h2" /></>,
    chart: <><path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" /><circle cx="16" cy="12" r="2" fill="currentColor" /><circle cx="8" cy="18" r="2" fill="currentColor" /></>,
    tool: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m4 12 5 5L20 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3" /></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15z" /></>,
    filter: <><path d="M3 5h18l-7 8v7l-4-2v-5z" /></>,
    list: <><path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1" /></>,
    board: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="14" rx="1" /></>,
    external: <><path d="M14 3h7v7M21 3 10 14M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" /></>,
    alert: <><path d="m12 3 10 18H2zM12 9v5M12 17v1" /></>,
    key: <><circle cx="8" cy="9" r="5" /><path d="m12 13 8 8M16 17l3-3M18 19l3-3" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.tool}</svg>;
}

function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`${s.pill} ${s[tone || STATUS_COLORS[String(children)] || 'gray']}`}>{children}</span>;
}

function Empty({ title = 'Nenhum registro encontrado', text = 'Cadastre um registro ou ajuste os filtros para começar.', action }: { title?: string; text?: string; action?: ReactNode }) {
  return <div className={s.empty}><span className={s.emptyIcon}><Icon name="tool" size={26} /></span><strong>{title}</strong><p>{text}</p>{action}</div>;
}

function Dialog({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`${s.dialog} ${wide ? s.wideDialog : ''}`} onCancel={onClose} aria-labelledby="evolution-dialog-title" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={s.dialogInner}><header className={s.dialogHead}><div><h2 id="evolution-dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className={s.iconButton} onClick={onClose} aria-label="Fechar janela"><Icon name="close" /></button></header>{children}</div>
  </dialog>;
}

const recordFreshness = (record: CrmRecord, state: CrmState) => FRESHNESS_LABELS[freshness(record, state.settings)];

function matches(record: CrmRecord, filters: Filters, state: CrmState) {
  const relatedCase = record.kind === 'cases' ? record : state.records.find(candidate => candidate.id === v(record, 'caseId'));
  if (relatedCase && ['cases', 'tasks', 'proposals'].includes(record.kind)) {
    const caseFilter = { ...filters, freshness: FRESHNESS_KEYS[filters.freshness] || filters.freshness, ...(record.kind === 'cases' ? {} : { status: '', stage: '', journey: '', freshness: '' }) };
    return filterCases({ ...state, records: [relatedCase] }, caseFilter).length > 0 && (!filters.status || v(record, 'status') === filters.status);
  }
  const timestamp = Date.parse(record.createdAt);
  const purpose = v(record, 'purpose') || (relatedCase ? v(relatedCase, 'purpose') : '');
  const assignedTo = v(record, 'assignedTo') || (relatedCase ? v(relatedCase, 'assignedTo') : '');
  return (!filters.from || timestamp >= Date.parse(`${filters.from}T00:00:00-03:00`)) && (!filters.to || timestamp < Date.parse(`${filters.to}T00:00:00-03:00`) + 86400000)
    && (!filters.assignedTo || assignedTo === filters.assignedTo)
    && (!filters.purpose || purpose === filters.purpose)
    && (!filters.status || v(record, 'status') === filters.status)
    && (!filters.stage || v(record, 'stage') === filters.stage)
    && (!filters.journey || v(record, 'journey') === filters.journey)
    && (!filters.freshness || (v(record, 'status') === 'Aberto' && recordFreshness(record, state) === filters.freshness));
}

const COLUMNS: Partial<Record<Kind, string[]>> = {
  people: ['category', 'phone', 'email', 'assignedTo'], leads: ['source', 'purpose', 'temperature', 'status', 'assignedTo'], cases: ['personId', 'purpose', 'stage', 'status', 'assignedTo', 'nextActivityAt'], tasks: ['type', 'caseId', 'dueAt', 'priority', 'status', 'assignedTo'], proposals: ['caseId', 'propertyId', 'amount', 'status', 'expiresAt'], properties: ['code', 'purpose', 'price', 'status', 'assignedTo'], keys: ['propertyId', 'borrower', 'dueAt', 'status'], goals: ['assignedTo', 'month', 'purpose', 'amount'], neighborhoods: ['city', 'aliases'], condominiums: ['city', 'address'], messages: ['recipientId', 'text'], channels: ['url', 'dependency'], content: ['type', 'text'], teams: ['leaderId'],
};

export default function EvolutionClient({ initialState, actor, mode, integrated = false, renderOperationalPanel }: { initialState: CrmState; actor: Actor; mode: 'preview' | 'live'; integrated?: boolean; renderOperationalPanel?: (page: OperationalPage, refreshKey: number, onNavigate: (page: OperationalPage) => void) => ReactNode }) {
  const [state, setState] = useState(initialState);
  const [page, setPage] = useState<Page>('dashboard');
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [query, setQuery] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [recordView, setRecordView] = useState<'cards' | 'list'>('cards');
  const [taskRange, setTaskRange] = useState('all');
  const [menu, setMenu] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [dashboardPurpose, setDashboardPurpose] = useState('Venda');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [operationalRefresh, setOperationalRefresh] = useState(0);
  const [retainedOperationalPage, setRetainedOperationalPage] = useState<OperationalPage | null>(null);
  const hasLiveOperation = mode === 'live' && integrated && Boolean(renderOperationalPanel);
  const operationalPage = hasLiveOperation && isOperationalPage(page) ? page : null;
  const mountedOperationalPage = operationalPage || retainedOperationalPage;
  useEffect(() => { if (operationalPage) setRetainedOperationalPage(operationalPage); }, [operationalPage]);
  const isAdmin = actor.role === 'owner';
  const selected = state.records.find(record => record.id === selectedId);
  const member = state.members.find(item => item.id === memberId);
  const pageTitle = (item: Page) => item in MODULES ? MODULES[item as Kind].title : isOperationalPage(item) ? OPERATIONAL_TITLES[item] : { dashboard: 'Dashboard', reports: 'Relatórios', members: 'Usuários e permissões', settings: 'Configurações', operations: 'Central de gestão' }[item as 'dashboard' | 'reports' | 'members' | 'settings' | 'operations'];
  const title = pageTitle(page);

  useEffect(() => {
    const hash = window.location.hash.slice(1) as Page;
    if (hash in MODULES || ['dashboard', 'reports', 'members', 'settings', 'operations'].includes(hash) || (hasLiveOperation && isOperationalPage(hash) && (isAdmin || !['imports', 'brokers', 'operational-goals'].includes(hash)))) setPage(hash);
  }, [hasLiveOperation, isAdmin]);

  useEffect(() => {
    if (mode !== 'live' || page !== 'operations' || busy || editor || selectedId || memberId || typeof window.setInterval !== 'function') return;
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/evolution', { cache: 'no-store', signal: controller.signal });
        if (!response.ok || disposed) return;
        const payload = await response.json() as { state: CrmState };
        if (!disposed && payload.state?.companyId === actor.companyId) setState(payload.state);
      } catch { /* Explicit refresh still reports errors; a background retry never interrupts a draft. */ }
    }, 60000);
    return () => { disposed = true; window.clearInterval(timer); controller.abort(); };
  }, [mode, page, busy, editor, selectedId, memberId, actor.companyId]);

  function navigate(next: Page, nextFilters: Partial<Filters> = {}) {
    if (isOperationalPage(next) && (!hasLiveOperation || (!isAdmin && ['imports', 'brokers', 'operational-goals'].includes(next)))) return;
    if (operationalPage && !isOperationalPage(next)) void refresh(true);
    setMobileNavOpen(false);
    setPage(next); setFilters({ ...INITIAL_FILTERS, ...nextFilters }); setQuery(''); setMenu(null); setGlobalQuery(''); setSelectedId(null); setTaskRange('all');
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${next}`);
  }

  async function refresh(workspace = false) {
    if (operationalPage && !workspace) { setOperationalRefresh(current => current + 1); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/evolution', { cache: 'no-store' });
      const payload = await response.json() as { state: CrmState; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar os dados.');
      setState(payload.state); setNotice('Dados atualizados.');
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Falha de conexão. Tente novamente.'); }
    finally { setBusy(false); }
  }

  async function execute(command: Command): Promise<boolean> {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/evolution', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, expectedVersion: state.version, expectedSourceRevision: state.sourceRevision }) });
      const payload = await response.json() as { state: CrmState; error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          const latest = await fetch('/api/evolution', { cache: 'no-store' });
          if (latest.ok) setState((await latest.json() as { state: CrmState }).state);
          throw new Error(payload.error || 'Há um conflito com os dados atuais. A base foi atualizada; revise seu formulário antes de salvar novamente.');
        }
        throw new Error(payload.error || 'Não foi possível salvar. Seus dados continuam no formulário.');
      }
      setState(payload.state); setNotice(command.type === 'settings' ? 'Configurações salvas.' : 'Alteração salva e registrada no histórico.');
      return true;
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Falha de conexão. Seus dados não foram enviados.'); return false; }
    finally { setBusy(false); }
  }

  const scope = useMemo(() => state.records.filter(record => matches(record, { ...filters, stage: '', journey: '', freshness: '' }, state)), [state, filters]);
  const metrics = dashboardMetrics(state, { ...filters, freshness: FRESHNESS_KEYS[filters.freshness] || filters.freshness });
  const scopedCases = metrics.cases;
  const openCases = metrics.active;
  const properties = metrics.inventory;
  const filteredRecords = state.records.filter(record => record.kind === page && matches(record, filters, state) && (!query || Object.values(record.data).some(value => String(value).toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))) && (page !== 'tasks' || taskRange === 'all' || (taskRange === 'done' ? v(record, 'status') === 'Realizada' : ['Pendente', 'Confirmada'].includes(v(record, 'status')) && (taskRange === 'late' ? Date.parse(v(record, 'dueAt')) < Date.now() : taskRange === 'today' ? new Date(v(record, 'dueAt')).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) === new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : Date.parse(v(record, 'dueAt')) >= Date.now()))));
  const globalResults = globalQuery.trim().length >= 2 ? state.records.filter(record => Object.values(record.data).some(value => String(value).toLocaleLowerCase('pt-BR').includes(globalQuery.toLocaleLowerCase('pt-BR')))).slice(0, 8) : [];
  const accepted = metrics.accepted;
  const memberName = (id: string) => state.members.find(item => item.id === id)?.name || 'Sem responsável';
  const refName = (id: string) => state.records.find(record => record.id === id)?.data.name || 'Registro indisponível';
  const drillCases = (extra: Partial<Filters>) => navigate('cases', { ...filters, ...extra });
  const canCreate = (kind: Kind) => isAdmin || (!MODULES[kind].admin && !['followups', 'captureGoals', 'shifts'].includes(kind));
  const create = (kind: Kind, defaults?: Values) => { if (!canCreate(kind)) return; setError(''); setEditor({ kind, defaults }); };
  const attentionCount = operationsSummary(state).followups.overdue;

  function acceptedAmounts(records: CrmRecord[], compact = false) {
    const purposes = filters.purpose ? [filters.purpose] : ['Venda', 'Aluguel'];
    return <span className={`${s.acceptedTotals} ${compact ? s.compactTotals : ''}`}>{purposes.map(purpose => {
      const total = records.filter(record => state.records.some(parent => parent.id === v(record, 'caseId') && parent.kind === 'cases' && v(parent, 'purpose') === purpose)).reduce((sum, record) => sum + n(record, 'amount'), 0);
      return <span key={purpose}><small>{purpose === 'Aluguel' ? 'Locação' : 'Venda'}</small><b>{money.format(total)}{purpose === 'Aluguel' && <i>/mês</i>}</b></span>;
    })}</span>;
  }

  function display(record: CrmRecord, key: string): ReactNode {
    const field = MODULES[record.kind].fields.find(item => item.key === key);
    const value = v(record, key);
    if (!value) return <span className={s.muted}>—</span>;
    if (field?.ref === 'members') return <span className={s.personCell}><i>{initials(memberName(value))}</i>{memberName(value)}</span>;
    if (field?.ref) return <span className={s.truncate}>{String(refName(value))}</span>;
    if (['amount', 'price', 'budgetMin', 'budgetMax'].includes(key)) return <span className={s.numeric}>{money.format(n(record, key))}</span>;
    if (field?.type === 'datetime-local' || field?.type === 'date') return date(value, field.type === 'datetime-local');
    if (['status', 'temperature', 'purpose', 'priority'].includes(key)) return <Pill>{value}</Pill>;
    if (key === 'stage') return <span className={s.stageLabel}><i />{value}</span>;
    return <span className={s.truncate}>{value}</span>;
  }

  function recordTable(records: CrmRecord[], kind: Kind, compact = false) {
    const fields = COLUMNS[kind] || MODULES[kind].fields.filter(field => field.key !== 'name').slice(0, 3).map(field => field.key);
    if (!compact && records.length && ['people', 'properties'].includes(kind) && recordView === 'cards') return <div className={s.cardGrid}>{records.map(record => <article className={s.recordCard} key={record.id}>
      <header className={s.recordCardHead}><Icon name={kind === 'people' ? 'people' : 'home'} size={21} /><button className={s.recordName} onClick={() => setSelectedId(record.id)}>{label(record)}</button><button className={s.iconButton} aria-label={`Abrir ${label(record)}`} onClick={() => setSelectedId(record.id)}><Icon name="arrow" size={19} /></button></header>
      <dl className={s.recordCardBody}>{fields.map(key => <div key={key}><dt>{MODULES[kind].fields.find(field => field.key === key)?.label || key}</dt><dd>{display(record, key)}</dd></div>)}</dl>
      <div className={s.catalogCardStatus}><CatalogHealth state={state} record={record} compact /></div>
      <footer className={s.recordCardFooter}><span>{record.legacy ? `Cadastro operacional · ${date(record.createdAt)}` : `Criado em ${date(record.createdAt)}`}</span><button className={s.textButton} onClick={() => setSelectedId(record.id)}>Abrir ficha <Icon name="arrow" size={14} /></button></footer>
    </article>)}</div>;
    return records.length === 0 ? <Empty text="Não há registros para os filtros selecionados." /> : <div className={s.tableWrap}><table className={s.table}><thead><tr><th>{MODULES[kind].singular}</th>{fields.slice(0, compact ? 3 : undefined).map(key => <th key={key}>{MODULES[kind].fields.find(field => field.key === key)?.label || key}</th>)}<th><span className={s.srOnly}>Abrir</span></th></tr></thead><tbody>{records.map(record => <tr key={record.id}><td><button className={s.recordName} onClick={() => setSelectedId(record.id)}>{label(record)}</button><small>{kind === 'cases' ? v(record, 'journey') : `Criado em ${date(record.createdAt)}`}</small>{!compact && <CatalogHealth state={state} record={record} compact />}</td>{fields.slice(0, compact ? 3 : undefined).map(key => <td key={key}>{display(record, key)}</td>)}<td><button className={s.iconButton} onClick={() => setSelectedId(record.id)} aria-label={`Abrir ${label(record)}`}><Icon name="arrow" size={16} /></button></td></tr>)}</tbody></table></div>;
  }

  function funnel(purpose: string, journey = 'Negociação') {
    const rows = scopedCases.filter(record => v(record, 'purpose') === purpose && v(record, 'journey') === journey);
    const stages = journey === 'Captação' ? CAPTURE_STAGES : NEGOTIATION_STAGES;
    const stageColors = ['var(--stage-lead)', 'var(--stage-contact)', 'var(--stage-visit)', 'var(--stage-proposal)', 'var(--stage-contract)', 'var(--stage-won)'];
    const colors = journey === 'Captação' ? [stageColors[0], stageColors[1], stageColors[5]] : stageColors;
    const open = rows.filter(record => v(record, 'status') === 'Aberto');
    return <section className={s.journeyCard} key={`${purpose}-${journey}`} aria-label={`${journey} de ${purpose.toLowerCase()}`}>
      <h3>{journey.toLocaleUpperCase('pt-BR')}</h3>
      <div className={s.verticalFunnel}>
        {stages.map((stage, index) => {
          const count = rows.filter(record => v(record, 'stage') === stage).length;
          const percentage = rows.length ? Math.round(count / rows.length * 100) : 0;
          return <button key={stage} className={s.funnelRow} style={{ '--stage-color': colors[index], '--stage-width': `${170 - index * 15}px`, '--stage-ink': journey === 'Negociação' && index === 3 ? '#fff' : '#000' } as CSSProperties} onClick={() => drillCases({ purpose, journey, stage, freshness: '' })} aria-label={`${stage}: ${count} atendimentos, ${percentage}% da carteira de ${purpose.toLowerCase()} em ${journey.toLowerCase()}`}>
            <span className={s.funnelCount}>{count}</span>
            <span className={s.funnelBlock}><span className={s.funnelStageName}>{stage}</span><strong>{count}</strong></span>
            <span className={s.funnelPercentage}>{percentage}%<small>da carteira</small></span>
            <span className={s.funnelFreshness}><Icon name="clock" size={17} /></span>
          </button>;
        })}
      </div>
      <div className={s.journeyHealth}>{['Em dia', 'Atenção', 'Atrasado'].map((status, index) => {
        const count = open.filter(record => recordFreshness(record, state) === status).length;
        return <button key={status} onClick={() => drillCases({ purpose, journey, stage: '', freshness: status })}><span className={[s.blue, s.amber, s.red][index]}><Icon name="clock" size={18} /><strong>{count}</strong></span><small>{status}</small></button>;
      })}</div>
      <button className={s.textButton} onClick={() => drillCases({ purpose, journey, stage: '', freshness: '' })}>{rows.length} atendimentos · ver todos <Icon name="arrow" size={14} /></button>
    </section>;
  }

  function dashboard() {
    const counts = ['Em dia', 'Atenção', 'Atrasado'].map(status => openCases.filter(record => recordFreshness(record, state) === status).length);
    const upcoming = metrics.upcoming.slice(0, 5);
    const available = properties.filter(record => v(record, 'status') === 'Disponível');
    const pendingLeads = scope.filter(record => record.kind === 'leads' && v(record, 'status') === 'Pendente');
    const total = counts.reduce((sum, count) => sum + count, 0);
    return <>
      <div className={s.summaryGrid}>
        <button className={s.summaryCard} onClick={() => drillCases({})}><span className={`${s.summaryIcon} ${s.blue}`}><Icon name="cases" /></span><span><small>Atendimentos na carteira</small><strong>{integer.format(scopedCases.length)}</strong><em>{openCases.length} abertos no período</em></span><Icon name="arrow" size={15} /></button>
        <button className={s.summaryCard} onClick={() => navigate('leads', { ...filters, status: 'Pendente' })}><span className={`${s.summaryIcon} ${s.amber}`}><Icon name="people" /></span><span><small>Leads para triagem</small><strong>{pendingLeads.length}</strong><em>Contatos com status pendente</em></span><Icon name="arrow" size={15} /></button>
        <button className={s.summaryCard} onClick={() => navigate('proposals', { ...filters, status: 'Aceita' })}><span className={`${s.summaryIcon} ${s.green}`}><Icon name="chart" /></span><span><small>Valor das propostas aceitas</small>{acceptedAmounts(accepted)}<em>{accepted.length} propostas · finalidades separadas</em></span><Icon name="arrow" size={15} /></button>
        <button className={s.summaryCard} onClick={() => navigate('properties', { purpose: filters.purpose, assignedTo: filters.assignedTo, status: 'Disponível' })}><span className={`${s.summaryIcon} ${s.purple}`}><Icon name="home" /></span><span><small>Imóveis disponíveis</small><strong>{available.length}</strong><em>Inventário atual · sem filtro de data</em></span><Icon name="arrow" size={15} /></button>
      </div>
      <section className={s.crmPanel}>
        <header className={s.crmPanelHead}><h2><Icon name="cases" size={19} />Atendimentos <span>›</span> Geral</h2><button className={s.textButton} onClick={() => navigate('cases', filters)}>Abrir atendimentos <Icon name="arrow" size={16} /></button></header>
        <div className={s.purposeTabs} aria-label="Finalidade dos funis">{['Venda', 'Aluguel'].map(purpose => <button key={purpose} className={(filters.purpose || dashboardPurpose) === purpose ? s.segmentActive : ''} aria-pressed={(filters.purpose || dashboardPurpose) === purpose} disabled={Boolean(filters.purpose && filters.purpose !== purpose)} title={filters.purpose && filters.purpose !== purpose ? 'Limpe o filtro de finalidade para visualizar esta aba' : undefined} onClick={() => setDashboardPurpose(purpose)}>{purpose === 'Aluguel' ? 'Locação' : 'Venda'}</button>)}</div>
        <div className={s.journeyGrid}>{funnel(filters.purpose || dashboardPurpose)}{funnel(filters.purpose || dashboardPurpose, 'Captação')}</div>
        <div className={s.panelFoot}><Icon name="filter" size={13} />Carteira atual no filtro selecionado. Percentuais indicam distribuição, não conversão entre etapas.</div>
      </section>
      <div className={s.sideColumn}>
        <section className={s.panel}><div className={s.panelHead}><div><h2>Saúde dos atendimentos</h2><p>Atualização conforme a etapa</p></div><Icon name="clock" size={18} /></div><div className={s.healthBody}><div className={s.donut} style={{ background: total ? `conic-gradient(var(--health-current) 0 ${counts[0] / total * 100}%, var(--health-near) ${counts[0] / total * 100}% ${(counts[0] + counts[1]) / total * 100}%, var(--health-overdue) ${(counts[0] + counts[1]) / total * 100}% 100%)` : 'var(--border)' }}><span><strong>{total}</strong><small>abertos</small></span></div><div className={s.healthLegend}>{['Em dia', 'Atenção', 'Atrasado'].map((status, index) => <button key={status} onClick={() => drillCases({ freshness: status })}><span className={`${s.legendDot} ${[s.greenDot, s.amberDot, s.redDot][index]}`} />{status}<strong>{counts[index]}</strong><Icon name="arrow" size={12} /></button>)}</div></div><div className={s.panelFoot}>Considera a última atualização de cada atendimento aberto.</div></section>
        <section className={s.panel}><div className={s.panelHead}><div><h2>Próximas atividades</h2><p>Sua agenda e os próximos passos</p></div><button className={s.iconButton} onClick={() => create('tasks')} aria-label="Criar atividade"><Icon name="plus" size={16} /></button></div>{upcoming.length ? <div className={s.agendaList}>{upcoming.map(task => { const late = Date.parse(v(task, 'dueAt')) < Date.now(); return <button key={task.id} onClick={() => setSelectedId(task.id)}><span className={`${s.agendaIcon} ${late ? s.red : s.blue}`}><Icon name={v(task, 'type') === 'Visita' ? 'home' : 'calendar'} size={17} /></span><span><strong>{label(task)}</strong><small>{memberName(v(task, 'assignedTo'))}</small><time className={late ? s.redText : ''}>{date(v(task, 'dueAt'), true)}{late ? ' · Atrasada' : ''}</time></span><Icon name="arrow" size={13} /></button>; })}</div> : <Empty title="Agenda livre" text="Nenhuma atividade pendente neste filtro." />}<button className={s.panelLink} onClick={() => navigate('tasks', filters)}>Abrir agenda completa <Icon name="arrow" size={14} /></button></section>
        <section className={`${s.panel} ${s.inventoryPanel}`}><div className={s.panelHead}><div><h2>Inventário disponível</h2><p>Valores anunciados, não receita</p></div><Icon name="home" /></div>{['Venda', 'Aluguel'].map(purpose => { const rows = available.filter(record => v(record, 'purpose') === purpose); return <button className={s.inventoryRow} key={purpose} onClick={() => navigate('properties', { purpose, assignedTo: filters.assignedTo, status: 'Disponível' })}><span>{purpose}<small>{rows.length} imóveis</small></span><strong>{money.format(rows.reduce((sum, record) => sum + n(record, 'price'), 0))}{purpose === 'Aluguel' && <small>/ mês</small>}</strong></button>; })}</section>
      </div>
      <div className={s.bottomGrid}><section className={s.panel}><div className={s.panelHead}><div><h2>Desempenho da equipe</h2><p>Atendimentos e propostas do período selecionado</p></div><button className={s.textButton} onClick={() => navigate('reports', filters)}>Relatório <Icon name="arrow" size={14} /></button></div><div className={s.tableWrap}><table className={s.table}><thead><tr><th>Responsável</th><th>Atendimentos</th><th>Abertos</th><th>Ganhos</th><th>Propostas aceitas</th></tr></thead><tbody>{state.members.map(person => { const cases = scopedCases.filter(record => v(record, 'assignedTo') === person.id); const ids = new Set(cases.map(record => record.id)); return <tr key={person.id}><td><button className={s.recordName} onClick={() => drillCases({ assignedTo: person.id })}>{person.name}</button></td><td>{cases.length}</td><td>{cases.filter(record => v(record, 'status') === 'Aberto').length}</td><td>{cases.filter(record => v(record, 'status') === 'Ganho').length}</td><td>{acceptedAmounts(accepted.filter(record => ids.has(v(record, 'caseId'))), true)}</td></tr>; })}</tbody></table></div></section><section className={s.panel}><div className={s.panelHead}><div><h2>Últimas movimentações</h2><p>Histórico registrado na plataforma</p></div><Icon name="clock" /></div><div className={s.eventList}>{state.events.slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5).map(event => <button key={event.id} onClick={() => setSelectedId(event.recordId)}><span className={s.eventDot} /><span><strong>{event.summary}</strong><small>{event.actorName} · {date(event.at, true)}</small></span></button>)}{!state.events.length && <p className={s.inlineEmpty}>As movimentações aparecerão aqui após o primeiro registro.</p>}</div></section></div>
    </>;
  }

  function moduleView(kind: Kind) {
    const definition = MODULES[kind];
    const stages = filters.journey === 'Captação' ? CAPTURE_STAGES : filters.journey === 'Negociação' ? NEGOTIATION_STAGES : [...NEGOTIATION_STAGES, 'Avaliação', 'Captado'];
    return <><section className={s.panel}>
      <div className={s.listToolbar}>{['people', 'properties'].includes(kind) && <div className={s.segmented}><button aria-label="Visualização em cartões" aria-pressed={recordView === 'cards'} className={recordView === 'cards' ? s.segmentActive : ''} onClick={() => setRecordView('cards')}><Icon name="dashboard" size={18} /></button><button aria-label="Visualização em tabela" aria-pressed={recordView === 'list'} className={recordView === 'list' ? s.segmentActive : ''} onClick={() => setRecordView('list')}><Icon name="list" size={18} /></button></div>}<div className={s.searchInput}><Icon name="search" size={17} /><input aria-label={`Buscar em ${definition.title}`} placeholder={`Buscar em ${definition.title.toLowerCase()}…`} value={query} onChange={event => setQuery(event.target.value)} /></div><span className={s.resultCount}>{filteredRecords.length} {filteredRecords.length === 1 ? 'registro' : 'registros'}</span>{definition.fields.some(field => field.key === 'status') && <select aria-label="Situação" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}><option value="">Todas as situações</option>{definition.fields.find(field => field.key === 'status')?.options?.map(status => <option key={status}>{status}</option>)}</select>}{kind === 'cases' && <><select aria-label="Jornada" value={filters.journey} onChange={event => setFilters(current => ({ ...current, journey: event.target.value, stage: '' }))}><option value="">Todas as jornadas</option><option>Negociação</option><option>Captação</option></select><select aria-label="Etapa" value={filters.stage} onChange={event => setFilters(current => ({ ...current, stage: event.target.value }))}><option value="">Todas as etapas</option>{[...NEGOTIATION_STAGES, 'Avaliação', 'Captado'].map(stage => <option key={stage}>{stage}</option>)}</select><div className={s.segmented}><button onClick={() => setView('list')} className={view === 'list' ? s.segmentActive : ''} aria-label="Visualização em lista" aria-pressed={view === 'list'}><Icon name="list" size={17} /></button><button onClick={() => setView('board')} className={view === 'board' ? s.segmentActive : ''} aria-label="Visualização em funil" aria-pressed={view === 'board'}><Icon name="board" size={17} /></button></div></>}</div>
      {kind === 'tasks' && <div className={s.taskTabs}>{[['all', 'Todas'], ['today', 'Hoje'], ['upcoming', 'Próximas'], ['late', 'Atrasadas'], ['done', 'Realizadas']].map(([key, text]) => <button key={key} className={taskRange === key ? s.taskTabActive : ''} onClick={() => setTaskRange(key)}>{text}</button>)}</div>}{definition.description && <div className={s.infoStrip}><Icon name="shield" size={15} />{definition.description}</div>}
      {filters.status && <div className={s.appliedFilters}><Pill>{filters.status}</Pill><button onClick={() => setFilters(current => ({ ...current, status: '' }))}>Remover situação ×</button></div>}{filters.freshness && <div className={s.appliedFilters}><Pill>{filters.freshness}</Pill><button onClick={() => setFilters(current => ({ ...current, freshness: '' }))}>Remover filtro ×</button></div>}
      {kind === 'cases' && view === 'board' ? <div className={s.board}>{stages.map(stage => { const cards = filteredRecords.filter(record => v(record, 'stage') === stage); return <section className={s.boardColumn} key={stage}><header><span>{stage}</span><b>{cards.length}</b></header>{cards.map(record => <button className={s.boardCard} key={record.id} onClick={() => setSelectedId(record.id)}><small>{v(record, 'purpose')} · {v(record, 'source')}</small><strong>{label(record)}</strong><span>{String(refName(v(record, 'personId')))}</span><div><Pill>{v(record, 'status')}</Pill><i title={memberName(v(record, 'assignedTo'))}>{initials(memberName(v(record, 'assignedTo')))}</i></div>{v(record, 'nextActivityAt') && <time><Icon name="clock" size={12} />{date(v(record, 'nextActivityAt'), true)}</time>}</button>)}<button className={s.boardAdd} onClick={() => create('cases', { stage, journey: filters.journey || (['Avaliação', 'Captado'].includes(stage) ? 'Captação' : 'Negociação'), purpose: filters.purpose || 'Venda' })}><Icon name="plus" size={14} />Adicionar</button></section>; })}</div> : recordTable(filteredRecords, kind)}
      <div className={s.tableFooter}><span>Dados salvos na plataforma · versão {state.version}</span><span>{mode === 'preview' ? 'Base fictícia isolada' : 'Sua carteira autorizada'}</span></div>
    </section>{kind === 'properties' && <div className={s.helpNote}><Icon name="shield" size={15} />{hasLiveOperation ? <>Os imóveis operacionais são consultados diretamente do catálogo existente. Fotos, características e divulgação são gerenciadas em <button className={s.textButton} onClick={() => navigate('portfolio')}>Catálogo e fotos</button>.</> : 'Os registros desta nova experiência não substituem o catálogo clássico. Fotos, anúncios e integrações já existentes continuam preservados.'}</div>}</>;
  }

  function reports() {
    const sources = Array.from(new Set(scopedCases.map(record => v(record, 'source') || 'Não informada')));
    const ids = new Set(scope.map(record => record.id));
    const events = state.events.filter(event => ids.has(event.recordId) && (!filters.from || event.at.slice(0, 10) >= filters.from) && (!filters.to || event.at.slice(0, 10) <= filters.to));
    const visits = metrics.visits;
    const losses = scopedCases.filter(record => v(record, 'status') === 'Perdido');
    const reasons = Array.from(new Set(losses.map(record => v(record, 'reason') || 'Não informado')));
    const goals = scope.filter(record => record.kind === 'goals');
    return <><div className={s.infoStrip}><Icon name="chart" size={17} />{hasLiveOperation ? <>Relatórios do CRM integrado. Eventos antigos não são inventados; vendas e aluguéis efetivamente registrados continuam em <button className={s.textButton} onClick={() => navigate('results')}>Resultados da operação</button>.</> : 'Relatórios calculados sobre registros da nova experiência. Não são importados eventos históricos que não foram registrados.'}</div><div className={s.reportStats}>{[['Visitas agendadas', visits.length], ['Visitas realizadas', visits.filter(record => v(record, 'status') === 'Realizada').length], ['Propostas aceitas', accepted.length], ['Eventos no histórico', events.length]].map(([name, count]) => <div className={s.reportStat} key={name}><span>{name}</span><strong>{count}</strong></div>)}</div><div className={s.bottomGrid}><section className={s.panel}><div className={s.panelHead}><div><h2>Origem dos atendimentos</h2><p>Resultados atuais por canal de entrada</p></div></div><div className={s.tableWrap}><table className={s.table}><thead><tr><th>Origem</th><th>Total</th><th>Ganhos</th><th>Perdidos</th><th>Abertos / pausados</th></tr></thead><tbody>{sources.map(source => { const rows = scopedCases.filter(record => (v(record, 'source') || 'Não informada') === source); return <tr key={source}><td>{source}</td><td>{rows.length}</td><td>{rows.filter(record => v(record, 'status') === 'Ganho').length}</td><td>{rows.filter(record => v(record, 'status') === 'Perdido').length}</td><td>{rows.filter(record => ['Aberto', 'Pausado'].includes(v(record, 'status'))).length}</td></tr>; })}</tbody></table>{!sources.length && <Empty />}</div></section><section className={s.panel}><div className={s.panelHead}><div><h2>Motivos de perda</h2><p>Informados no encerramento do atendimento</p></div></div><div className={s.barList}>{reasons.map(reason => { const count = losses.filter(record => (v(record, 'reason') || 'Não informado') === reason).length; return <div key={reason}><span>{reason}<b>{count}</b></span><i><em style={{ width: `${count / losses.length * 100}%` }} /></i></div>; })}{!losses.length && <Empty title="Nenhuma perda registrada" text="Os motivos serão apresentados após um encerramento como perdido." />}</div></section></div><section className={s.panel}><div className={s.panelHead}><div><h2>Metas e resultados</h2><p>Meta manual × propostas aceitas no mês de aceite (São Paulo), por finalidade</p></div>{isAdmin && <button className={s.textButton} onClick={() => create('goals')}>Cadastrar meta <Icon name="plus" size={14} /></button>}</div><div className={s.goalsGrid}>{goals.map(goal => { const assignedCases = new Set(state.records.filter(record => record.kind === 'cases' && v(record, 'assignedTo') === v(goal, 'assignedTo') && v(record, 'purpose') === v(goal, 'purpose')).map(record => record.id)); const achieved = state.records.filter(record => record.kind === 'proposals' && v(record, 'status') === 'Aceita' && assignedCases.has(v(record, 'caseId')) && monthInSaoPaulo(record.data.acceptedAt) === v(goal, 'month')).reduce((sum, record) => sum + n(record, 'amount'), 0); const percent = n(goal, 'amount') ? achieved / n(goal, 'amount') * 100 : 0; return <button className={s.goalCard} key={goal.id} onClick={() => setSelectedId(goal.id)}><strong>{label(goal)}</strong><small>{memberName(v(goal, 'assignedTo'))} · {v(goal, 'month')} · {v(goal, 'purpose')}</small><div><b>{money.format(achieved)}{v(goal, 'purpose') === 'Aluguel' ? '/mês' : ''}</b><span>de {money.format(n(goal, 'amount'))}{v(goal, 'purpose') === 'Aluguel' ? '/mês' : ''}</span></div><i><em style={{ width: `${Math.min(100, percent)}%` }} /></i><span>{Math.round(percent)}% da meta informada</span></button>; })}{!goals.length && <Empty title="Nenhuma meta cadastrada" text="Defina metas para acompanhar resultados registrados, sem estimativas fictícias." />}</div></section><details className={s.methodology}><summary>Como os indicadores são calculados</summary><p>O período do funil filtra a criação dos atendimentos no fuso de São Paulo. Propostas e visitas pertencem aos atendimentos dessa mesma seleção, independentemente de sua data individual. Nas demais listas, o período filtra a criação do próprio registro. O inventário do dashboard é atual, sem recorte de data; respeita finalidade e responsável. Contagens do funil são a distribuição atual da carteira, não conversões entre etapas. Ganhos e perdas vêm da situação atual dos atendimentos. Venda e locação são totalizadas separadamente: preço de venda e aluguel mensal não são somados. Os valores vêm de propostas aceitas e não representam receita recebida, comissão ou lucro. As metas são preenchidas manualmente, com resultados pelo mês de acceptedAt no fuso de São Paulo e pelo responsável preservado no fechamento. Mudanças de etapa e demais ações ficam no histórico; a taxa histórica entre etapas só deve ser usada quando houver eventos suficientes e um cálculo de coorte validado.</p></details></>;
  }

  const groups: { title: string; icon: string; items: Page[] }[] = [
    { title: 'Pessoas', icon: 'people', items: ['people', ...(hasLiveOperation ? ['customer-base', ...(isAdmin ? ['imports'] : [])] as Page[] : [])] },
    { title: 'Imóveis', icon: 'home', items: ['properties', ...(hasLiveOperation ? ['portfolio'] as Page[] : []), 'condominiums', 'neighborhoods', 'keys'] },
    { title: 'CRM', icon: 'cases', items: [...(hasLiveOperation ? ['conversations', 'opportunities'] as Page[] : []), 'leads', 'cases', 'proposals', 'operations', 'followups', 'captureGoals', 'shifts'] },
    ...(isAdmin ? [{ title: 'Site', icon: 'globe', items: ['content', 'channels'] as Page[] }] : []),
    { title: 'Ferramentas', icon: 'tool', items: [...(hasLiveOperation ? ['appointments', 'integrations'] as Page[] : []), 'tasks', 'notes', 'links', 'messages', 'notices'] },
    { title: 'Painel de controle', icon: 'settings', items: [...(hasLiveOperation ? ['results', 'account', ...(isAdmin ? ['operational-goals', 'brokers'] : [])] as Page[] : []), 'reports', ...(isAdmin ? ['goals', 'teams', 'members', 'settings'] as Page[] : [])] },
  ];

  return <div className={s.app}>
    <header className={s.header}>
      <button className={s.brand} onClick={() => navigate('dashboard')} aria-label="ImobFlow: ir para o dashboard"><svg width="29" height="36" viewBox="0 0 29 36" fill="none" aria-hidden="true"><path d="M2 34V19l8-4m0 19V8L22 2v32m0-20h5v20" stroke="currentColor" strokeWidth="2" /></svg><span>ImobFlow</span></button>
      <button className={s.mobileMenu} aria-label="Abrir navegação" aria-expanded={mobileNavOpen} aria-controls="evolution-navigation" onClick={() => setMobileNavOpen(current => !current)}><Icon name={mobileNavOpen ? 'close' : 'list'} size={22} /></button>
      <nav id="evolution-navigation" className={`${s.nav} ${mobileNavOpen ? s.mobileNavOpen : ''}`} aria-label="Navegação principal" onKeyDown={event => { if (event.key === 'Escape') { setMenu(null); setMobileNavOpen(false); } }}>
        <button className={`${s.navButton} ${page === 'dashboard' ? s.navActive : ''}`} onClick={() => navigate('dashboard')}>Dashboard</button>
        {groups.map(group => <div className={s.navGroup} key={group.title}><button className={`${s.navButton} ${group.items.includes(page) ? s.navActive : ''}`} onClick={() => setMenu(menu === group.title ? null : group.title)} aria-expanded={menu === group.title}>{group.title}<Icon name="chevron" size={13} /></button>{menu === group.title && <><button className={s.menuDismiss} aria-label="Fechar menu" onClick={() => setMenu(null)} /><div className={s.navDropdown}>{group.items.map(item => <button key={item} className={page === item ? s.dropdownActive : ''} onClick={() => navigate(item)}><Icon name={['tasks', 'appointments'].includes(item) ? 'calendar' : group.icon} size={19} />{pageTitle(item)}</button>)}</div></>}</div>)}
      </nav>
      <div className={s.quickActions}><button className={s.iconButton} onClick={() => navigate(hasLiveOperation ? 'appointments' : 'tasks')} aria-label="Agenda" title="Agenda"><Icon name="calendar" size={21} /></button><button className={s.iconButton} onClick={() => navigate('notes')} aria-label="Anotações" title="Anotações"><Icon name="edit" size={21} /></button><button className={s.iconButton} onClick={() => navigate('notices')} aria-label="Mural de avisos" title="Mural de avisos"><Icon name="tool" size={21} /></button></div>
      <AccountMenu name={actor.name} role={actor.role} preview={mode === 'preview'} onOpen={() => { setMenu(null); setMobileNavOpen(false); }} />
    </header>
    <div className={s.pageHead}><div><h1>{title}</h1></div><div className={s.headActions}><button className={s.secondaryButton} aria-label="Atualizar" onClick={() => void refresh()} disabled={busy}><Icon name="refresh" size={17} /><span>Atualizar</span></button><button className={s.secondaryButton} onClick={() => navigate('operations')}><Icon name="clock" size={16} />Central de gestão{attentionCount > 0 && <b className={s.attentionBadge}>{attentionCount}</b>}</button>{page in MODULES ? canCreate(page as Kind) && <button className={s.primaryButton} onClick={() => create(page as Kind)}><Icon name="plus" size={17} />{MODULES[page as Kind].singular}</button> : page === 'dashboard' && <button className={s.primaryButton} onClick={() => create('cases')}><Icon name="plus" size={17} />Novo atendimento</button>}<a className={s.legacyLink} href="/painel?experiencia=classica" title="Abrir experiência anterior">Painel clássico <Icon name="external" size={14} /></a></div></div>
    <main className={s.main}>
      {mode === 'preview' && <div className={s.previewStrip}><Icon name="shield" size={14} /><strong>Prévia privada</strong><span>Dados fictícios · integrações desligadas · painel clássico preservado.</span></div>}
      {hasLiveOperation && page === 'dashboard' && <div className={s.sourceNotice}><Icon name="shield" size={18} /><div><strong>Sua operação real, no novo painel</strong><span>Clientes, imóveis e visitas existentes conectados à carteira. Conversas, oportunidades e resultados continuam nos módulos operacionais, com as mesmas permissões.</span></div><button className={s.secondaryButton} onClick={() => navigate('conversations')}>Abrir conversas <Icon name="arrow" size={15} /></button></div>}
      {!operationalPage && <>
      <div className={s.searchRow}><div className={s.headerSearch}><Icon name="search" size={20} /><input aria-label="Busca global" placeholder="Busque pessoas, imóveis, atendimentos…" value={globalQuery} onChange={event => setGlobalQuery(event.target.value)} />{globalQuery.length >= 2 && <div className={s.searchResults}>{globalResults.length ? globalResults.map(record => <button key={record.id} onClick={() => { setSelectedId(record.id); setGlobalQuery(''); }}><span>{label(record)}<small>{MODULES[record.kind].title}</small></span><Icon name="arrow" size={15} /></button>) : <p>Nenhum registro encontrado.</p>}</div>}</div><button className={s.secondaryButton} onClick={() => navigate('links')}><Icon name="external" size={18} />Links úteis</button></div>
      {error && !editor && !memberId && <div className={s.error} role="alert"><Icon name="alert" />{error}<button onClick={() => setError('')} aria-label="Fechar aviso"><Icon name="close" size={15} /></button></div>}
      {notice && !editor && !selected && !memberId && <div className={s.success} role="status"><Icon name="check" size={15} />{notice}<button onClick={() => setNotice('')} aria-label="Fechar confirmação"><Icon name="close" size={15} /></button></div>}
      {!['settings', 'members', 'notes', 'links', 'content', 'channels', 'messages', 'notices', 'teams', 'operations'].includes(page) && <div className={s.filterBar}><span className={s.filterLabel}><Icon name="filter" size={15} />Filtros</span><label>De<input type="date" aria-label="Data inicial" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} /></label><label>Até<input type="date" aria-label="Data final" min={filters.from || undefined} value={filters.to} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} /></label><select aria-label="Responsável" value={filters.assignedTo} onChange={event => setFilters(current => ({ ...current, assignedTo: event.target.value }))}><option value="">Todos os responsáveis</option>{state.members.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="Finalidade" value={filters.purpose} onChange={event => setFilters(current => ({ ...current, purpose: event.target.value }))}><option value="">Venda e aluguel</option><option>Venda</option><option>Aluguel</option></select><button className={s.textButton} onClick={() => setFilters(INITIAL_FILTERS)}>Limpar</button><span className={s.filterHint}>{filters.from || filters.to ? 'Por data de criação' : 'Todo o período'}</span></div>}
      {page === 'operations' ? <OperationsCenter preview={mode === 'preview'} state={state} actor={actor} busy={busy} execute={execute} onOpenConversations={hasLiveOperation ? () => navigate('conversations') : undefined} onCreate={create} onSelect={setSelectedId} onEdit={record => { setError(''); setEditor({ kind: record.kind, record }); }} /> : <>
      {page === 'dashboard' ? dashboard() : page === 'reports' ? reports() : page === 'members' ? <section className={s.panel}><div className={s.infoStrip}><Icon name="shield" size={17} />A especialidade não oculta nem redistribui atendimentos enquanto a regra de separação estiver desligada.</div><div className={s.tableWrap}><table className={s.table}><thead><tr><th>Usuário</th><th>Perfil</th><th>Especialidade</th><th>Equipe</th><th>Ações</th></tr></thead><tbody>{state.members.map(item => <tr key={item.id}><td><span className={s.personCell}><i>{initials(item.name)}</i>{item.name}</span></td><td>{item.role === 'owner' ? 'Administrador' : 'Corretor'}</td><td><Pill>{item.specialization || 'Ambos'}</Pill></td><td>{item.teamId ? String(refName(item.teamId)) : 'Sem equipe'}</td><td>{isAdmin && <button className={s.textButton} onClick={() => { setError(''); setMemberId(item.id); }}><Icon name="edit" size={14} />Editar acesso</button>}</td></tr>)}</tbody></table></div><div className={s.panelFoot}>{hasLiveOperation ? <>Cadastre corretores e gerencie credenciais em <button className={s.textButton} onClick={() => navigate('brokers')}>Corretores e acessos</button>. As permissões desta tela aplicam-se aos módulos adicionais do CRM.</> : 'Novos usuários e credenciais continuam sendo gerenciados no painel clássico. Nenhuma senha é exibida nesta tela.'}</div></section> : page === 'settings' ? <SettingsView state={state} busy={busy} execute={execute} isAdmin={isAdmin} integrated={hasLiveOperation} onIntegrations={() => navigate('integrations')} /> : moduleView(page as Kind)}
      </>}
      </>}
      {hasLiveOperation && mountedOperationalPage && renderOperationalPanel && <div className={s.operationalPanel} hidden={!operationalPage} inert={!operationalPage} aria-hidden={!operationalPage}>{renderOperationalPanel(mountedOperationalPage, operationalRefresh, next => navigate(next))}</div>}
      <footer className={s.footer}><span>ImobFlow <b>·</b> Operação conectada</span><a className={s.textButton} href="/painel?experiencia=classica">Painel clássico <Icon name="external" size={14} /></a><span>{mode === 'preview' ? 'Prévia protegida' : hasLiveOperation ? 'Operação real integrada' : 'Nova experiência'} · versão dos dados {state.version}</span></footer>
    </main>
    {editor && <RecordEditor editor={editor} state={state} actor={actor} busy={busy} error={error} onClose={() => { if (!busy) { setEditor(null); setError(''); } }} onSave={async data => { if (await execute({ type: 'save', kind: editor.kind, ...(editor.record ? { id: editor.record.id } : {}), data })) setEditor(null); }} />}
    {selected && !editor && <RecordDetail key={selected.id} onOpenOperational={hasLiveOperation ? next => navigate(next) : undefined} record={selected} state={state} actor={actor} busy={busy} error={error} onClose={() => { setSelectedId(null); setError(''); }} onEdit={() => { setError(''); setEditor({ kind: selected.kind, record: selected }); }} onCreate={create} onSelect={setSelectedId} execute={execute} />}
    {member && <MemberEditor member={member} state={state} busy={busy} error={error} onClose={() => setMemberId(null)} onSave={async command => { if (await execute(command)) setMemberId(null); }} />}
  </div>;
}

function fieldSection(kind: Kind, field: Field) {
  if (kind === 'people') return ['name', 'personType', 'category', 'assignedTo'].includes(field.key) ? 'Identificação e responsável' : ['phone', 'email', 'address', 'preferredChannel', 'contactPeriod'].includes(field.key) ? 'Contato e preferências' : 'Observações';
  if (kind === 'leads') return ['name', 'personId', 'assignedTo', 'source', 'status', 'temperature'].includes(field.key) ? 'Contato e atendimento' : ['purpose', 'propertyId', 'propertyType', 'city', 'region', 'bedrooms', 'parkingSpaces', 'features'].includes(field.key) ? 'O imóvel que o cliente procura' : ['budgetMin', 'budgetMax', 'purchaseTimeline', 'financing', 'qualificationNotes'].includes(field.key) ? 'Orçamento e qualificação' : 'Observações';
  if (kind === 'properties') return ['name', 'code', 'purpose', 'price', 'status', 'assignedTo', 'ownerId'].includes(field.key) ? 'Identificação e negociação' : ['city', 'district', 'address', 'neighborhoodId', 'condominiumId'].includes(field.key) ? 'Localização' : ['propertyType', 'bedrooms', 'bathrooms', 'parkingSpaces', 'area', 'features', 'condoFee', 'iptu'].includes(field.key) ? 'Características e valores' : 'Apresentação e documentação';
  return 'Informações do registro';
}

function RecordEditor({ editor, state, actor, busy, error, onClose, onSave }: { editor: Editor; state: CrmState; actor: Actor; busy: boolean; error: string; onClose: () => void; onSave: (data: Values) => Promise<void> }) {
  const definition = MODULES[editor.kind];
  const brokerReply = actor.role !== 'owner' && editor.kind === 'followups';
  const initial: Values = {};
  for (const field of definition.fields) {
    if (editor.record?.legacy) initial[field.key] = '';
    else {
      if (field.required && field.options?.length) initial[field.key] = field.options[0];
      if (field.ref === 'members') initial[field.key] = ['followups', 'captureGoals', 'shifts'].includes(editor.kind) ? '' : actor.brokerId;
    }
  }
  const rawValues = { ...initial, ...(editor.record?.data || {}), ...(editor.defaults || {}) };
  const prepared: Values = {};
  for (const field of definition.fields) {
    let value = rawValues[field.key] ?? '';
    if (field.type === 'datetime-local' && typeof value === 'string' && validDate(value)) {
      const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
      const part = (name: string) => parts.find(item => item.type === name)?.value;
      value = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
    }
    prepared[field.key] = value;
  }
  const [data, setData] = useState<Values>(prepared);
  const duplicate = editor.kind === 'people' && state.records.some(record => record.kind === 'people' && record.id !== editor.record?.id && ((data.email && v(record, 'email').toLowerCase() === String(data.email).toLowerCase()) || (data.phone && v(record, 'phone').replace(/\D/g, '') === String(data.phone).replace(/\D/g, ''))));
  const fields = definition.fields.filter(field => !brokerReply || ['response', 'status'].includes(field.key));
  const sections = [...new Set(fields.map(field => fieldSection(editor.kind, field)))];
  const draftRecord: CrmRecord = { id: editor.record?.id || 'draft', kind: editor.kind, data, createdAt: editor.record?.createdAt || new Date().toISOString(), updatedAt: editor.record?.updatedAt || new Date().toISOString(), createdBy: actor.brokerId };
  const update = (field: Field, value: string) => setData(current => {
    const next: Values = { ...current, [field.key]: field.type === 'number' && value !== '' ? Number(value) : value };
    if (field.key === 'journey') next.stage = 'Lead';
    if (['caseId', 'leadId'].includes(field.key)) {
      const record = state.records.find(item => item.id === value);
      if (record) for (const key of ['assignedTo', 'propertyId', ...(field.key === 'leadId' ? ['personId', 'source', 'purpose'] : [])]) {
        if (record.data[key] && definition.fields.some(item => item.key === key)) next[key] = record.data[key];
      }
    }
    return next;
  });
  function fieldControl(field: Field) {
    const missingOriginal = Boolean(editor.record?.legacy && (editor.record.data[field.key] === undefined || editor.record.data[field.key] === ''));
    const required = Boolean(field.required && !missingOriginal);
    const storedPhoto = field.key === 'photoUrl' && editor.record?.legacy && /^data:image\//.test(String(data[field.key] || ''));
    let options = field.key === 'stage' ? (data.journey === 'Captação' ? CAPTURE_STAGES : NEGOTIATION_STAGES) : field.key === 'category' ? [...new Set([...state.settings.categories, 'Cliente e proprietário'])] : field.options;
    if (editor.kind === 'followups' && field.key === 'status') {
      options = !editor.record ? ['Pendente'] : brokerReply ? (editor.record.data.status === 'Respondida' ? ['Respondida'] : editor.record.data.status === 'Em andamento' ? ['Em andamento', 'Respondida'] : ['Pendente', 'Em andamento', 'Respondida']) : options?.filter(option => option !== 'Concluída' || editor.record?.data.status === 'Respondida');
    }
    const assignmentFromConversation = Boolean(editor.record?.legacy?.table === 'leads' && field.key === 'assignedTo');
    const locked = assignmentFromConversation || Boolean(editor.record && ((editor.kind === 'cases' && ['source', 'personId', 'leadId', 'journey'].includes(field.key)) || (['tasks', 'proposals'].includes(editor.kind) && field.key === 'caseId')));
    const references = field.ref === 'members'
      ? state.members.filter(item => editor.kind !== 'shifts' || item.role === 'broker').map(item => ({ id: item.id, name: item.name }))
      : field.ref ? state.records.filter(record => record.kind === field.ref).map(record => ({ id: record.id, name: label(record) })) : null;
    const id = `edit-${field.key}`;
    const rental = data.purpose === 'Aluguel' || (editor.kind === 'proposals' && state.records.some(item => item.id === data.caseId && item.data.purpose === 'Aluguel'));
    const fieldLabel = rental && field.key === 'amount' ? (editor.kind === 'goals' ? 'Meta de aluguel mensal contratado (R$)' : 'Aluguel mensal proposto (R$)') : rental && field.key === 'price' ? 'Aluguel mensal (R$)' : field.label;
    return <label key={field.key} htmlFor={id} className={field.type === 'textarea' ? s.fullField : ''}>
      <span>{fieldLabel}{required && <b> *</b>}</span>
      {storedPhoto ? <small>Foto existente preservada. Gerencie imagens em Catálogo e fotos.</small>
        : references ? <><select id={id} disabled={locked || busy} required={required} value={String(data[field.key] ?? '')} onChange={event => update(field, event.target.value)}><option value="">Selecione…</option>{references.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{assignmentFromConversation && <small>O responsável é definido ao assumir ou devolver o atendimento em Conversas.</small>}{references.length === 0 && <small>Cadastre {field.ref === 'members' ? 'um usuário' : MODULES[field.ref as Kind].singular.toLowerCase()} antes de vincular.</small>}</>
        : options ? <select id={id} disabled={locked || busy} required={required} value={String(data[field.key] ?? '')} onChange={event => update(field, event.target.value)}>{(missingOriginal || !required) && <option value="">Não informado</option>}{options.map(option => <option key={option}>{option}</option>)}</select>
        : field.type === 'textarea' ? <textarea id={id} disabled={busy} rows={field.key === 'response' ? 5 : 3} required={required || field.key === 'response' && data.status === 'Respondida'} value={String(data[field.key] ?? '')} onChange={event => update(field, event.target.value)} />
        : <input id={id} disabled={locked || busy} list={field.key === 'source' ? 'evolution-sources' : field.key === 'reason' ? 'evolution-reasons' : undefined} type={field.type || 'text'} required={required} min={field.min} step={field.type === 'number' ? field.key === 'target' ? '1' : 'any' : undefined} value={String(data[field.key] ?? '')} onChange={event => update(field, event.target.value)} {...(field.key === 'month' ? { pattern: '[0-9]{4}-(0[1-9]|1[0-2])', placeholder: '2026-10' } : {})} />}
    </label>;
  }
  return <Dialog title={brokerReply ? 'Responder ao gestor' : `${editor.record ? 'Editar' : 'Cadastrar'} ${definition.singular.toLowerCase()}`} subtitle="Os campos com * são obrigatórios. Alterações ficam registradas no histórico." onClose={onClose} wide>
    <form onSubmit={event => { event.preventDefault(); void onSave(brokerReply ? { status: data.status, response: data.response } : data); }}>
      <div className={s.formBody}>
        {error && <div className={s.error} role="alert"><Icon name="alert" size={16} />{error}</div>}
        {duplicate && <div className={s.warning}><Icon name="alert" size={16} />Já existe uma pessoa com este telefone ou email. Confira o cadastro existente; os contatos não serão mesclados automaticamente.</div>}
        {definition.description && <p className={s.formNote}>{definition.description}</p>}
        {brokerReply && editor.record && <div className={s.followupContext}><strong>{v(editor.record, 'name')}</strong><p>{v(editor.record, 'request')}</p><small>Prazo: {date(v(editor.record, 'dueAt'), true)} · a conclusão depende da revisão do gestor.</small></div>}
        {['people', 'leads', 'properties'].includes(editor.kind) && <CatalogHealth state={state} record={draftRecord} />}
        {sections.map(section => <fieldset className={s.formSection} key={section}><legend>{section}</legend><div className={s.formGrid}>{fields.filter(field => fieldSection(editor.kind, field) === section).map(fieldControl)}</div></fieldset>)}
        <datalist id="evolution-sources">{state.settings.sources.map(item => <option key={item} value={item} />)}</datalist>
        <datalist id="evolution-reasons">{state.settings.lossReasons.map(item => <option key={item} value={item} />)}</datalist>
        {editor.kind === 'proposals' && <p className={s.formNote}>Marcar como “Enviada” registra o status interno. Não envia uma mensagem ao cliente.</p>}
        {editor.kind === 'cases' && <p className={s.formNote}>Pausas e perdas precisam de motivo. Uma mudança de etapa mantém o histórico anterior.</p>}
        {editor.kind === 'followups' && <p className={s.formNote}>O corretor envia o retorno como “Respondida”. O gestor confere, escreve a avaliação e conclui ou solicita um novo retorno. Não há envio ao cliente.</p>}
      </div>
      <footer className={s.dialogActions}><button type="button" className={s.secondaryButton} onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className={s.primaryButton} disabled={busy}><Icon name="check" size={16} />{busy ? 'Salvando…' : brokerReply && data.status === 'Respondida' ? 'Enviar retorno ao gestor' : 'Salvar registro'}</button></footer>
    </form>
  </Dialog>;
}

function RecordDetail({ record, state, actor, busy, error, onClose, onEdit, onCreate, onSelect, execute, onOpenOperational }: { record: CrmRecord; state: CrmState; actor: Actor; busy: boolean; error: string; onClose: () => void; onEdit: () => void; onCreate: (kind: Kind, defaults?: Values) => void; onSelect: (id: string) => void; execute: (command: Command) => Promise<boolean>; onOpenOperational?: (page: OperationalPage) => void }) {
  const [tab, setTab] = useState<'details' | 'history' | 'related'>('details');
  const [comment, setComment] = useState('');
  const definition = MODULES[record.kind];
  const events = state.events.filter(event => event.recordId === record.id || (record.kind === 'cases' && event.caseId === record.id)).slice().sort((a, b) => b.at.localeCompare(a.at));
  const related = state.records.filter(item => item.id !== record.id && ['personId', 'caseId', 'propertyId', 'leadId', 'ownerId', 'condominiumId', 'neighborhoodId'].some(key => v(item, key) === record.id));
  const canEdit = canAccess(state, actor, record, 'write'); const resultLocked = (record.kind === 'followups' && ['Concluída', 'Cancelada'].includes(v(record, 'status'))) || (record.kind === 'proposals' && v(record, 'status') === 'Aceita') || (record.kind === 'keys' && v(record, 'status') === 'Devolvida');
  return <Dialog title={label(record)} subtitle={`${definition.singular} · criado em ${date(record.createdAt, true)}`} onClose={onClose} wide>{record.legacy && <div className={s.sourceNotice}><Icon name="shield" size={18} /><div><strong>Cadastro da operação ImobFlow</strong><span>Dados vinculados ao registro original. {canEdit ? "As alterações permitidas nesta ficha atualizam o cadastro real." : "Seu acesso a esta ficha é de consulta."}{record.legacy.missingPurpose ? " A finalidade ainda não foi informada no cadastro de origem." : ""}</span></div>{onOpenOperational && <button className={s.secondaryButton} onClick={() => onOpenOperational(record.kind === 'properties' ? 'portfolio' : record.kind === 'tasks' ? 'appointments' : 'conversations')}>{record.kind === 'properties' ? 'Fotos e catálogo' : record.kind === 'tasks' ? 'Abrir agenda' : 'Abrir conversas'}<Icon name="arrow" size={14} /></button>}</div>}{['people', 'leads', 'properties'].includes(record.kind) && <div className={s.detailCatalog}><CatalogHealth state={state} record={record} /></div>}<div className={s.detailActions}>{v(record, 'status') && <Pill>{v(record, 'status')}</Pill>}{v(record, 'purpose') && <Pill tone="blue">{v(record, 'purpose')}</Pill>}{record.kind === 'cases' && canEdit && v(record, 'status') === 'Aberto' && <><button className={s.secondaryButton} onClick={() => onCreate('tasks', { caseId: record.id, assignedTo: record.data.assignedTo, propertyId: record.data.propertyId || '', type: 'Visita' })}><Icon name="calendar" size={15} />Agendar</button><button className={s.secondaryButton} onClick={() => onCreate('proposals', { caseId: record.id, propertyId: record.data.propertyId || '' })}><Icon name="tool" size={15} />Proposta</button></>}{record.kind === 'leads' && canEdit && <button className={s.secondaryButton} onClick={() => onCreate('cases', { name: `Atendimento · ${label(record)}`, personId: record.data.personId, leadId: record.id, assignedTo: record.data.assignedTo, source: record.data.source, purpose: record.data.purpose, propertyId: record.data.propertyId || '', journey: 'Negociação', stage: 'Atendimento', status: 'Aberto' })}><Icon name="cases" size={15} />Iniciar atendimento</button>}{canEdit && !resultLocked && <button className={s.primaryButton} onClick={onEdit}><Icon name="edit" size={15} />Editar</button>}</div>{record.kind === 'cases' && v(record, 'status') !== 'Aberto' && <div className={s.infoStrip}><Icon name="shield" size={15} />{v(record, 'status') === 'Ganho' ? 'Atendimento concluído. O resultado e o histórico estão preservados. Para uma nova negociação, abra outro atendimento.' : 'Este atendimento não está aberto. Para agendar atividades ou criar propostas, reabra-o em Editar e registre o motivo.'}</div>}<div className={s.tabs}>{([['details', 'Informações'], ['history', `Histórico (${events.length})`], ['related', `Relacionados (${related.length})`]] as const).map(([key, text]) => <button key={key} onClick={() => setTab(key)} className={tab === key ? s.tabActive : ''}>{text}</button>)}</div><div className={s.detailBody}>{error && <div className={s.error} role="alert">{error}</div>}{tab === 'details' ? <dl className={s.detailGrid}>{definition.fields.map(field => { const value = v(record, field.key); let text: ReactNode = value || 'Não informado'; if (field.ref === 'members') text = state.members.find(item => item.id === value)?.name || 'Não informado'; else if (field.ref && value) text = <button className={s.textButton} onClick={() => onSelect(value)}>{state.records.find(item => item.id === value)?.data.name || 'Abrir registro'}<Icon name="arrow" size={13} /></button>; else if (field.type === 'date' || field.type === 'datetime-local') text = date(value, field.type === 'datetime-local'); else if (['price', 'amount', 'budgetMin', 'budgetMax'].includes(field.key)) text = value ? money.format(Number(value)) : 'Não informado'; else if (field.type === 'url' && /^https?:\/\//i.test(value)) text = <a className={s.textButton} href={value} target="_blank" rel="noreferrer">Abrir link <Icon name="external" size={13} /></a>; return <div key={field.key} className={field.type === 'textarea' ? s.fullField : ''}><dt>{field.label}</dt><dd>{text}</dd></div>; })}</dl> : tab === 'history' ? <><div className={s.history}>{events.map(event => <article key={event.id}><span className={s.historyDot}><Icon name={event.type.includes('stage') ? 'arrow' : 'check'} size={12} /></span><header><strong>{event.summary}</strong><time>{date(event.at, true)}</time></header><p>{event.actorName}</p>{event.changes && <dl>{Object.entries(event.changes).map(([key, change]) => <div key={key}><dt>{definition.fields.find(field => field.key === key)?.label || key}</dt><dd>{typeof change === 'object' ? `${String(change.from || '—')} → ${String(change.to || '—')}` : String(change)}</dd></div>)}</dl>}</article>)}{events.length === 0 && <Empty title="Sem eventos anteriores" text="Não criamos históricos fictícios de períodos anteriores ao cadastro." />}</div>{canEdit && <form className={s.commentForm} onSubmit={async event => { event.preventDefault(); if (await execute({ type: 'comment', id: record.id, text: comment })) setComment(''); }}><label htmlFor="history-note">Registrar observação interna</label><textarea id="history-note" required maxLength={4000} rows={3} value={comment} onChange={event => setComment(event.target.value)} placeholder="Descreva o contato, o retorno ou o próximo passo…" /><button className={s.primaryButton} disabled={busy || !comment.trim()}>{busy ? 'Salvando…' : 'Adicionar ao histórico'}</button></form>}</> : related.length ? <div className={s.relatedList}>{related.map(item => <button key={item.id} onClick={() => onSelect(item.id)}><span><small>{MODULES[item.kind].singular}</small><strong>{label(item)}</strong></span>{v(item, 'status') && <Pill>{v(item, 'status')}</Pill>}<Icon name="arrow" size={16} /></button>)}</div> : <Empty title="Nenhum vínculo registrado" text="Atendimentos, imóveis e atividades vinculados a este registro aparecerão aqui." />}</div><footer className={s.detailFooter}><Icon name="shield" size={13} />Registro preservado. Última atualização: {date(record.updatedAt, true)}.</footer></Dialog>;
}

function SettingsView({ state, busy, execute, isAdmin, integrated, onIntegrations }: { state: CrmState; busy: boolean; execute: (command: Command) => Promise<boolean>; isAdmin: boolean; integrated: boolean; onIntegrations: () => void }) {
  const [days, setDays] = useState<Record<string, number>>(state.settings.inactivityDays);
  const [sources, setSources] = useState(state.settings.sources.join('\n'));
  const [categories, setCategories] = useState(state.settings.categories.join('\n'));
  const [reasons, setReasons] = useState(state.settings.lossReasons.join('\n'));
  const toList = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
  return <div className={s.settingsGrid}>
    <OperationsSettings state={state} isAdmin={isAdmin} busy={busy} execute={execute} />
    <section className={s.panel}>
      <div className={s.panelHead}><div><h2>Distribuição por especialidade</h2><p>Preferências de venda e aluguel</p></div><Icon name="people" /></div>
      <div className={s.settingsBody}>
        <Pill tone="amber">Distribuição automática desligada</Pill>
        <p>As especialidades podem ser cadastradas por usuário. Elas não ocultam nem redistribuem automaticamente a carteira existente.</p>
        <div className={s.warning}><Icon name="alert" size={17} />A separação automática ainda não está habilitada. Atendimentos continuam sujeitos ao responsável e às permissões de carteira configuradas.</div>
        <p>O acesso por módulo permite consultar ou editar a carteira de outros corretores, quando autorizado pelo administrador.</p>
      </div>
    </section>
    <section className={s.panel}>
      <div className={s.panelHead}><div><h2>Prazos de acompanhamento</h2><p>Dias sem atualização por etapa do atendimento</p></div><Icon name="clock" /></div>
      <form className={s.settingsBody} onSubmit={event => { event.preventDefault(); void execute({ type: 'settings', settings: { inactivityDays: days } }); }}>
        <div className={s.thresholdGrid}>{[...NEGOTIATION_STAGES, 'Avaliação', 'Captado'].map(stage => <label key={stage}>{stage}<span><input type="number" min={1} max={365} required disabled={!isAdmin} value={days[stage] ?? 7} onChange={event => setDays(current => ({ ...current, [stage]: Number(event.target.value) }))} />dias</span></label>)}</div>
        <p className={s.formNote}>Em atenção a partir de 80% do prazo. Atrasado quando atingir o limite. São alertas internos, sem envio de mensagens.</p>
        <button className={s.primaryButton} disabled={busy || !isAdmin}>{busy ? 'Salvando…' : 'Salvar prazos'}</button>
      </form>
    </section>
    <section className={s.panel}>
      <div className={s.panelHead}><div><h2>Origens, categorias e motivos</h2><p>Uma opção por linha · até 50 por lista</p></div><Icon name="settings" /></div>
      <form className={s.settingsBody} onSubmit={event => { event.preventDefault(); void execute({ type: 'settings', settings: { sources: toList(sources), categories: toList(categories), lossReasons: toList(reasons) } }); }}>
        <div className={s.formGrid}>
          <label className={s.fullField}>Origens dos leads<textarea required rows={4} maxLength={5000} value={sources} disabled={!isAdmin} onChange={event => setSources(event.target.value)} /></label>
          <label>Categorias de pessoas<textarea required rows={4} maxLength={5000} value={categories} disabled={!isAdmin} onChange={event => setCategories(event.target.value)} /></label>
          <label>Motivos de perda<textarea required rows={4} maxLength={5000} value={reasons} disabled={!isAdmin} onChange={event => setReasons(event.target.value)} /></label>
        </div>
        <p className={s.formNote}>As opções orientam novos cadastros. Valores e históricos já registrados são preservados.</p>
        <button className={s.primaryButton} disabled={busy || !isAdmin}>{busy ? 'Salvando…' : 'Salvar opções'}</button>
      </form>
    </section>
    <section className={s.panel}>
      <div className={s.panelHead}><div><h2>Integrações e segurança</h2><p>Operação externa preservada</p></div><Icon name="shield" /></div>
      <div className={s.settingsBody}>{integrated ? <><Pill tone="blue">Operação real conectada</Pill><p>Clientes, imóveis e visitas são consultados a partir dos cadastros existentes. Os módulos operacionais preservam as mensagens, conexões, fotos, credenciais e permissões atuais.</p><p>Os módulos adicionais do CRM não enviam mensagens automaticamente nem publicam conteúdo em portais. Envio pelo WhatsApp continua sujeito às ações explícitas e verificações da central de conversas.</p><button onClick={onIntegrations} className={s.secondaryButton}>Gerenciar integrações <Icon name="arrow" size={14} /></button></> : <><Pill tone="amber">Nenhum disparo nesta prévia</Pill><p>WhatsApp, email e publicação em portais não são acionados por esta nova experiência. As conexões da plataforma atual não são alteradas.</p><p>A nova base é independente. Os dados da operação clássica não são importados, migrados nem substituídos por estes cadastros.</p><a href="/painel?experiencia=classica" className={s.secondaryButton}>Acessar experiência clássica <Icon name="external" size={14} /></a></>}</div>
    </section>
  </div>;
}

function MemberEditor({ member, state, busy, error, onClose, onSave }: { member: CrmState['members'][number]; state: CrmState; busy: boolean; error: string; onClose: () => void; onSave: (command: Command) => Promise<void> }) {
  const [specialization, setSpecialization] = useState<'Venda' | 'Aluguel' | 'Ambos'>(member.specialization || 'Ambos');
  const [teamId, setTeamId] = useState(member.teamId || '');
  const [permissions, setPermissions] = useState<NonNullable<typeof member.permissions>>(member.permissions || {});
  const permissionKinds = (Object.keys(MODULES) as Kind[]).filter(kind => !MODULES[kind].admin && !['notes', 'messages', 'tasks', 'proposals', 'followups', 'captureGoals', 'shifts'].includes(kind));
  function changePermission(kind: Kind, permission: 'readOthers' | 'editOthers', checked: boolean) {
    setPermissions(current => {
      const next = { readOthers: current[kind]?.readOthers || false, editOthers: current[kind]?.editOthers || false, [permission]: checked };
      if (permission === 'editOthers' && checked) next.readOthers = true;
      if (permission === 'readOthers' && !checked) next.editOthers = false;
      return { ...current, [kind]: next };
    });
  }
  return <Dialog title={`Acesso · ${member.name}`} subtitle="Estas alterações não transferem automaticamente a carteira." onClose={onClose} wide>
    <form onSubmit={event => { event.preventDefault(); void onSave({ type: 'member', id: member.id, specialization, teamId, permissions }); }}>
      <div className={s.formBody}>{error && <div className={s.error} role="alert">{error}</div>}
        <div className={s.formGrid}>
          <label>Especialidade<select value={specialization} onChange={event => setSpecialization(event.target.value as typeof specialization)}><option value="Ambos">Venda e aluguel</option><option value="Venda">Apenas venda</option><option value="Aluguel">Apenas aluguel</option></select></label>
          <label>Equipe<select value={teamId} onChange={event => setTeamId(event.target.value)}><option value="">Sem equipe</option>{state.records.filter(record => record.kind === 'teams').map(record => <option key={record.id} value={record.id}>{label(record)}</option>)}</select></label>
        </div>
        <p className={s.formNote}>{member.role === 'owner' ? 'Administradores têm acesso administrativo à empresa. Notas pessoais e mensagens internas continuam privadas.' : 'Por padrão, o corretor trabalha com a própria carteira. Os controles abaixo ampliam apenas os acessos explicitamente selecionados.'}</p>
        <div className={s.tableWrap}><table className={`${s.table} ${s.permissionTable}`}><thead><tr><th>Módulo</th><th>Consultar carteira de outros</th><th>Editar carteira de outros</th></tr></thead><tbody>{permissionKinds.map(kind => <tr key={kind}><td>{MODULES[kind].title}</td><td><input type="checkbox" disabled={member.role === 'owner'} checked={member.role === 'owner' || Boolean(permissions[kind]?.readOthers)} aria-label={`Consultar outros: ${MODULES[kind].title}`} onChange={event => changePermission(kind, 'readOthers', event.target.checked)} /></td><td><input type="checkbox" disabled={member.role === 'owner'} checked={member.role === 'owner' || Boolean(permissions[kind]?.editOthers)} aria-label={`Editar outros: ${MODULES[kind].title}`} onChange={event => changePermission(kind, 'editOthers', event.target.checked)} /></td></tr>)}</tbody></table></div>
        <p className={s.formNote}>Propostas e atividades herdam o acesso do atendimento. Bairros, condomínios e links têm leitura compartilhada. Notas pessoais e mensagens não são abertas por estas permissões. As regras são verificadas pelo servidor em cada operação.</p>
      </div>
      <footer className={s.dialogActions}><button type="button" className={s.secondaryButton} onClick={onClose} disabled={busy}>Cancelar</button><button className={s.primaryButton} disabled={busy}>{busy ? 'Salvando…' : 'Salvar acesso'}</button></footer>
    </form>
  </Dialog>;
}
