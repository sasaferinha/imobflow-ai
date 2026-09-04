'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { LeadProfile } from '@/lib/leads';

const LOCAL_LEADS_KEY = 'imobflow_local_leads';

type View = 'overview' | 'conversations' | 'leads' | 'properties' | 'agenda' | 'automations';
type ChatMessage = { id: number; side: 'incoming' | 'outgoing'; text: string };
type Property = { id: number; title: string; district: string; price: string; meta: string; match: number; tone: string; purpose: 'Venda' | 'Aluguel' };
type DashboardLead = LeadProfile & { initials: string; intent: string; status: string; tone: number };

const navItems: Array<{ id: View; icon: string; label: string; badge?: string }> = [
  { id: 'overview', icon: '⌂', label: 'Visão geral' },
  { id: 'conversations', icon: '◌', label: 'Conversas', badge: '6' },
  { id: 'leads', icon: '◎', label: 'Leads' },
  { id: 'properties', icon: '▦', label: 'Imóveis' },
  { id: 'agenda', icon: '□', label: 'Agenda' },
  { id: 'automations', icon: '↗', label: 'Automações' },
];

const headers: Record<View, { eyebrow: string; title: string; copy: string }> = {
  overview: { eyebrow: 'Visão executiva', title: 'Bom dia, Marina', copy: 'Acompanhe os principais indicadores da operação comercial.' },
  conversations: { eyebrow: 'Central de atendimento', title: 'Conversas', copy: 'Gerencie contatos, mensagens e responsáveis por cada atendimento.' },
  leads: { eyebrow: 'Gestão comercial', title: 'Leads', copy: 'Priorize oportunidades com base no perfil e no interesse de cada cliente.' },
  properties: { eyebrow: 'Portfólio imobiliário', title: 'Imóveis', copy: 'Consulte, filtre e mantenha o portfólio de imóveis atualizado.' },
  agenda: { eyebrow: 'Compromissos comerciais', title: 'Agenda', copy: 'Organize visitas, responsáveis e confirmações em um só lugar.' },
  automations: { eyebrow: 'Processos operacionais', title: 'Automações', copy: 'Monitore e controle os fluxos recorrentes da operação.' },
};

const seedLeadProfiles: LeadProfile[] = [
  { id: 'seed-lucas', name: 'Lucas Carvalho', phone: '(35) 99992-4120', email: 'lucas@exemplo.com', goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'R$ 300 mil a R$ 600 mil', details: '3 quartos e possibilidade de financiamento.', summary: 'Lucas deseja comprar um apartamento no Centro, com orçamento entre R$ 300 mil e R$ 600 mil.', score: 86, temperature: 'Muito quente', createdAt: '2026-09-01T10:42:00.000Z' },
  { id: 'seed-ana', name: 'Ana Martins', phone: '(35) 98814-2031', email: 'ana@exemplo.com', goal: 'Comprar', propertyType: 'Apartamento', region: 'Jardim Floresta', budget: 'R$ 600 mil a R$ 1 milhão', details: 'Prefere varanda e duas vagas.', summary: 'Ana procura um apartamento no Jardim Floresta com varanda e duas vagas.', score: 74, temperature: 'Quente', createdAt: '2026-09-01T10:31:00.000Z' },
  { id: 'seed-rafael', name: 'Rafael Borges', phone: '(35) 97751-0928', email: null, goal: 'Alugar', propertyType: 'Casa', region: 'Vila Nova', budget: 'Aluguel até R$ 3 mil/mês', details: 'Precisa aceitar pet.', summary: 'Rafael deseja alugar uma casa na Vila Nova por até R$ 3 mil mensais.', score: 61, temperature: 'Quente', createdAt: '2026-09-01T10:08:00.000Z' },
  { id: 'seed-carla', name: 'Carla Souza', phone: '(35) 96632-7744', email: null, goal: 'Investir', propertyType: 'Terreno', region: 'Reserva Sul', budget: 'Até R$ 300 mil', details: null, summary: 'Carla busca um terreno na Reserva Sul para investimento.', score: 48, temperature: 'Morno', createdAt: '2026-09-01T09:42:00.000Z' },
];

function decorateLead(lead: LeadProfile, index: number): DashboardLead {
  return {
    ...lead,
    initials: lead.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(),
    intent: `${lead.goal} ${lead.propertyType.toLowerCase()}`,
    status: lead.temperature,
    tone: index % 5,
  };
}

