'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdAccount, AdDraft, Campaign, Insight } from '@/lib/meta-ads';
import type { AdAttributionReport } from '@/lib/meta-ads-attribution';
import s from './meta-ads-panel.module.css';

type Status = { available: boolean; connected: boolean; accountId?: string; accountName?: string; currency?: string; expiresAt?: string };
type Metrics = { campaigns: Campaign[]; insights: Insight[]; currency: string; since: string; until: string };
type Section = 'overview' | 'create' | 'ads' | 'results' | 'connection';
type DraftState = { dirty: boolean; busy: boolean };
const sections: Array<{ id: Section; label: string }> = [{ id: 'overview', label: 'Visão geral' }, { id: 'create', label: 'Criar campanha' }, { id: 'ads', label: 'Anúncios' }, { id: 'results', label: 'Resultados no CRM' }, { id: 'connection', label: 'Conexão' }];
const endpoint = '/api/integrations/meta/ads';
const emptyDraft = { campaignId: '', pageId: '', name: '', title: '', message: '', destinationUrl: '', imageUrl: '', dailyBudget: '', confirmBudget: false };
const situation = (value: string) => ({ ACTIVE: 'Ativa', PAUSED: 'Pausada', ARCHIVED: 'Arquivada', DELETED: 'Excluída', IN_PROCESS: 'Em processamento', WITH_ISSUES: 'Requer atenção', HISTORICAL: 'Histórico' }[value] || value);
const objectiveLabel = (value: string) => ({ OUTCOME_LEADS: 'Cadastros', OUTCOME_TRAFFIC: 'Tráfego', OUTCOME_ENGAGEMENT: 'Engajamento' }[value] || value || 'Não informado');
const formatDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : value;
const number = (value: number) => value.toLocaleString('pt-BR');
const numeric = (value: string | undefined) => Number(value || 0);

async function request<T>(query = '', body?: object): Promise<T> {
  const response = await fetch(endpoint + query, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Não foi possível acessar a Meta.');
  return data;
}
async function readMetrics(since: string, until: string) {
  const data = await request<Metrics>(`?action=metrics&since=${since}&until=${until}`);
  if (!Array.isArray(data.campaigns) || !Array.isArray(data.insights)) throw new Error('A conta de anúncios não está disponível. Confira a conexão.');
  return data;
}

export default function MetaAdsPanel({ integrated, standalone = false, onDraftState }: { integrated: boolean; standalone?: boolean; onDraftState?: (state: DraftState) => void }) {
  const [open, setOpen] = useState(standalone), [section, setSection] = useState<Section>('overview');
  const [status, setStatus] = useState<Status | null>(null), [accounts, setAccounts] = useState<AdAccount[]>([]), [metrics, setMetrics] = useState<Metrics | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [since, setSince] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)), [until, setUntil] = useState(() => new Date().toISOString().slice(0, 10));
  const initialPeriod = useRef({ since, until });
  const [name, setName] = useState(''), [budget, setBudget] = useState(''), [objective, setObjective] = useState('OUTCOME_TRAFFIC');
  const [createdCampaign, setCreatedCampaign] = useState('');
  const campaignRequestId = useRef<string | null>(null), draftRequestId = useRef<string | null>(null);
  const [campaignPending, setCampaignPending] = useState(false), [draftPending, setDraftPending] = useState(false);
  const [pages, setPages] = useState<Array<{ id: string; name: string }>>([]), [drafts, setDrafts] = useState<AdDraft[]>([]), [draftsLoaded, setDraftsLoaded] = useState(false);
  const [attribution, setAttribution] = useState<AdAttributionReport | null>(null), [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(''), [manageBudget, setManageBudget] = useState(''), [confirmSpend, setConfirmSpend] = useState(false);
  const [query, setQuery] = useState(''), [statusFilter, setStatusFilter] = useState('all');
  const busyRef = useRef(false);
  const allowNavigation = useRef(false);
  const accountRef = useRef<string | null | undefined>(undefined);
  const dirtyRef = useRef(false);
  const editing = metrics?.campaigns.find(campaign => campaign.id === editingId);
  const budgetEdited = Boolean(editing && manageBudget !== (editing.daily_budget ? String(Number(editing.daily_budget) / 100) : ''));
  const dirty = Boolean(name || budget || objective !== 'OUTCOME_TRAFFIC' || Object.values(draft).some(Boolean) || budgetEdited || confirmSpend || campaignPending || draftPending);

  useEffect(() => { dirtyRef.current = dirty; onDraftState?.(allowNavigation.current ? { dirty: false, busy: false } : { dirty, busy }); }, [dirty, busy, onDraftState]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { if (allowNavigation.current) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  const clearAccountData = useCallback(() => {
    setMetrics(null); setPages([]); setDrafts([]); setDraftsLoaded(false); setEditingId(''); setManageBudget(''); setConfirmSpend(false);
    setDraft(emptyDraft); draftRequestId.current = null; campaignRequestId.current = null; setDraftPending(false); setCampaignPending(false); setName(''); setBudget(''); setObjective('OUTCOME_TRAFFIC'); setCreatedCampaign(''); setQuery(''); setStatusFilter('all');
  }, []);
  const refresh = useCallback(async () => {
    const next = await request<Status>();
    const nextAccount = next.connected ? next.accountId || null : null;
    if (accountRef.current !== undefined && accountRef.current !== nextAccount) {
      clearAccountData();
      setNotice(dirtyRef.current ? 'A conta de anúncios foi alterada. Os dados da conta anterior foram removidos desta tela; confira qualquer solicitação pendente no Gerenciador da Meta.' : 'A conta de anúncios foi alterada. Consulte os dados da conta selecionada.');
    }
    accountRef.current = nextAccount;
    setStatus(next);
    if (next.connected) setAccounts((await request<{ accounts: AdAccount[] }>('?action=accounts')).accounts || []);
    else { setAccounts([]); clearAccountData(); }
    return next;
  }, [clearAccountData]);
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    if (!open || !integrated) return;
    void run(async () => {
      const next = await refresh();
      if (next.connected && next.accountId) setMetrics(await readMetrics(initialPeriod.current.since, initialPeriod.current.until));
      if (new URLSearchParams(window.location.search).get('metaAds') === 'failed') setError('A conexão não foi concluída. Autorize novamente pela Meta e confira as permissões da conta.');
    });
  }, [open, integrated, refresh, run]);

  const ready = Boolean(integrated && status?.connected && status.accountId);
  const invalidDates = !since || !until || since > until;
  const stalePeriod = Boolean(metrics && (metrics.since !== since || metrics.until !== until));
  const currency = metrics?.currency || status?.currency || 'BRL';
  const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  const crmMoney = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  const managerUrl = status?.accountId ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${status.accountId.replace('act_', '')}` : 'https://adsmanager.facebook.com/';
  const totals = metrics?.insights.reduce((sum, row) => ({ spend: sum.spend + numeric(row.spend), impressions: sum.impressions + numeric(row.impressions), clicks: sum.clicks + numeric(row.clicks), leads: sum.leads + numeric(row.actions?.find(action => action.action_type === 'lead')?.value) }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });
  const hasLeadData = metrics?.insights.some(row => row.actions?.some(action => action.action_type === 'lead'));
  const allRows = metrics ? Array.from(new Set([...metrics.campaigns.map(row => row.id), ...metrics.insights.map(row => row.campaign_id)])).map(id => ({ id, campaign: metrics.campaigns.find(row => row.id === id), insight: metrics.insights.find(row => row.campaign_id === id) })) : [];
  const rows = allRows.filter(row => (!query.trim() || `${row.campaign?.name || row.insight?.campaign_name || ''} ${row.id}`.toLocaleLowerCase('pt-BR').includes(query.trim().toLocaleLowerCase('pt-BR'))) && (statusFilter === 'all' || (row.campaign?.status || 'HISTORICAL') === statusFilter));
  const selectCampaign = (campaign: Campaign) => { setEditingId(campaign.id); setManageBudget(campaign.daily_budget ? String(Number(campaign.daily_budget) / 100) : ''); setConfirmSpend(false); };
  const refreshAfterMutation = async () => {
    try { setMetrics(await readMetrics(since, until)); }
    catch { setError('A alteração foi confirmada, mas a lista não pôde ser atualizada. Consulte as métricas novamente para conferir; não é necessário repetir a alteração.'); }
  };
  const confirmLeaveDraft = () => !dirty || window.confirm('Há informações não enviadas ou uma solicitação a conferir. Verifique o resultado na Meta antes de sair. Deseja continuar?');
  const connect = () => {
    if (!confirmLeaveDraft()) return;
    void run(async () => {
      const result = await request<{ url: string }>('', { action: 'connect' });
      allowNavigation.current = true;
      onDraftState?.({ dirty: false, busy: false });
      try { window.location.assign(result.url); }
      catch (error) { allowNavigation.current = false; onDraftState?.({ dirty, busy: true }); throw error; }
    });
  };
  const showConnection = () => setSection('connection');
  const loadDraftResources = () => void run(async () => {
    const [p, m, d] = await Promise.all([request<{ pages: Array<{ id: string; name: string }> }>('?action=pages'), readMetrics(since, until), request<{ drafts: AdDraft[] }>('?action=drafts')]);
    setPages(p.pages || []); setMetrics(m); setDrafts(d.drafts || []); setDraftsLoaded(true);
  });

  const filters = (crm = false) => <form className={s.filters} onSubmit={event => {
    event.preventDefault();
    if (invalidDates) return;
    void run(async () => { if (crm) setAttribution(await request<AdAttributionReport>(`?action=attribution&since=${since}&until=${until}`)); else setMetrics(await readMetrics(since, until)); });
  }}>
    <label>De<input type="date" required value={since} max={until || undefined} onChange={event => setSince(event.target.value)} /></label>
    <label>Até<input type="date" required value={until} min={since || undefined} onChange={event => setUntil(event.target.value)} /></label>
    <button className={s.secondary} disabled={busy || invalidDates || !integrated || (!crm && !ready)}>{crm ? 'Consultar resultados' : 'Atualizar métricas'}</button>
    {invalidDates && <small className={s.dateError}>Informe um período válido.</small>}
  </form>;
  const connectionRequired = <div className={s.empty}><span className={s.emptyIcon} aria-hidden="true">↗</span><h3>{status?.connected ? 'Escolha a conta de anúncios' : 'Conecte sua conta para começar'}</h3><p>Use a conta da imobiliária para acompanhar campanhas e preparar novos anúncios.</p><button type="button" disabled={!integrated || busy} onClick={showConnection}>Configurar conexão</button></div>;

  return <section className={`${s.root} ${standalone ? s.standalone : ''}`} aria-label="Campanhas Facebook e Instagram">
    {!standalone && <div className={s.header}><div><h3>Campanhas Facebook e Instagram</h3><p>Acompanhe resultados e prepare suas campanhas.</p></div><button type="button" disabled={!integrated || busy} onClick={() => setOpen(!open)}>{open ? 'Recolher campanhas' : 'Abrir campanhas'}</button></div>}
    {open && <>
      <div className={s.workspaceHeader}>
        <div><span className={s.eyebrow}>Facebook e Instagram</span><p>{status?.accountName ? <><strong>{status.accountName}</strong><span className={s.accountMeta}> · {status.currency} · {status.accountId}</span></> : 'Campanhas, anúncios e resultados da sua imobiliária em um só lugar.'}</p></div>
        <div className={s.actions}><button type="button" className={s.secondary} aria-pressed={section === 'connection'} onClick={showConnection}>{status?.connected ? 'Gerenciar conexão' : 'Conectar conta'}</button>{section !== 'create' && <button type="button" disabled={!ready || busy} onClick={() => setSection('create')}>+ Nova campanha</button>}</div>
      </div>
      <nav className={s.sections} aria-label="Áreas de campanhas">{sections.map(item => <button type="button" key={item.id} className={section === item.id ? s.selectedSection : ''} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>
      <div className={s.content} aria-busy={busy}>
        {error && <p role="alert" className={s.error}>{error}</p>}
        {notice && <p role="status" className={s.notice}>{notice}</p>}
        {busy && <p role="status" className={s.loading}><span aria-hidden="true" />Consultando a Meta…</p>}
        {!integrated && <p className={s.info}>As campanhas e a conexão estão disponíveis no painel real da empresa.</p>}

        {section === 'overview' && <>
          <div className={s.sectionHeader}><div><h2>Visão geral</h2><p>Acompanhe o investimento e o desempenho das campanhas.</p></div>{filters()}</div>
          {!ready ? connectionRequired : <>
            {metrics && totals ? <>
              <div className={s.totals}>
                <div><small>Investimento</small><strong>{money(totals.spend)}</strong><span>{totals.clicks ? `${money(totals.spend / totals.clicks)} por clique` : 'Sem custo por clique disponível'}</span></div>
                <div><small>Impressões</small><strong>{number(totals.impressions)}</strong><span>Vezes que os anúncios foram exibidos</span></div>
                <div><small>Cliques</small><strong>{number(totals.clicks)}</strong><span>{totals.impressions ? `${(totals.clicks / totals.impressions * 100).toFixed(2).replace('.', ',')}% de CTR` : 'Sem taxa de cliques disponível'}</span></div>
                <div><small>Leads na Meta</small><strong>{hasLeadData ? number(totals.leads) : '—'}</strong><span>{hasLeadData ? 'Atribuídos pela Meta' : 'Nenhum dado de lead informado pela Meta'}</span></div>
              </div>
              <p className={s.period}>Dados da Meta: <strong>{formatDate(metrics.since)} a {formatDate(metrics.until)}</strong>{stalePeriod && <span className={s.pending}> · Atualize para aplicar o novo período.</span>}</p>
              <section className={s.card} aria-label="Lista de campanhas">
                <div className={s.listHeader}><div><h3>Suas campanhas <span className={s.count}>{allRows.length}</span></h3><p>A situação atual aparece junto dos resultados do período consultado.</p></div><div className={s.searchFilters}><label><span className={s.srOnly}>Buscar campanha por nome ou ID</span><input type="search" placeholder="Buscar campanha…" value={query} onChange={event => setQuery(event.target.value)} /></label><label><span className={s.srOnly}>Filtrar por situação</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Todas as situações</option>{Array.from(new Set(allRows.map(row => row.campaign?.status || 'HISTORICAL'))).sort().map(value => <option key={value} value={value}>{situation(value)}</option>)}</select></label></div></div>
                {rows.length ? <div className={s.table}><table><thead><tr><th>Campanha</th><th>Situação</th><th>Investimento</th><th>Cliques</th><th>CTR</th><th>Leads Meta</th><th><span className={s.srOnly}>Ações</span></th></tr></thead><tbody>{rows.map(({ id, campaign, insight }) => <tr key={id} className={editingId === id ? s.selectedRow : undefined}><td><strong>{campaign?.name || insight?.campaign_name || id}</strong><small>{campaign ? objectiveLabel(campaign.objective) : 'Resultado histórico'}</small></td><td><span className={`${s.badge} ${campaign?.status === 'ACTIVE' ? s.active : campaign?.status === 'PAUSED' ? s.paused : ''}`}>{situation(campaign?.status || 'HISTORICAL')}</span></td><td>{money(numeric(insight?.spend))}</td><td>{number(numeric(insight?.clicks))}</td><td>{insight ? `${numeric(insight.ctr).toFixed(2).replace('.', ',')}%` : '—'}</td><td>{insight?.actions?.find(action => action.action_type === 'lead')?.value ?? '—'}</td><td>{campaign && <button type="button" className={s.textButton} disabled={busy} onClick={() => selectCampaign(campaign)} aria-label={`Gerenciar campanha ${campaign.name}`}>Gerenciar</button>}</td></tr>)}</tbody></table></div> : <div className={s.emptySmall}><h3>{allRows.length ? 'Nenhuma campanha corresponde aos filtros' : 'Sua primeira campanha começa aqui'}</h3><p>{allRows.length ? 'Tente outro nome ou situação.' : 'Não foram encontradas campanhas ou resultados nesta conta.'}</p>{allRows.length ? <button type="button" className={s.secondary} onClick={() => { setQuery(''); setStatusFilter('all'); }}>Limpar filtros</button> : <button type="button" onClick={() => setSection('create')}>Criar campanha pausada</button>}</div>}
              </section>
              {editing && <section className={s.card} aria-label={`Gestão de ${editing.name}`}>
                <div className={s.listHeader}><div><span className={s.eyebrow}>Gerenciar campanha</span><h3>{editing.name}</h3><p>{objectiveLabel(editing.objective)} · {situation(editing.status)}</p></div><button type="button" className={s.secondary} disabled={busy} onClick={() => { setEditingId(''); setConfirmSpend(false); }}>Fechar detalhes</button></div>
                <form className={s.manageForm} onSubmit={event => { event.preventDefault(); void run(async () => { await request('', { action: 'update-campaign', campaignId: editing.id, status: 'ACTIVE', dailyBudget: Number(manageBudget), confirmSpend }); setNotice('Ativação da campanha confirmada pela Meta. A entrega depende dos conjuntos, anúncios e da aprovação da conta.'); setConfirmSpend(false); await refreshAfterMutation(); }); }}>
                  <label>Orçamento diário ({status?.currency || 'BRL'})<input type="number" min="1" max="100000" step="0.01" required disabled={busy || status?.currency !== 'BRL'} value={manageBudget} onChange={event => { setManageBudget(event.target.value); setConfirmSpend(false); }} /></label>
                  <p>A ativação permite gasto. Conjuntos e anúncios pausados continuam pausados; confira a configuração no Gerenciador da Meta antes de veicular.</p>
                  <label className={s.check}><input type="checkbox" disabled={busy || status?.currency !== 'BRL'} checked={confirmSpend} onChange={event => setConfirmSpend(event.target.checked)} /><span>Confirmo ativar “{editing.name}” com orçamento de {manageBudget && Number(manageBudget) > 0 ? `${crmMoney(Number(manageBudget))} por dia` : 'valor diário informado'}.</span></label>
                  <div className={s.actions}><button disabled={busy || !confirmSpend || status?.currency !== 'BRL'}>Ativar com este orçamento</button><button type="button" className={s.secondary} disabled={busy || editing.status === 'PAUSED'} onClick={() => void run(async () => { await request('', { action: 'update-campaign', campaignId: editing.id, status: 'PAUSED' }); setNotice('Pausa da campanha confirmada pela Meta.'); setConfirmSpend(false); await refreshAfterMutation(); })}>Pausar campanha</button><a href={managerUrl} target="_blank" rel="noreferrer">Conferir na Meta ↗</a></div>
                  {status?.currency !== 'BRL' && <p>Alterações de orçamento e ativação aqui estão disponíveis para contas em reais.</p>}
                </form>
              </section>}
              <div className={s.footer}><p>Leads e vendas do CRM são apresentados separadamente em “Resultados no CRM”.</p><a href={managerUrl} target="_blank" rel="noreferrer">Abrir Gerenciador de Anúncios ↗</a></div>
            </> : !busy && <div className={s.empty}><h3>Consulte os resultados da conta</h3><p>Selecione o período e atualize as métricas. Os valores aparecem após a consulta à Meta.</p><button type="button" disabled={invalidDates} onClick={() => void run(async () => setMetrics(await readMetrics(since, until)))}>Consultar métricas</button></div>}
          </>}
        </>}

        {section === 'create' && <>
          <div className={s.sectionHeader}><div><h2>Criar campanha</h2><p>Defina o objetivo e o orçamento. A campanha começa pausada.</p></div></div>
          {!ready ? connectionRequired : <div className={s.formLayout}><section className={s.card}>
            <div className={s.cardIntro}><h3>Dados da campanha</h3><p>Conta: {status?.accountName || status?.accountId}</p></div>
            <form onSubmit={event => { event.preventDefault(); void run(async () => { campaignRequestId.current ||= crypto.randomUUID(); setCampaignPending(true); const result = await request<{ campaign: { id: string } }>('', { action: 'create-campaign', name, dailyBudget: Number(budget), objective, requestId: campaignRequestId.current }); campaignRequestId.current = null; setCampaignPending(false); setCreatedCampaign(result.campaign.id); setNotice(`Campanha criada pausada. Agora prepare o anúncio ou continue no Gerenciador da Meta.`); setName(''); setBudget(''); setObjective('OUTCOME_TRAFFIC'); await refreshAfterMutation(); }); }}>
              <fieldset className={s.formFields} disabled={busy || campaignPending}>
                <label>Nome da campanha<input required maxLength={150} placeholder="Ex.: Apartamentos em Belo Horizonte" value={name} onChange={event => setName(event.target.value)} /></label>
                <label>Objetivo<select value={objective} onChange={event => setObjective(event.target.value)}><option value="OUTCOME_TRAFFIC">Tráfego</option><option value="OUTCOME_LEADS">Cadastros</option><option value="OUTCOME_ENGAGEMENT">Engajamento</option></select><small>{objective === 'OUTCOME_TRAFFIC' ? 'Leve pessoas a um site. Permite preparar anúncio com foto e link aqui.' : objective === 'OUTCOME_LEADS' ? 'Capte contatos. Configure o formulário e os anúncios no Gerenciador da Meta.' : 'Incentive interações. Configure os anúncios no Gerenciador da Meta.'}</small></label>
                <label>Orçamento diário (R$)<input type="number" min="1" max="100000" step="0.01" required placeholder="Ex.: 20,00" value={budget} onChange={event => setBudget(event.target.value)} /><small>Orçamento diário informado à Meta. A campanha permanece pausada até você ativar.</small></label>
                <div className={s.actions}><button disabled={status?.currency !== 'BRL'}>Criar campanha pausada</button><button type="button" className={s.secondary} onClick={() => setSection('overview')}>Voltar à visão geral</button></div>
              </fieldset>
            </form>
            {campaignPending && !busy && <div className={s.recovery}><p>A solicitação anterior precisa ser conferida. Antes de preparar outra, verifique se a campanha já aparece na Meta.</p><a href={managerUrl} target="_blank" rel="noreferrer">Conferir campanha na Meta ↗</a><button type="button" className={s.secondary} onClick={() => { if (!window.confirm('Você conferiu a solicitação anterior na Meta? Criar outra pode duplicar a campanha.')) return; campaignRequestId.current = null; setCampaignPending(false); setError(''); setNotice('Nova solicitação preparada. Confira os dados antes de criar.'); }}>Preparar outra solicitação</button></div>}
            {createdCampaign && <div className={s.nextStep}><span className={s.badge}>Criada pausada</span><p>Campanha {createdCampaign}. Ainda é preciso configurar o anúncio antes de veicular.</p><button type="button" className={s.secondary} onClick={() => { setSection('ads'); }}>Preparar anúncio</button></div>}
            {status?.currency !== 'BRL' && <p className={s.info}>A criação está disponível apenas para contas com moeda BRL. A conta selecionada usa {status?.currency}.</p>}
          </section><aside className={s.guide}><h3>Da ideia ao anúncio</h3><ol><li><strong>Crie a campanha</strong><span>Nome, objetivo e orçamento diário.</span></li><li><strong>Prepare o anúncio</strong><span>Página, foto, texto e link de destino.</span></li><li><strong>Revise e ative</strong><span>Confira público, posicionamentos e todos os anúncios na Meta.</span></li></ol><p>Campanhas imobiliárias são criadas na categoria Moradia, para o Brasil.</p></aside></div>}
        </>}

        {section === 'ads' && <>
          <div className={s.sectionHeader}><div><h2>Anúncios</h2><p>Prepare a mensagem que vai apresentar sua imobiliária ou imóvel.</p></div><button type="button" className={s.secondary} disabled={busy || !ready || invalidDates} onClick={loadDraftResources}>{draftsLoaded ? 'Atualizar anúncios e Páginas' : 'Carregar campanhas e Páginas'}</button></div>
          {!ready ? connectionRequired : <>
            <div className={s.info}>Aqui você cria anúncios com foto e link em campanhas de <strong>Tráfego</strong>. O rascunho usa feed do Facebook, Brasil e público amplo adulto. Para Instagram, outros posicionamentos ou objetivos, finalize no <a href={managerUrl} target="_blank" rel="noreferrer">Gerenciador da Meta ↗</a>.</div>
            {!draftsLoaded ? <div className={s.empty}><h3>Escolha uma campanha e a Página</h3><p>Carregue as opções da conta conectada para preparar um anúncio. Nenhuma campanha será ativada nesta etapa.</p><button type="button" disabled={busy || invalidDates} onClick={loadDraftResources}>Carregar opções do anúncio</button></div> : <div className={s.formLayout}><section className={s.card}>
              <div className={s.cardIntro}><h3>Novo anúncio com foto e link</h3><p>Campanha, conjunto e anúncio permanecem pausados.</p></div>
              {!metrics?.campaigns.some(c => c.status === 'PAUSED' && c.objective === 'OUTCOME_TRAFFIC') && <p className={s.info}>Crie uma campanha de Tráfego pausada para preparar o anúncio aqui. <button type="button" className={s.textButton} onClick={() => setSection('create')}>Criar campanha</button></p>}
              {!pages.length && <p className={s.info}>Nenhuma Página disponível. Confira a autorização em <button type="button" className={s.textButton} onClick={showConnection}>Conexão</button>.</p>}
              <form onSubmit={event => { event.preventDefault(); void run(async () => {
                draftRequestId.current ||= crypto.randomUUID(); setDraftPending(true);
                try { const result = await request<{ draft: AdDraft }>('', { action: 'create-ad-draft', ...draft, dailyBudget: Number(draft.dailyBudget), requestId: draftRequestId.current }); setNotice(`Anúncio ${result.draft.adId} criado pausado, com conjunto e criativo. Revise na Meta antes de veicular.`); draftRequestId.current = null; setDraftPending(false); setDraft(emptyDraft); }
                finally { try { setDrafts((await request<{ drafts: AdDraft[] }>('?action=drafts')).drafts || []); } catch { /* The original mutation result remains visible; refresh is available separately. */ } }
              }); }}>
                <fieldset className={s.draftFields} disabled={busy || draftPending}>
                  <label>Campanha pausada de Tráfego<select required value={draft.campaignId} onChange={event => { const selected = metrics?.campaigns.find(c => c.id === event.target.value); setDraft(v => ({ ...v, campaignId: event.target.value, dailyBudget: selected?.daily_budget ? String(Number(selected.daily_budget) / 100) : '', confirmBudget: false })); }}><option value="">Selecione a campanha</option>{metrics?.campaigns.filter(c => c.status === 'PAUSED' && c.objective === 'OUTCOME_TRAFFIC').map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
                  <label>Página autorizada<select required value={draft.pageId} onChange={event => setDraft(v => ({ ...v, pageId: event.target.value }))}><option value="">Selecione a Página</option>{pages.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
                  <label>Nome do anúncio<input required maxLength={150} value={draft.name} onChange={event => setDraft(v => ({ ...v, name: event.target.value }))} /></label>
                  <label>Título<input required maxLength={100} value={draft.title} onChange={event => setDraft(v => ({ ...v, title: event.target.value }))} /></label>
                  <label className={s.wide}>Texto<textarea required maxLength={2000} rows={4} value={draft.message} onChange={event => setDraft(v => ({ ...v, message: event.target.value }))} /></label>
                  <label>Link de destino HTTPS<input required type="url" maxLength={2048} placeholder="https://…" value={draft.destinationUrl} onChange={event => setDraft(v => ({ ...v, destinationUrl: event.target.value }))} /><small>Página que abre quando a pessoa clica no anúncio.</small></label>
                  <label>Link da foto HTTPS<input required type="url" maxLength={2048} placeholder="https://…" value={draft.imageUrl} onChange={event => setDraft(v => ({ ...v, imageUrl: event.target.value }))} /><small>Use o endereço público da imagem do anúncio.</small></label>
                  <label>Orçamento diário atual da campanha (R$)<input required type="number" min="1" max="100000" step="0.01" value={draft.dailyBudget} onChange={event => setDraft(v => ({ ...v, dailyBudget: event.target.value, confirmBudget: false }))} /></label>
                  <label className={`${s.check} ${s.wide}`}><input type="checkbox" checked={draft.confirmBudget} onChange={event => setDraft(v => ({ ...v, confirmBudget: event.target.checked }))} /><span>Conferi o orçamento da campanha. Criar o anúncio e o conjunto pausados.</span></label>
                  <div className={`${s.actions} ${s.wide}`}><button disabled={!draft.confirmBudget || status?.currency !== 'BRL'}>Criar anúncio pausado</button></div>
                </fieldset>
              </form>
              {draftPending && !busy && <div className={s.recovery}><p>A solicitação anterior precisa ser conferida na Meta antes de criar outro anúncio.</p><a href={managerUrl} target="_blank" rel="noreferrer">Conferir na Meta ↗</a><button type="button" className={s.secondary} onClick={() => { if (!window.confirm('Você conferiu a solicitação anterior na Meta? Criar outra pode gerar um novo rascunho.')) return; draftRequestId.current = null; setDraftPending(false); setDraft(v => ({ ...v, confirmBudget: false })); setError(''); setNotice('Nova solicitação preparada. Confira os campos e o orçamento.'); }}>Preparar nova solicitação</button></div>}
            </section><aside className={s.guide}><h3>Antes de veicular</h3><p>Use uma foto clara do imóvel, um título curto e uma página de destino com as informações completas.</p><p>A criação aqui deixa os anúncios pausados. Revise a localização, o público e os posicionamentos no Gerenciador da Meta.</p><a href={managerUrl} target="_blank" rel="noreferrer">Abrir Gerenciador de Anúncios ↗</a></aside></div>}
            {draftsLoaded && <section className={s.card}><div className={s.cardIntro}><h3>Anúncios preparados pela ImobFlow</h3><p>Histórico de criação nesta conta. A situação de veiculação atual deve ser conferida na Meta.</p></div>{drafts.length ? <div className={s.table}><table><thead><tr><th>Anúncio</th><th>Resultado da criação</th><th>Referências na Meta</th></tr></thead><tbody>{drafts.map(d => <tr key={d.requestId}><td><strong>{d.name}</strong>{d.error && <small className={s.draftError}>{d.error}</small>}</td><td><span className={s.badge}>{d.state === 'complete' ? 'Criado pausado' : d.state === 'uncertain' ? 'Conferir na Meta' : 'Aguardando confirmação'}</span></td><td><details className={s.references}><summary>Ver identificadores</summary><small>Conjunto: {d.adsetId || '—'}<br />Criativo: {d.creativeId || '—'}<br />Anúncio: {d.adId || '—'}</small></details></td></tr>)}</tbody></table></div> : <p className={s.emptySmall}>Nenhum anúncio preparado pela ImobFlow nesta conta.</p>}</section>}
          </>}
        </>}

        {section === 'results' && <>
          <div className={s.sectionHeader}><div><h2>Resultados no CRM</h2><p>Veja quais origens trouxeram contatos e vendas registrados na ImobFlow.</p></div>{filters(true)}</div>
          <p className={s.info}>A origem é registrada pelos links com UTM do site. Vendas vêm dos fechamentos no CRM. Esses números são separados dos resultados atribuídos pela Meta.</p>
          {attribution ? <>
            <div className={s.totals}><div><small>Contatos com origem</small><strong>{number(attribution.trackedLeads)}</strong><span>Origem registrada no link</span></div><div><small>Contatos sem UTM</small><strong>{number(attribution.untrackedLeads)}</strong><span>Sem identificação pelo link</span></div><div><small>Vendas com origem</small><strong>{number(attribution.rows.reduce((sum, row) => sum + row.sales, 0))}</strong><span>Fechamentos registrados no CRM</span></div><div><small>Vendas sem origem</small><strong>{number(attribution.unattributedSales)}</strong><span>Sem vínculo com uma origem</span></div></div>
            <p className={s.period}>CRM: <strong>{formatDate(attribution.since)} a {formatDate(attribution.until)}</strong> · Horário de Brasília.{(attribution.since !== since || attribution.until !== until) && <span className={s.pending}> Consulte novamente para aplicar o novo período.</span>}</p>
            <section className={s.card}><div className={s.cardIntro}><h3>Origem dos contatos e vendas</h3></div>{attribution.rows.length ? <div className={s.table}><table><thead><tr><th>Origem / campanha</th><th>Contatos no período</th><th>Vendas no período</th><th>Valor das vendas</th></tr></thead><tbody>{attribution.rows.map((row, index) => <tr key={index}><td><strong>{row.source || 'Sem origem'}</strong><small>{row.campaign || 'Sem campanha'}</small></td><td>{number(row.leads)}</td><td>{number(row.sales)}</td><td>{crmMoney(row.salesAmount)}{row.missingSaleAmount > 0 && <small>{row.missingSaleAmount} sem valor de proposta</small>}</td></tr>)}</tbody></table></div> : <div className={s.emptySmall}><h3>Nenhuma origem registrada neste período</h3><p>Os registros começam quando o rastreamento é usado nos links. O histórico anterior não é estimado.</p></div>}</section>
          </> : !busy && <div className={s.empty}><h3>Acompanhe o caminho até a venda</h3><p>Escolha um período e consulte os resultados registrados no CRM.</p><button type="button" disabled={!integrated || invalidDates} onClick={() => void run(async () => setAttribution(await request<AdAttributionReport>(`?action=attribution&since=${since}&until=${until}`)))}>Consultar resultados no CRM</button></div>}
        </>}

        {section === 'connection' && <>
          <div className={s.sectionHeader}><div><h2>Conexão com a Meta</h2><p>Gerencie a autorização e escolha a conta de anúncios da imobiliária.</p></div><button type="button" className={s.secondary} disabled={!integrated || busy} onClick={() => void run(async () => { await refresh(); setNotice(current => current || 'Estado da conexão atualizado.'); })}>Atualizar conexão</button></div>
          <div className={s.formLayout}><section className={s.card}><div className={s.cardIntro}><h3>Conta de anúncios</h3><p>{!status ? 'O estado da conexão ainda não foi consultado.' : status.connected ? 'Autorização salva. A disponibilidade da conta é conferida nas consultas à Meta.' : status.available ? 'Autorize a ImobFlow na Meta para acessar as campanhas da empresa.' : 'A conexão de anúncios aguarda habilitação pela ImobFlow.'}</p></div>
            <div className={s.formFields}>
              {status?.available && <div className={s.actions}><button type="button" disabled={busy || !integrated} onClick={connect}>{status.connected ? 'Renovar autorização da Meta' : 'Conectar com Facebook'}</button></div>}
              {status?.connected && <>
                <label>Conta da imobiliária<select value={status.accountId || ''} disabled={busy} onChange={event => {
                  const accountId = event.target.value;
                  if (!accountId || accountId === status.accountId || !confirmLeaveDraft()) return;
                  void run(async () => { await request('', { action: 'select-account', accountId }); clearAccountData(); await refresh(); setNotice('Conta de anúncios selecionada.'); await refreshAfterMutation(); });
                }}><option value="">Escolha a conta da empresa</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency} · {account.id}</option>)}</select></label>
                {!accounts.length && <p>Nenhuma conta disponível nesta autorização. Confira as permissões e o acesso à conta no Facebook.</p>}
                {status.expiresAt && <p>Autorização registrada até {new Date(status.expiresAt).toLocaleDateString('pt-BR')}. A Meta pode revogar o acesso antes dessa data.</p>}
                {status.accountId && <a href={managerUrl} target="_blank" rel="noreferrer">Abrir esta conta na Meta ↗</a>}
                <details className={s.disconnect}><summary>Desconectar a conta</summary><p>A autorização é removida da ImobFlow. Campanhas existentes continuam na Meta e não são pausadas por esta ação.</p><button type="button" className={s.danger} disabled={busy} onClick={() => { if (!window.confirm('Desconectar esta conta da ImobFlow? As campanhas continuam na Meta. Informações não enviadas nesta tela serão descartadas.')) return; void run(async () => { await request('', { action: 'disconnect' }); clearAccountData(); await refresh(); setNotice('Conexão removida da ImobFlow. As campanhas existentes permanecem na Meta.'); }); }}>Desconectar da ImobFlow</button></details>
              </>}
            </div>
          </section><aside className={s.guide}><h3>Uma conta para cada empresa</h3><p>Escolha a conta que pertence à imobiliária. Campanhas e resultados são consultados a partir dessa seleção.</p><p>A conexão de anúncios é independente dos canais de atendimento por WhatsApp, Instagram e Facebook.</p></aside></div>
        </>}
      </div>
    </>}
  </section>;
}