const initialProperties: Property[] = [
  { id: 1, title: 'Residencial Aurora', district: 'Centro', price: 'R$ 575.000', meta: '3 quartos • 2 vagas • 98 m²', match: 96, tone: 'orchid', purpose: 'Venda' },
  { id: 2, title: 'Edifício Horizonte', district: 'Jardim Floresta', price: 'R$ 590.000', meta: '3 quartos • 1 vaga • 91 m²', match: 92, tone: 'sky', purpose: 'Venda' },
  { id: 3, title: 'Casa Bosque Sereno', district: 'Alto da Serra', price: 'R$ 820.000', meta: '4 quartos • 3 vagas • 184 m²', match: 88, tone: 'sage', purpose: 'Venda' },
  { id: 4, title: 'Studio Vila Nova', district: 'Vila Nova', price: 'R$ 2.950/mês', meta: '1 quarto • mobiliado • 42 m²', match: 83, tone: 'sand', purpose: 'Aluguel' },
  { id: 5, title: 'Parque das Oliveiras', district: 'Pinheiros', price: 'R$ 745.000', meta: '2 quartos • varanda • 76 m²', match: 81, tone: 'rose', purpose: 'Venda' },
  { id: 6, title: 'Casa Ipê Amarelo', district: 'Jardim Campestre', price: 'R$ 2.400/mês', meta: '2 quartos • quintal • 80 m²', match: 77, tone: 'slate', purpose: 'Aluguel' },
];

const initialMessages: ChatMessage[] = [
  { id: 1, side: 'incoming', text: 'Oi! Estou procurando um apartamento de 3 quartos no Centro.' },
  { id: 2, side: 'outgoing', text: 'Olá, Lucas. Qual valor máximo você pretende investir?' },
  { id: 3, side: 'incoming', text: 'Até 600 mil. Pode ser financiamento.' },
  { id: 4, side: 'outgoing', text: 'Perfeito. Separei duas opções compatíveis com o seu perfil.' },
];

export default function DashboardClient() {
  const [view, setView] = useState<View>('overview');
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [properties, setProperties] = useState(initialProperties);
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [utilityModal, setUtilityModal] = useState<'profile' | 'settings' | null>(null);
  const [profile, setProfile] = useState({ name: 'Marina Oliveira', company: 'Imobiliária Horizonte' });
  const [settings, setSettings] = useState({ alerts: true, compact: false });
  const [notifications, setNotifications] = useState([
    { id: 1, text: 'Lucas pediu uma visita', unread: true },
    { id: 2, text: 'Novo perfil comercial recebido', unread: true },
    { id: 3, text: 'Fluxos executados sem falhas', unread: false },
  ]);
  const [capturedLeads, setCapturedLeads] = useState<DashboardLead[]>(() => seedLeadProfiles.map(decorateLead));
  const [selectedLead, setSelectedLead] = useState<DashboardLead>(() => decorateLead(seedLeadProfiles[0], 0));

  useEffect(() => {
    let active = true;
    const finishLoading = (remoteLeads: LeadProfile[]) => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(LOCAL_LEADS_KEY) || '[]') as LeadProfile[];
        const unique = [...remoteLeads, ...stored, ...seedLeadProfiles].filter((lead, index, all) => all.findIndex((item) => item.id === lead.id) === index);
        const combined = unique.map(decorateLead);
        if (active) {
          setCapturedLeads(combined);
          setSelectedLead(combined[0]);
        }
      } catch {
        // Os registros padrão continuam disponíveis se o armazenamento local estiver bloqueado.
      }
    };
    fetch('/api/leads')
      .then(async (response) => response.ok ? (await response.json() as { data: LeadProfile[] }).data : [])
      .then(finishLoading)
      .catch(() => finishLoading([]));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPropertyModalOpen(false);
        setSelectedProperty(null);
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const visibleLeads = useMemo(() => capturedLeads.filter((lead) => `${lead.name} ${lead.intent} ${lead.region}`.toLowerCase().includes(leadSearch.toLowerCase())), [capturedLeads, leadSearch]);
  const header = headers[view];
  const headerTitle = view === 'overview' ? `Bom dia, ${profile.name.split(/\s+/)[0]}` : header.title;
  const unreadCount = notifications.filter((item) => item.unread).length;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  function sendText(text: string) {
    const clean = text.trim();
    if (!clean) return false;
    setMessages((current) => [...current, { id: Date.now(), side: 'incoming', text: clean }]);
    window.setTimeout(() => {
      setMessages((current) => [...current, { id: Date.now() + 1, side: 'outgoing', text: 'Registro atualizado. Essa informação já está disponível no perfil comercial.' }]);
    }, 650);
    return true;
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (sendText(draft)) setDraft('');
  }

  function addProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const property: Property = {
      id: Date.now(),
      title: String(form.get('title') || 'Novo imóvel'),
      district: String(form.get('district') || 'Centro'),
      price: String(form.get('price') || 'R$ 0'),
      meta: String(form.get('description') || '2 quartos • 1 vaga • 72 m²'),
      match: 80,
      tone: 'orchid',
      purpose: String(form.get('purpose')) === 'Aluguel' ? 'Aluguel' : 'Venda',
    };
    setProperties((current) => [property, ...current]);
    setPropertyModalOpen(false);
    setView('properties');
    notify('Imóvel adicionado ao portfólio');
  }

  function openView(nextView: View) {
    setView(nextView);
    setNotificationsOpen(false);
    setProfileOpen(false);
  }

  return (
    <main className={`app-shell ${settings.compact ? 'compact-mode' : ''}`}>
      <aside className="sidebar">
        <button type="button" className="brand brand-button" onClick={() => openView('overview')} aria-label="Ir para a visão geral">
          <span className="brand-mark">I</span>
          <div><strong>ImobFlow</strong><span>Gestão Imobiliária</span></div>
        </button>
        <nav className="nav-list" aria-label="Navegação principal">
          {navItems.map((item) => (
            <button type="button" key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => openView(item.id)} aria-current={view === item.id ? 'page' : undefined}>
              <span>{item.icon}</span>{item.label}{item.badge && <b>{item.badge}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-card"><span className="live-dot" /><div><strong>Sistema operacional</strong><span>Serviços funcionando normalmente</span></div></div>
        <div className="profile-wrap">
          <div className="profile-row"><span className="avatar">{profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span><div><strong>{profile.name}</strong><span>{profile.company}</span></div><button type="button" aria-label="Abrir perfil" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>•••</button></div>
          {profileOpen && <div className="profile-menu popover"><strong>Perfil da equipe</strong><button type="button" onClick={() => { setUtilityModal('profile'); setProfileOpen(false); }}>Editar perfil</button><button type="button" onClick={() => { setUtilityModal('settings'); setProfileOpen(false); }}>Configurações</button></div>}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{header.eyebrow}</p><h1>{headerTitle}</h1><p>{header.copy}</p></div>
          <div className="header-actions">
            <div className="notification-wrap">
              <button type="button" className="icon-button" aria-label={`Notificações: ${unreadCount} não lidas`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>♢{settings.alerts && unreadCount > 0 && <i />}</button>
              {notificationsOpen && <div className="notification-menu popover"><div><strong>Notificações</strong><button type="button" onClick={() => setNotifications((items) => items.map((item) => ({ ...item, unread: false })))}>Marcar como lidas</button></div>{notifications.map((item) => <button type="button" className={item.unread ? 'unread' : ''} key={item.id} onClick={() => { setNotifications((items) => items.map((current) => current.id === item.id ? { ...current, unread: false } : current)); notify(item.text); }}><i />{item.text}</button>)}</div>}
            </div>
            <button type="button" className="primary-button" onClick={() => setPropertyModalOpen(true)}>＋ Novo imóvel</button>
          </div>
        </header>

        {view === 'overview' && <Overview onOpen={() => openView('conversations')} onActivity={() => openView('leads')} notify={notify} sendText={sendText} />}
        {view === 'conversations' && <Conversations messages={messages} draft={draft} setDraft={setDraft} sendMessage={sendMessage} notify={notify} openAgenda={() => openView('agenda')} />}
        {view === 'leads' && <Leads leads={visibleLeads} selected={selectedLead} onSelect={setSelectedLead} search={leadSearch} setSearch={setLeadSearch} onContinue={() => openView('conversations')} notify={notify} />}
        {view === 'properties' && <Properties properties={properties} search={propertySearch} setSearch={setPropertySearch} add={() => setPropertyModalOpen(true)} onOpen={setSelectedProperty} />}
        {view === 'agenda' && <Agenda notify={notify} />}
        {view === 'automations' && <Automations notify={notify} />}
      </section>

      {propertyModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPropertyModalOpen(false)}>
          <form className="modal-card" onSubmit={addProperty} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="eyebrow">Portfólio imobiliário</p><h2>Novo imóvel</h2></div><button type="button" aria-label="Fechar" onClick={() => setPropertyModalOpen(false)}>×</button></div>
            <label>Título<input name="title" placeholder="Ex.: Residencial das Flores" autoFocus required /></label>
            <div className="form-grid"><label>Bairro<input name="district" placeholder="Centro" required /></label><label>Preço<input name="price" placeholder="R$ 650.000" required /></label></div>
            <label>Finalidade<select name="purpose" defaultValue="Venda"><option>Venda</option><option>Aluguel</option></select></label>
            <label>Descrição<textarea name="description" placeholder="Ex.: 3 quartos • 2 vagas • 98 m²" rows={3} required /></label>
            <div className="modal-actions"><button type="button" onClick={() => setPropertyModalOpen(false)}>Cancelar</button><button className="primary-button" type="submit">Salvar imóvel</button></div>
          </form>
        </div>
      )}

      {selectedProperty && <PropertyDetail property={selectedProperty} close={() => setSelectedProperty(null)} notify={notify} openAgenda={() => openView('agenda')} />}
      {utilityModal === 'profile' && <ProfileModal profile={profile} close={() => setUtilityModal(null)} save={(nextProfile) => { setProfile(nextProfile); setUtilityModal(null); notify('Perfil atualizado'); }} />}
      {utilityModal === 'settings' && <SettingsModal settings={settings} close={() => setUtilityModal(null)} save={(nextSettings) => { setSettings(nextSettings); setUtilityModal(null); notify('Configurações salvas'); }} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Overview({ onOpen, onActivity, notify, sendText }: { onOpen: () => void; onActivity: () => void; notify: (message: string) => void; sendText: (text: string) => boolean }) {
  const [period, setPeriod] = useState('7');
  const [quickDraft, setQuickDraft] = useState('');
  const [following, setFollowing] = useState(false);
  const factor = period === '30' ? 4 : period === '1' ? 0.3 : 1;
  const metrics = [
    { label: 'Leads', value: String(Math.round(24 * factor)).padStart(2, '0'), change: '+18%', tone: 'violet' },
    { label: 'Qualificados', value: String(Math.round(9 * factor)).padStart(2, '0'), change: '37,5%', tone: 'mint' },
    { label: 'Visitas marcadas', value: String(Math.round(4 * factor)).padStart(2, '0'), change: '+2 hoje', tone: 'amber' },
    { label: 'Conversas ativas', value: String(Math.round(37 * factor)).padStart(2, '0'), change: '6 agora', tone: 'blue' },
  ];
  const activity = [
    { initials: 'LC', name: 'Lucas Carvalho', detail: 'Solicitou visita • Residencial Aurora', time: '2 min', tag: 'Muito quente' },
    { initials: 'AM', name: 'Ana Martins', detail: '3 imóveis recomendados no Jardim Floresta', time: '8 min', tag: 'Qualificado' },
    { initials: 'RB', name: 'Rafael Borges', detail: 'Pediu para falar com um corretor', time: '14 min', tag: 'Encaminhado' },
  ];
  function submitQuick(event: FormEvent) {
    event.preventDefault();
    if (sendText(quickDraft)) {
      setQuickDraft('');
      notify('Mensagem adicionada à conversa');
      onOpen();
    }
  }
  return <>
    <div className="metric-grid">{metrics.map((metric) => <article className={`metric-card ${metric.tone}`} key={metric.label}><div className="metric-icon">{metric.label.charAt(0)}</div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.change}</small></article>)}</div>
    <div className="main-grid"><div className="content-column">
      <article className="panel pipeline-panel"><div className="panel-heading"><div><p className="eyebrow">Jornada comercial</p><h2>Funil de leads</h2></div><label className="period-filter"><span>Período</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="1">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option></select></label></div><div className="pipeline"><div className="pipeline-step step-one"><strong>{Math.round(68 * factor)}</strong><span>Novos contatos</span></div><div className="pipeline-step step-two"><strong>{Math.round(41 * factor)}</strong><span>Em qualificação</span></div><div className="pipeline-step step-three"><strong>{Math.round(19 * factor)}</strong><span>Imóveis enviados</span></div><div className="pipeline-step step-four"><strong>{Math.round(8 * factor)}</strong><span>Visita solicitada</span></div></div></article>
      <article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Acontecendo agora</p><h2>Atividade recente</h2></div><button type="button" onClick={onActivity}>Ver todos →</button></div><div className="activity-list">{activity.map((item,index)=><button type="button" className="activity-row activity-button" onClick={() => { notify(`${item.name}: ${item.detail}`); onActivity(); }} key={item.name}><span className={`lead-avatar avatar-${index}`}>{item.initials}</span><span className="activity-copy"><strong>{item.name}</strong><span>{item.detail}</span></span><span className={`status-tag status-${index}`}>{item.tag}</span><time>{item.time}</time></button>)}</div></article>
    </div><aside className="conversation-card"><div className="conversation-head"><span className="lead-avatar avatar-0">LC</span><div><strong>Lucas Carvalho</strong><span><i /> online agora</span></div><button type="button" className={following ? 'conversation-following' : ''} aria-label={following ? 'Remover acompanhamento' : 'Acompanhar conversa'} onClick={() => { setFollowing((active) => !active); notify(following ? 'Acompanhamento removido' : 'Conversa marcada para acompanhamento'); }}>{following ? '✓' : '•••'}</button></div><div className="lead-signal"><div><span>Prioridade comercial</span><strong>86<small>/100</small></strong></div><span className="hot-pill">Muito quente</span></div><div className="chat-area"><span className="chat-date">Hoje, 10:42</span><div className="bubble incoming">Oi! Estou procurando um apartamento de 3 quartos no Centro.</div><div className="bubble outgoing">Olá, Lucas. Qual valor máximo você pretende investir?</div><div className="bubble incoming">Até 600 mil. Pode ser financiamento.</div><div className="typing"><i/><i/><i/></div></div><form className="chat-composer" onSubmit={submitQuick}><input id="overview-attachment" className="visually-hidden" type="file" onChange={(event) => event.target.files?.[0] && notify(`Anexo selecionado: ${event.target.files[0].name}`)}/><button type="button" aria-label="Anexar arquivo" onClick={() => document.getElementById('overview-attachment')?.click()}>＋</button><input value={quickDraft} onChange={(event) => setQuickDraft(event.target.value)} aria-label="Mensagem rápida" placeholder="Escreva uma mensagem..."/><button className="send-button" type="submit" aria-label="Enviar mensagem">➜</button></form><button type="button" className="simulate-button" onClick={onOpen}>Abrir conversa completa</button></aside></div>
  </>;
}

function Conversations({ messages, draft, setDraft, sendMessage, notify, openAgenda }: { messages: ChatMessage[]; draft: string; setDraft: (value: string) => void; sendMessage: (event: FormEvent) => void; notify: (message: string) => void; openAgenda: () => void }) {
  const contacts = [
    { initials:'LC',name:'Lucas Carvalho',preview:'Até 600 mil. Pode ser financiamento.',time:'10:45',unread:2,tone:0 },
    { initials:'AM',name:'Ana Martins',preview:'Gostei da segunda opção!',time:'10:31',unread:1,tone:1 },
    { initials:'RB',name:'Rafael Borges',preview:'Quero falar com um corretor.',time:'10:08',unread:0,tone:2 },
    { initials:'CS',name:'Carla Souza',preview:'Pode ser na Reserva Sul.',time:'09:42',unread:0,tone:3 },
  ];
  const [contactSearch, setContactSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selected, setSelected] = useState(contacts[0]);
  const [humanMode, setHumanMode] = useState(false);
  const filtered = contacts.filter((contact) => (!onlyUnread || contact.unread > 0) && contact.name.toLowerCase().includes(contactSearch.toLowerCase()));
  return <div className="inbox-layout">
    <aside className="inbox-list panel"><div className="inbox-search">⌕ <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} aria-label="Buscar conversa" placeholder="Buscar conversa" /></div><div className="inbox-tabs"><button type="button" className={!onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(false)}>Todas</button><button type="button" className={onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(true)}>Não lidas</button></div>{filtered.map((contact)=><button type="button" className={`contact-row ${selected.name === contact.name ? 'selected' : ''}`} onClick={() => setSelected(contact)} key={contact.name}><span className={`lead-avatar avatar-${contact.tone}`}>{contact.initials}</span><span><strong>{contact.name}</strong><small>{contact.preview}</small></span><time>{contact.time}</time>{contact.unread>0&&<b>{contact.unread}</b>}</button>)}{filtered.length === 0 && <p className="empty-filter">Nenhuma conversa encontrada.</p>}</aside>
    <section className="full-chat panel"><div className="full-chat-head"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><strong>{selected.name}</strong><span><i/> Atendimento online • {humanMode ? 'Marina responsável' : 'Triagem automática'}</span></div><button type="button" className={humanMode ? 'active-action' : ''} onClick={() => { setHumanMode((active) => !active); notify(humanMode ? 'Triagem automática retomada' : 'Atendimento atribuído a Marina'); }}>{humanMode ? 'Retomar triagem' : 'Assumir conversa'}</button></div><div className="full-chat-body"><span className="chat-date">Hoje</span>{messages.map(message=><div className={`bubble ${message.side}`} key={message.id}>{message.text}<small>{message.side==='incoming'?'10:44':'10:45'} ✓✓</small></div>)}</div><form className="full-composer" onSubmit={sendMessage}><input id="conversation-attachment" className="visually-hidden" type="file" onChange={(event) => event.target.files?.[0] && notify(`Anexo selecionado: ${event.target.files[0].name}`)}/><button type="button" aria-label="Anexar arquivo" onClick={() => document.getElementById('conversation-attachment')?.click()}>＋</button><input value={draft} onChange={(event)=>setDraft(event.target.value)} aria-label="Mensagem" placeholder="Digite uma mensagem..."/><button className="send-button" type="submit" aria-label="Enviar mensagem">➜</button></form></section>
    <aside className="lead-profile panel"><div className="profile-hero"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><h3>{selected.name}</h3><p>Cliente cadastrado</p><span className="hot-pill">Muito quente</span></div><div className="score-ring"><strong>86</strong><span>Prioridade</span></div><dl><div><dt>Intenção</dt><dd>Comprar</dd></div><div><dt>Tipo</dt><dd>Apartamento</dd></div><div><dt>Região</dt><dd>Centro</dd></div><div><dt>Orçamento</dt><dd>Até R$ 600 mil</dd></div><div><dt>Quartos</dt><dd>3+</dd></div><div><dt>Pagamento</dt><dd>Financiamento</dd></div></dl><button type="button" className="profile-action" onClick={openAgenda}>＋ Agendar visita</button></aside>
  </div>;
}

function Leads({ leads, selected, onSelect, search, setSearch, onContinue, notify }: { leads: DashboardLead[]; selected: DashboardLead; onSelect:(lead:DashboardLead)=>void; search:string; setSearch:(value:string)=>void; onContinue:()=>void; notify:(message:string)=>void }) {
  return <div className="lead-management"><section className="table-panel panel"><div className="toolbar"><div className="search-field">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Buscar lead" placeholder="Buscar por nome, região ou intenção"/></div><span className="live-leads"><i/> {leads.length} perfis cadastrados</span></div><div className="lead-table"><div className="table-row table-head"><span>Lead</span><span>Intenção</span><span>Região</span><span>Prioridade</span><span>Temperatura</span><span/></div>{leads.map((lead)=><button type="button" className={`table-row ${selected.id===lead.id?'selected':''}`} key={lead.id} onClick={()=>onSelect(lead)}><span className="lead-cell"><i className={`lead-avatar avatar-${lead.tone}`}>{lead.initials}</i><b>{lead.name}<small>{lead.phone}</small></b></span><span>{lead.intent}</span><span>{lead.region}</span><span className="score-cell"><i style={{width:`${lead.score}%`}}/><b>{lead.score}</b></span><span><em className={`temperature temp-${lead.tone}`}>{lead.status}</em></span><span>›</span></button>)}{leads.length===0&&<div className="empty-leads"><span>◎</span><h3>Nenhum resultado</h3><p>Limpe a busca para consultar os perfis cadastrados.</p></div>}</div></section><aside className="captured-profile panel"><div className="captured-head"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><p className="eyebrow">Perfil completo</p><h2>{selected.name}</h2><span>{new Date(selected.createdAt).toLocaleString('pt-BR')}</span></div><em className={`temperature temp-${selected.tone}`}>{selected.status}</em></div><div className="profile-explanation"><span>i</span><div><strong>Resumo comercial</strong><p>{selected.summary}</p></div></div><dl><div><dt>Objetivo</dt><dd>{selected.goal}</dd></div><div><dt>Tipo de imóvel</dt><dd>{selected.propertyType}</dd></div><div><dt>Região desejada</dt><dd>{selected.region}</dd></div><div><dt>Faixa de investimento</dt><dd>{selected.budget}</dd></div><div><dt>Telefone</dt><dd>{selected.phone}</dd></div><div><dt>E-mail</dt><dd>{selected.email||'Não informado'}</dd></div><div className="profile-wide"><dt>Informações adicionais</dt><dd>{selected.details||'Nenhuma observação adicional.'}</dd></div></dl><div className="captured-score"><span>Prioridade comercial</span><strong>{selected.score}<small>/100</small></strong><i><b style={{width:`${selected.score}%`}}/></i></div><button type="button" className="profile-whatsapp demo-channel" onClick={() => { notify(`Atendimento aberto para ${selected.name}`); onContinue(); }}>Abrir atendimento →</button></aside></div>;
}

function Properties({ properties, search, setSearch, add, onOpen }: { properties:Property[]; search:string; setSearch:(value:string)=>void; add:()=>void; onOpen:(property:Property)=>void }) {
  const [purpose, setPurpose] = useState<'Todos' | 'Venda' | 'Aluguel'>('Todos');
  const [filterOpen, setFilterOpen] = useState(false);
  const [minMatch, setMinMatch] = useState(0);
  const visible = properties.filter((property) => `${property.title} ${property.district}`.toLowerCase().includes(search.toLowerCase()) && (purpose === 'Todos' || property.purpose === purpose) && property.match >= minMatch);
  return <><div className="catalog-toolbar"><div className="search-field">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Buscar imóvel" placeholder="Buscar imóvel ou bairro"/></div><div className="catalog-actions"><select aria-label="Finalidade" value={purpose} onChange={(event) => setPurpose(event.target.value as typeof purpose)}><option>Todos</option><option>Venda</option><option>Aluguel</option></select><button type="button" className={filterOpen ? 'filter-active' : ''} onClick={() => setFilterOpen((open) => !open)}>Mais filtros</button><button type="button" className="primary-button" onClick={add}>＋ Adicionar</button></div></div>{filterOpen && <div className="filter-panel panel"><label>Compatibilidade mínima <strong>{minMatch}%</strong><input type="range" min="0" max="95" step="5" value={minMatch} onChange={(event) => setMinMatch(Number(event.target.value))}/></label><button type="button" onClick={() => { setMinMatch(0); setPurpose('Todos'); setSearch(''); }}>Limpar filtros</button></div>}<div className="property-grid">{visible.map((property)=><article className="property-card" key={property.id}><button type="button" className={`property-visual ${property.tone}`} onClick={() => onOpen(property)} aria-label={`Abrir ${property.title}`}><span>▦</span><em>{property.match}% compatível</em></button><div className="property-copy"><small>{property.purpose} • {property.district}</small><h3>{property.title}</h3><p>{property.meta}</p><div><strong>{property.price}</strong><button type="button" aria-label={`Ver detalhes de ${property.title}`} onClick={() => onOpen(property)}>›</button></div></div></article>)}{visible.length === 0 && <div className="empty-catalog panel"><span>▦</span><h3>Nenhum imóvel encontrado</h3><p>Ajuste ou limpe os filtros para continuar.</p><button type="button" onClick={() => { setMinMatch(0); setPurpose('Todos'); setSearch(''); }}>Limpar filtros</button></div>}</div></>;
}

function PropertyDetail({ property, close, notify, openAgenda }: { property:Property; close:()=>void; notify:(message:string)=>void; openAgenda:()=>void }) {
  const [saved, setSaved] = useState(false);
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><article className="modal-card property-detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className={`property-visual ${property.tone}`}><span>▦</span><em>{property.match}% compatível</em></div><div className="modal-head"><div><p className="eyebrow">{property.purpose} • {property.district}</p><h2>{property.title}</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><p>{property.meta}</p><strong className="detail-price">{property.price}</strong><div className="modal-actions"><button type="button" className={saved ? 'saved-button' : ''} onClick={() => { setSaved((active) => !active); notify(saved ? 'Imóvel removido dos favoritos' : 'Imóvel salvo nos favoritos'); }}>{saved ? '♥ Salvo' : '♡ Salvar'}</button><button type="button" className="primary-button" onClick={() => { close(); openAgenda(); }}>Agendar visita</button></div></article></div>;
}

function ProfileModal({ profile, close, save }: { profile:{ name:string; company:string }; close:()=>void; save:(profile:{ name:string; company:string })=>void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ name:String(form.get('name')).trim(), company:String(form.get('company')).trim() });
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="modal-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Equipe</p><h2>Editar perfil</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><label>Nome<input name="name" defaultValue={profile.name} autoFocus required/></label><label>Imobiliária<input name="company" defaultValue={profile.company} required/></label><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Salvar perfil</button></div></form></div>;
}

function SettingsModal({ settings, close, save }: { settings:{ alerts:boolean; compact:boolean }; close:()=>void; save:(settings:{ alerts:boolean; compact:boolean })=>void }) {
  const [draft, setDraft] = useState(settings);
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="modal-card" onSubmit={(event) => { event.preventDefault(); save(draft); }} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Preferências</p><h2>Configurações</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><label className="setting-row"><span><strong>Alertas do painel</strong><small>Exibe avisos de leads e visitas.</small></span><input type="checkbox" checked={draft.alerts} onChange={(event) => setDraft((current) => ({ ...current, alerts:event.target.checked }))}/></label><label className="setting-row"><span><strong>Visualização compacta</strong><small>Prepara o painel para maior densidade.</small></span><input type="checkbox" checked={draft.compact} onChange={(event) => setDraft((current) => ({ ...current, compact:event.target.checked }))}/></label><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Salvar configurações</button></div></form></div>;
}

function Agenda({ notify }: { notify:(message:string)=>void }) {
  const weeks = ['24—30 ago', '31 ago—06 set', '07—13 set'];
  const days = ['Seg 31','Ter 01','Qua 02','Qui 03','Sex 04','Sáb 05','Dom 06'];
  const [week, setWeek] = useState(1);
  const [selectedDay, setSelectedDay] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<number | null>(null);
  const [items, setItems] = useState([
    { id:1,time:'09:00',name:'Ana Martins',property:'Edifício Horizonte',broker:'Marina Oliveira',status:'Confirmada',color:'mint' },
    { id:2,time:'10:30',name:'Lucas Carvalho',property:'Residencial Aurora',broker:'Paulo Mendes',status:'Aguardando',color:'amber' },
    { id:3,time:'14:00',name:'Carla Souza',property:'Terreno Reserva Sul',broker:'Marina Oliveira',status:'Confirmada',color:'violet' },
    { id:4,time:'16:30',name:'Rafael Borges',property:'Casa Bosque Sereno',broker:'Paulo Mendes',status:'Confirmada',color:'blue' },
  ]);
  function addAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setItems((current) => [...current, { id:Date.now(), time:String(form.get('time')), name:String(form.get('name')), property:String(form.get('property')), broker:'Marina Oliveira', status:'Aguardando', color:'amber' }].sort((a,b) => a.time.localeCompare(b.time)));
    setFormOpen(false);
    notify('Novo horário adicionado à agenda');
  }
  const activeAppointment = items.find((item) => item.id === selectedAppointment);
  return <div className="agenda-layout"><section className="panel calendar-panel"><div className="calendar-head"><button type="button" aria-label="Semana anterior" disabled={week === 0} onClick={() => setWeek((current) => Math.max(0, current - 1))}>‹</button><div><p className="eyebrow">Setembro de 2026</p><h2>Semana {weeks[week]}</h2></div><button type="button" aria-label="Próxima semana" disabled={week === weeks.length - 1} onClick={() => setWeek((current) => Math.min(weeks.length - 1, current + 1))}>›</button></div><div className="week-strip">{days.map((day,index)=><button type="button" className={index===selectedDay?'today':''} onClick={() => { setSelectedDay(index); notify(`${day} selecionado`); }} key={day}><span>{day.split(' ')[0]}</span><strong>{day.split(' ')[1]}</strong>{index===selectedDay&&<i/>}</button>)}</div><div className="timeline">{items.map((appointment)=><button type="button" className={`appointment-row ${selectedAppointment === appointment.id ? 'selected' : ''}`} onClick={()=>setSelectedAppointment(appointment.id)} key={appointment.id}><time>{appointment.time}</time><i className={appointment.color}/><span><strong>{appointment.name}</strong><small>{appointment.property} • {appointment.broker}</small></span><em>{appointment.status}</em><b>›</b></button>)}</div>{activeAppointment && <div className="appointment-detail"><div><strong>{activeAppointment.name}</strong><span>{activeAppointment.time} • {activeAppointment.property}</span></div><button type="button" onClick={() => setSelectedAppointment(null)}>Fechar</button><button type="button" onClick={() => { setItems((current) => current.map((item) => item.id === activeAppointment.id ? { ...item, status:'Confirmada' } : item)); notify('Visita confirmada'); }}>Confirmar visita</button></div>}</section><aside className="panel day-summary"><p className="eyebrow">Resumo do dia</p><h2>{days[selectedDay]}</h2><div className="summary-number"><strong>{items.length}</strong><span>visitas<br/>agendadas</span></div><ul><li><i className="mint"/>{items.filter((item) => item.status === 'Confirmada').length} confirmadas</li><li><i className="amber"/>{items.filter((item) => item.status === 'Aguardando').length} aguardando</li><li><i className="violet"/>2 corretores</li></ul><button type="button" className="primary-button" onClick={()=>setFormOpen((open) => !open)}>＋ Novo horário</button>{formOpen && <form className="inline-form" onSubmit={addAppointment}><label>Horário<input name="time" type="time" required/></label><label>Cliente<input name="name" placeholder="Nome do cliente" required/></label><label>Imóvel<input name="property" placeholder="Nome do imóvel" required/></label><div><button type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit">Adicionar</button></div></form>}</aside></div>;
}

function Automations({ notify }: { notify:(message:string)=>void }) {
  const [flows, setFlows] = useState([
    { id:1,icon:'◌',name:'Qualificação automática',detail:'Identifica intenção, perfil e orçamento do novo lead.',count:'37 conversas',active:true },
    { id:2,icon:'◇',name:'Recomendação de imóveis',detail:'Busca e ordena os imóveis disponíveis no portfólio.',count:'19 recomendações',active:true },
    { id:3,icon:'↗',name:'Follow-up em 48 horas',detail:'Retoma leads que receberam imóveis e não responderam.',count:'8 agendados',active:true },
    { id:4,icon:'◎',name:'Aviso de lead prioritário',detail:'Notifica o corretor quando a prioridade comercial passa de 80.',count:'4 alertas hoje',active:true },
  ]);
  const [selected, setSelected] = useState(flows[0]);
  function toggleFlow(id:number) {
    setFlows((current) => current.map((flow) => flow.id === id ? { ...flow, active:!flow.active } : flow));
    const target = flows.find((flow) => flow.id === id);
    if (target) notify(`${target.name} ${target.active ? 'pausada' : 'ativada'}`);
  }
  const currentSelected = flows.find((flow) => flow.id === selected.id) || flows[0];
  return <div className="automation-layout"><section className="automation-grid">{flows.map((automation)=><article className={`automation-card panel ${automation.active ? '' : 'paused'}`} key={automation.id}><div className="automation-icon">{automation.icon}</div><span className="automation-state"><i/>{automation.active ? 'Ativa' : 'Pausada'}</span><h3>{automation.name}</h3><p>{automation.detail}</p><footer><strong>{automation.count}</strong><div><button type="button" onClick={()=>setSelected(automation)}>Ver fluxo</button><button type="button" onClick={()=>toggleFlow(automation.id)}>{automation.active ? 'Pausar' : 'Ativar'}</button></div></footer></article>)}</section><aside className="panel health-panel flow-detail"><div className="health-orbit"><span>{flows.filter((flow) => flow.active).length}<small>/4</small></span></div><h3>{currentSelected.name}</h3><p>{currentSelected.detail}</p><dl><div><dt>Status</dt><dd>{currentSelected.active ? 'Executando' : 'Pausado'}</dd></div><div><dt>Execuções</dt><dd>{currentSelected.count}</dd></div><div><dt>Falhas</dt><dd>0</dd></div></dl><button type="button" className="profile-action" onClick={() => notify(`${currentSelected.name} executada com sucesso`)}>Executar agora</button></aside></div>;
}
