'use client';
/* eslint-disable @next/next/no-img-element -- previews use locally compressed data URLs */

import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { LeadProfile } from '@/lib/leads';
import type { AppointmentRecord, PerformanceSnapshot, PropertyRecord } from '@/lib/operations';

const LOCAL_LEADS_KEY = 'imobflow_local_leads';

type View = 'overview' | 'conversations' | 'leads' | 'properties' | 'agenda' | 'automations';
type ChatMessage = { id: number; side: 'incoming' | 'outgoing'; text: string };
type Property = PropertyRecord;
type DashboardLead = LeadProfile & { initials: string; intent: string; status: string; tone: number };
type LeadFilter = 'rent' | 'buy' | 'hot' | 'cold' | 'house' | 'apartment';
type LeadFilterGroup = 'goal' | 'temperature' | 'property';

const leadFilterGroups: Array<{ id: LeadFilterGroup; label: string; options: Array<{ id: LeadFilter; label: string }> }> = [
  { id: 'goal', label: 'Interesse', options: [{ id: 'rent', label: 'Aluguel' }, { id: 'buy', label: 'Compra' }] },
  { id: 'temperature', label: 'Temperatura', options: [{ id: 'hot', label: 'Lead quente' }, { id: 'cold', label: 'Lead frio' }] },
  { id: 'property', label: 'Tipo de imóvel', options: [{ id: 'house', label: 'Casa' }, { id: 'apartment', label: 'Apartamento' }] },
];

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

function matchesLeadFilter(lead: DashboardLead, filter: LeadFilter) {
  const goal = lead.goal.toLowerCase();
  const temperature = lead.temperature.toLowerCase();
  const propertyType = lead.propertyType.toLowerCase();

  if (filter === 'rent') return goal.includes('alug');
  if (filter === 'buy') return goal.includes('compr');
  if (filter === 'hot') return temperature.includes('quente');
  if (filter === 'cold') return temperature.includes('frio') || temperature.includes('morno');
  if (filter === 'house') return propertyType.includes('casa');
  return propertyType.includes('apartamento');
}

function matchesLeadFilters(lead: DashboardLead, filters: LeadFilter[]) {
  if (filters.length === 0) return true;
  return leadFilterGroups.every((group) => {
    const activeInGroup = group.options.filter((option) => filters.includes(option.id));
    return activeInGroup.length === 0 || activeInGroup.some((option) => matchesLeadFilter(lead, option.id));
  });
}

const initialProperties: Property[] = [
  { id: 'aurora', title: 'Residencial Aurora', district: 'Centro', price: 'R$ 575.000', meta: '3 quartos • 2 vagas • 98 m²', match: 96, tone: 'orchid', purpose: 'Venda', images: [], createdAt: '' },
  { id: 'horizonte', title: 'Edifício Horizonte', district: 'Jardim Floresta', price: 'R$ 590.000', meta: '3 quartos • 1 vaga • 91 m²', match: 92, tone: 'sky', purpose: 'Venda', images: [], createdAt: '' },
  { id: 'bosque-sereno', title: 'Casa Bosque Sereno', district: 'Alto da Serra', price: 'R$ 820.000', meta: '4 quartos • 3 vagas • 184 m²', match: 88, tone: 'sage', purpose: 'Venda', images: [], createdAt: '' },
  { id: 'studio-vila-nova', title: 'Studio Vila Nova', district: 'Vila Nova', price: 'R$ 2.950/mês', meta: '1 quarto • mobiliado • 42 m²', match: 83, tone: 'sand', purpose: 'Aluguel', images: [], createdAt: '' },
  { id: 'oliveiras', title: 'Parque das Oliveiras', district: 'Pinheiros', price: 'R$ 745.000', meta: '2 quartos • varanda • 76 m²', match: 81, tone: 'rose', purpose: 'Venda', images: [], createdAt: '' },
  { id: 'ipe-amarelo', title: 'Casa Ipê Amarelo', district: 'Jardim Campestre', price: 'R$ 2.400/mês', meta: '2 quartos • quintal • 80 m²', match: 77, tone: 'slate', purpose: 'Aluguel', images: [], createdAt: '' },
];

const initialAppointments: AppointmentRecord[] = [
  { id:'ana-horizonte', date:'2026-09-01', time:'09:00', name:'Ana Martins', property:'Edifício Horizonte', broker:'Marina Oliveira', status:'Confirmada', color:'mint', createdAt:'' },
  { id:'lucas-aurora', date:'2026-09-01', time:'10:30', name:'Lucas Carvalho', property:'Residencial Aurora', broker:'Paulo Mendes', status:'Aguardando', color:'amber', createdAt:'' },
  { id:'carla-reserva', date:'2026-09-01', time:'14:00', name:'Carla Souza', property:'Terreno Reserva Sul', broker:'Marina Oliveira', status:'Confirmada', color:'violet', createdAt:'' },
  { id:'rafael-bosque', date:'2026-09-01', time:'16:30', name:'Rafael Borges', property:'Casa Bosque Sereno', broker:'Paulo Mendes', status:'Confirmada', color:'blue', createdAt:'' },
];

const initialMessages: ChatMessage[] = [
  { id: 1, side: 'incoming', text: 'Oi! Estou procurando um apartamento de 3 quartos no Centro.' },
  { id: 2, side: 'outgoing', text: 'Olá, Lucas. Qual valor máximo você pretende investir?' },
  { id: 3, side: 'incoming', text: 'Até 600 mil. Pode ser financiamento.' },
  { id: 4, side: 'outgoing', text: 'Perfeito. Separei duas opções compatíveis com o seu perfil.' },
];

async function preparePropertyImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: formato não aceito.`);
  if (file.size > 12_000_000) throw new Error(`${file.name}: arquivo maior que 12 MB.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width, 1200 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a imagem.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = canvas.toDataURL('image/webp', 0.78);
  if (image.length > 700_000) throw new Error(`${file.name}: a imagem ficou muito pesada. Use uma foto menor.`);
  return image;
}

const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 });
const compactMoney = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', notation:'compact', maximumFractionDigits:1 });

async function loadPerformance(month: string) {
  const response = await fetch(`/api/performance?month=${month}`);
  const result = await response.json() as { data?:PerformanceSnapshot; error?:string };
  if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível carregar os indicadores.');
  return result.data;
}

export default function DashboardClient() {
  const [view, setView] = useState<View>('overview');
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadFilters, setLeadFilters] = useState<LeadFilter[]>([]);
  const [properties, setProperties] = useState(initialProperties);
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [propertyImages, setPropertyImages] = useState<string[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [appointments, setAppointments] = useState(initialAppointments);
  const [toast, setToast] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [utilityModal, setUtilityModal] = useState<'profile' | 'settings' | 'broker' | null>(null);
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
    let active = true;
    Promise.all([
      fetch('/api/properties').then(async (response) => response.ok ? (await response.json() as { data: Property[] }).data : initialProperties),
      fetch('/api/appointments').then(async (response) => response.ok ? (await response.json() as { data: AppointmentRecord[] }).data : initialAppointments),
    ]).then(([remoteProperties, remoteAppointments]) => {
      if (active) {
        setProperties(remoteProperties);
        setAppointments(remoteAppointments);
      }
    }).catch(() => {
      // Os dados de referência mantêm o painel utilizável durante indisponibilidades temporárias.
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPropertyModalOpen(false);
        setEditingProperty(null);
        setPropertyImages([]);
        setSelectedProperty(null);
        setNotificationsOpen(false);
        setProfileOpen(false);
        setUtilityModal(null);
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const visibleLeads = useMemo(() => capturedLeads.filter((lead) => {
    const matchesSearch = `${lead.name} ${lead.intent} ${lead.region}`.toLowerCase().includes(leadSearch.toLowerCase());
    return matchesSearch && matchesLeadFilters(lead, leadFilters);
  }), [capturedLeads, leadFilters, leadSearch]);
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

  async function saveProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get('title') || 'Novo imóvel'),
      district: String(form.get('district') || 'Centro'),
      price: String(form.get('price') || 'R$ 0'),
      meta: String(form.get('description') || '2 quartos • 1 vaga • 72 m²'),
      match: editingProperty?.match || 80,
      tone: editingProperty?.tone || 'orchid',
      purpose: String(form.get('purpose')) === 'Aluguel' ? 'Aluguel' : 'Venda',
      images: propertyImages,
    };
    setSavingProperty(true);
    try {
      const response = await fetch(editingProperty ? `/api/properties/${editingProperty.id}` : '/api/properties', {
        method: editingProperty ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json() as { data?: Property; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível salvar o imóvel.');
      setProperties((current) => editingProperty ? current.map((item) => item.id === result.data?.id ? result.data : item) as Property[] : [result.data!, ...current]);
      setSelectedProperty(result.data);
      setPropertyModalOpen(false);
      setEditingProperty(null);
      setPropertyImages([]);
      setView('properties');
      notify(editingProperty ? 'Imóvel atualizado' : 'Imóvel adicionado ao portfólio');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar o imóvel.');
    } finally {
      setSavingProperty(false);
    }
  }

  async function removeProperty(property: Property) {
    if (!window.confirm(`Excluir ${property.title} do portfólio?`)) return;
    try {
      const response = await fetch(`/api/properties/${property.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Não foi possível excluir o imóvel.');
      setProperties((current) => current.filter((item) => item.id !== property.id));
      setSelectedProperty(null);
      notify('Imóvel excluído do portfólio');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível excluir o imóvel.');
    }
  }

  function openNewProperty() {
    setEditingProperty(null);
    setPropertyImages([]);
    setPropertyModalOpen(true);
  }

  async function addPropertyImages(files: FileList | null) {
    if (!files?.length) return;
    const available = 5 - propertyImages.length;
    if (available <= 0) return notify('Cada imóvel pode ter até 5 imagens.');
    setPreparingImages(true);
    try {
      const prepared = await Promise.all(Array.from(files).slice(0, available).map(preparePropertyImage));
      const next = [...propertyImages, ...prepared];
      if (next.join('').length > 3_200_000) throw new Error('O conjunto de imagens ficou muito pesado. Remova uma foto ou use arquivos menores.');
      setPropertyImages(next);
      notify(`${prepared.length} ${prepared.length === 1 ? 'imagem adicionada' : 'imagens adicionadas'}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível preparar as imagens.');
    } finally {
      setPreparingImages(false);
    }
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
          <div className="profile-row"><button type="button" className="profile-identity" onClick={() => { setUtilityModal('broker'); setProfileOpen(false); }}><span className="avatar">{profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span><div><strong>{profile.name}</strong><span>{profile.company}</span></div></button><button type="button" className="profile-options" aria-label="Mais opções do perfil" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>•••</button></div>
          {profileOpen && <div className="profile-menu popover"><strong>Perfil do corretor</strong><button type="button" onClick={() => { setUtilityModal('broker'); setProfileOpen(false); }}>Meu desempenho</button><button type="button" onClick={() => { setUtilityModal('profile'); setProfileOpen(false); }}>Editar perfil</button><button type="button" onClick={() => { setUtilityModal('settings'); setProfileOpen(false); }}>Configurações</button><button type="button" onClick={async () => { await fetch('/api/admin/logout', { method:'POST' }); window.location.href = '/painel'; }}>Sair do painel</button></div>}
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
            <button type="button" className="primary-button" onClick={openNewProperty}>＋ Novo imóvel</button>
          </div>
        </header>

        {view === 'overview' && <Overview notify={notify} />}
        {view === 'conversations' && <Conversations messages={messages} draft={draft} setDraft={setDraft} sendMessage={sendMessage} notify={notify} openAgenda={() => openView('agenda')} />}
        {view === 'leads' && <><LeadFilterBar leads={capturedLeads} active={leadFilters} onChange={setLeadFilters} /><Leads leads={visibleLeads} selected={selectedLead} onSelect={setSelectedLead} search={leadSearch} setSearch={setLeadSearch} onContinue={() => openView('conversations')} notify={notify} /></>}
        {view === 'properties' && <Properties properties={properties} search={propertySearch} setSearch={setPropertySearch} add={openNewProperty} onOpen={setSelectedProperty} />}
        {view === 'agenda' && <Agenda items={appointments} setItems={setAppointments} notify={notify} />}
        {view === 'automations' && <Automations notify={notify} />}
      </section>

      {propertyModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { setPropertyModalOpen(false); setEditingProperty(null); setPropertyImages([]); }}>
          <form className="modal-card" onSubmit={saveProperty} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="eyebrow">Portfólio imobiliário</p><h2>{editingProperty ? 'Editar imóvel' : 'Novo imóvel'}</h2></div><button type="button" aria-label="Fechar" onClick={() => { setPropertyModalOpen(false); setEditingProperty(null); setPropertyImages([]); }}>×</button></div>
            <label>Título<input name="title" defaultValue={editingProperty?.title} placeholder="Ex.: Residencial das Flores" autoFocus required /></label>
            <div className="form-grid"><label>Bairro<input name="district" defaultValue={editingProperty?.district} placeholder="Centro" required /></label><label>Preço<input name="price" defaultValue={editingProperty?.price} placeholder="R$ 650.000" required /></label></div>
            <label>Finalidade<select name="purpose" defaultValue={editingProperty?.purpose || 'Venda'}><option>Venda</option><option>Aluguel</option></select></label>
            <label>Descrição<textarea name="description" defaultValue={editingProperty?.meta} placeholder="Ex.: 3 quartos • 2 vagas • 98 m²" rows={3} required /></label>
            <div className="property-image-field">
              <div><strong>Imagens do imóvel</strong><span>Até 5 fotos em JPG, PNG ou WebP</span></div>
              <input id="property-images" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void addPropertyImages(event.target.files); event.target.value = ''; }} />
              <button type="button" className="image-upload-button" disabled={preparingImages || propertyImages.length >= 5} onClick={() => document.getElementById('property-images')?.click()}>{preparingImages ? 'Preparando fotos...' : '＋ Adicionar imagens'}</button>
              {propertyImages.length > 0 && <div className="property-image-previews">{propertyImages.map((image,index) => <div key={`${image.slice(-24)}-${index}`}><img src={image} alt={`Foto ${index + 1} do imóvel`} /><button type="button" aria-label={`Remover foto ${index + 1}`} onClick={() => setPropertyImages((current) => current.filter((_,imageIndex) => imageIndex !== index))}>×</button>{index === 0 && <span>Capa</span>}</div>)}</div>}
            </div>
            <div className="modal-actions"><button type="button" onClick={() => { setPropertyModalOpen(false); setEditingProperty(null); setPropertyImages([]); }}>Cancelar</button><button className="primary-button" type="submit" disabled={savingProperty || preparingImages}>{savingProperty ? 'Salvando...' : 'Salvar imóvel'}</button></div>
          </form>
        </div>
      )}

      {selectedProperty && <PropertyDetail property={selectedProperty} close={() => setSelectedProperty(null)} notify={notify} openAgenda={() => openView('agenda')} edit={() => { setEditingProperty(selectedProperty); setPropertyImages(selectedProperty.images); setPropertyModalOpen(true); }} remove={() => removeProperty(selectedProperty)} />}
      {utilityModal === 'profile' && <ProfileModal profile={profile} close={() => setUtilityModal(null)} save={(nextProfile) => { setProfile(nextProfile); setUtilityModal(null); notify('Perfil atualizado'); }} />}
      {utilityModal === 'settings' && <SettingsModal settings={settings} close={() => setUtilityModal(null)} save={(nextSettings) => { setSettings(nextSettings); setUtilityModal(null); notify('Configurações salvas'); }} />}
      {utilityModal === 'broker' && <BrokerProfileModal brokerName={profile.name} company={profile.company} close={() => setUtilityModal(null)} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Overview({ notify }: { notify:(message:string)=>void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [performance, setPerformance] = useState<PerformanceSnapshot | null>(null);
  const [modal, setModal] = useState<'sale' | 'goals' | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadPerformance(month).then((data) => {
      if (active) {
        setPerformance(data);
        setLoadError(null);
      }
    }).catch((error) => active && setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar os indicadores.')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [month]);

  async function refresh() {
    const data = await loadPerformance(month);
    setPerformance(data);
  }

  async function registerSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/performance', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ date:form.get('date'), broker:form.get('broker'), property:form.get('property'), client:form.get('client'), amount:Number(form.get('amount')) }) });
      const result = await response.json() as { error?:string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a venda.');
      await refresh();
      setModal(null);
      notify('Venda registrada no resultado da equipe');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível registrar a venda.');
    }
  }

  async function saveGoals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!performance) return;
    const form = new FormData(event.currentTarget);
    const brokerGoals = performance.brokers.map((broker,index) => ({ broker:broker.broker, goal:Number(form.get(`broker-goal-${index}`)) }));
    try {
      const response = await fetch('/api/performance', { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ month, companyGoal:Number(form.get('companyGoal')), leadsReceived:Number(form.get('leadsReceived')), convertedLeads:Number(form.get('convertedLeads')), recoveredLeads:Number(form.get('recoveredLeads')), brokerGoals }) });
      const result = await response.json() as { data?:PerformanceSnapshot; error?:string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível atualizar as metas.');
      setPerformance(result.data);
      setModal(null);
      notify('Metas e indicadores atualizados');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível atualizar as metas.');
    }
  }

  async function removeSale(id: string) {
    if (!window.confirm('Excluir este registro de venda?')) return;
    try {
      const response = await fetch(`/api/performance/sales/${id}`, { method:'DELETE' });
      if (!response.ok) throw new Error('Não foi possível excluir a venda.');
      await refresh();
      notify('Venda removida do resultado');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível excluir a venda.');
    }
  }

  if (loading && !performance) return <div className="performance-loading panel">Carregando indicadores comerciais...</div>;
  if (!performance) return <div className="performance-loading panel">{loadError || 'Os indicadores não estão disponíveis neste momento.'}</div>;

  const goalProgress = performance.companyGoal ? Math.min(100, (performance.totalSold / performance.companyGoal) * 100) : 0;
  const remaining = Math.max(0, performance.companyGoal - performance.totalSold);
  const historyMax = Math.max(...performance.history.map((item) => item.sold), 1);
  const monthTitle = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const defaultSaleDate = month === new Date().toISOString().slice(0, 7) ? new Date().toISOString().slice(0, 10) : `${month}-01`;

  return <>
    <section className="performance-toolbar"><div><span className="performance-live"><i/> Dados atualizados</span><strong>Resultados de {monthTitle}</strong></div><div><label>Competência<input type="month" value={month} onChange={(event) => { setLoading(true); setLoadError(null); setMonth(event.target.value); }} /></label><button type="button" onClick={() => setModal('goals')}>Editar metas</button><button type="button" className="primary-button" onClick={() => setModal('sale')}>＋ Registrar venda</button></div></section>

    <section className="company-goal-card">
      <div className="company-goal-copy"><p>Meta mensal da imobiliária</p><strong>{money.format(performance.totalSold)}</strong><span>de {money.format(performance.companyGoal)}</span></div>
      <div className="goal-progress"><div><span style={{ width:`${goalProgress}%` }}/></div><p><strong>{goalProgress.toFixed(1)}%</strong> da meta alcançada</p></div>
      <div className="goal-side"><span>Falta para a meta</span><strong>{money.format(remaining)}</strong><small>{performance.salesCount} {performance.salesCount === 1 ? 'venda registrada' : 'vendas registradas'}</small></div>
    </section>

    <section className="performance-kpis">
      <article><span>VGV vendido</span><strong>{compactMoney.format(performance.totalSold)}</strong><small>Resultado da empresa</small></article>
      <article><span>Ticket médio</span><strong>{compactMoney.format(performance.averageTicket)}</strong><small>Por negócio fechado</small></article>
      <article><span>Leads convertidos</span><strong>{performance.convertedLeads}</strong><small>{performance.conversionRate.toFixed(1)}% de conversão</small></article>
      <article><span>Leads recuperados</span><strong>{performance.recoveredLeads}</strong><small>Retomados e convertidos</small></article>
      <article><span>Leads recebidos</span><strong>{performance.leadsReceived}</strong><small>No período selecionado</small></article>
    </section>

    <section className="performance-grid">
      <article className="panel broker-performance"><div className="panel-heading"><div><p className="eyebrow">Equipe comercial</p><h2>Desempenho por corretor</h2></div><span>VGV e metas individuais</span></div><div className="broker-table"><div className="broker-row broker-head"><span>Corretor</span><span>Vendido</span><span>Meta</span><span>Negócios</span><span>Progresso</span></div>{performance.brokers.map((broker,index) => <div className="broker-row" key={broker.broker}><span className="broker-name"><i className={`avatar-${index}`}>{broker.broker.split(' ').slice(0,2).map((part) => part[0]).join('')}</i><b>{broker.broker}<small>{index === 0 ? 'Líder do mês' : 'Equipe comercial'}</small></b></span><strong>{compactMoney.format(broker.sold)}</strong><span>{compactMoney.format(broker.goal)}</span><span>{broker.salesCount}</span><span className="broker-progress"><i><b style={{ width:`${Math.min(100, broker.progress)}%` }}/></i><em>{broker.progress.toFixed(0)}%</em></span></div>)}</div></article>

      <article className="panel sales-history"><div className="panel-heading"><div><p className="eyebrow">Evolução comercial</p><h2>Vendas nos últimos meses</h2></div></div><div className="history-chart">{performance.history.map((item) => <div key={item.month}><span>{compactMoney.format(item.sold)}</span><i><b style={{ height:`${Math.max(8, (item.sold / historyMax) * 100)}%` }}/></i><small>{new Intl.DateTimeFormat('pt-BR', { month:'short', timeZone:'UTC' }).format(new Date(`${item.month}-01T12:00:00Z`)).replace('.','')}</small></div>)}</div></article>
    </section>

    <section className="panel recent-sales"><div className="panel-heading"><div><p className="eyebrow">Movimentação</p><h2>Vendas registradas</h2></div><strong>{money.format(performance.totalSold)} no período</strong></div><div className="recent-sales-table"><div className="sale-row sale-head"><span>Data</span><span>Corretor</span><span>Cliente</span><span>Imóvel</span><span>Valor</span><span/></div>{performance.sales.slice(0,8).map((sale) => <div className="sale-row" key={sale.id}><time>{new Date(`${sale.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone:'UTC' })}</time><strong>{sale.broker}</strong><span>{sale.client}</span><span>{sale.property}</span><b>{money.format(sale.amount)}</b><button type="button" aria-label={`Excluir venda de ${sale.client}`} onClick={() => removeSale(sale.id)}>×</button></div>)}{performance.sales.length === 0 && <p className="performance-empty">Nenhuma venda registrada neste mês.</p>}</div></section>

    {modal === 'sale' && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><form className="modal-card" onSubmit={registerSale} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Resultado comercial</p><h2>Registrar venda</h2></div><button type="button" aria-label="Fechar" onClick={() => setModal(null)}>×</button></div><div className="form-grid"><label>Data<input name="date" type="date" defaultValue={defaultSaleDate} required /></label><label>Corretor<select name="broker" required>{performance.brokers.map((broker) => <option key={broker.broker}>{broker.broker}</option>)}</select></label></div><label>Cliente<input name="client" placeholder="Nome do comprador" required /></label><label>Imóvel<input name="property" placeholder="Imóvel vendido" required /></label><label>Valor da venda<input name="amount" type="number" min="1" step="1000" placeholder="575000" required /></label><div className="modal-actions"><button type="button" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="primary-button">Registrar venda</button></div></form></div>}

    {modal === 'goals' && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><form className="modal-card performance-settings-modal" onSubmit={saveGoals} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Planejamento mensal</p><h2>Metas e conversão</h2></div><button type="button" aria-label="Fechar" onClick={() => setModal(null)}>×</button></div><label>Meta da imobiliária<input name="companyGoal" type="number" min="0" step="10000" defaultValue={performance.companyGoal} required /></label><div className="form-grid"><label>Leads recebidos<input name="leadsReceived" type="number" min="0" defaultValue={performance.leadsReceived} required /></label><label>Leads convertidos<input name="convertedLeads" type="number" min="0" defaultValue={performance.convertedLeads} required /></label></div><label>Leads recuperados<input name="recoveredLeads" type="number" min="0" defaultValue={performance.recoveredLeads} required /></label><div className="broker-goal-fields"><strong>Metas individuais</strong>{performance.brokers.map((broker,index) => <label key={broker.broker}>{broker.broker}<input name={`broker-goal-${index}`} type="number" min="0" step="10000" defaultValue={broker.goal} required /></label>)}</div><div className="modal-actions"><button type="button" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="primary-button">Salvar indicadores</button></div></form></div>}
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

function LeadFilterBar({ leads, active, onChange }: { leads: DashboardLead[]; active: LeadFilter[]; onChange: (filters: LeadFilter[]) => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  function toggleFilter(filter: LeadFilter) {
    onChange(active.includes(filter) ? active.filter((item) => item !== filter) : [...active, filter]);
  }

  const activeLabels = leadFilterGroups.flatMap((group) => group.options).filter((option) => active.includes(option.id));

  return <section className="lead-filter-bar panel" aria-labelledby="lead-filter-title">
    <div className="lead-filter-heading"><p className="eyebrow">Segmentação</p><h2 id="lead-filter-title">Filtrar leads</h2><p>Combine critérios para encontrar o perfil exato.</p></div>
    <div className="lead-filter-control">
      <button type="button" className={`lead-filter-trigger ${open ? 'open' : ''}`} aria-expanded={open} aria-controls="lead-filter-menu" onClick={() => setOpen((current) => !current)}>
        <span><small>Filtros selecionados</small><strong>{active.length === 0 ? 'Todos os leads' : `${active.length} ${active.length === 1 ? 'filtro ativo' : 'filtros ativos'}`}</strong></span><b>{active.length}</b><i aria-hidden="true">⌄</i>
      </button>
      {open && <div className="lead-filter-menu" id="lead-filter-menu">
        <div className="lead-filter-menu-head"><div><strong>Selecione os filtros</strong><span>As categorias diferentes são combinadas.</span></div>{active.length > 0 && <button type="button" onClick={() => onChange([])}>Limpar</button>}</div>
        <div className="lead-filter-groups">
          {leadFilterGroups.map((group) => <fieldset key={group.id}><legend>{group.label}</legend>{group.options.map((option) => {
            const selected = active.includes(option.id);
            const count = leads.filter((lead) => matchesLeadFilter(lead, option.id)).length;
            return <button type="button" key={option.id} className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => toggleFilter(option.id)}><i aria-hidden="true">{selected ? '✓' : ''}</i><span>{option.label}</span><b>{count}</b></button>;
          })}</fieldset>)}
        </div>
        <div className="lead-filter-menu-actions"><span>{active.length === 0 ? 'Nenhum filtro aplicado' : `${active.length} ${active.length === 1 ? 'selecionado' : 'selecionados'}`}</span><button type="button" onClick={() => setOpen(false)}>Ver resultados</button></div>
      </div>}
    </div>
    {activeLabels.length > 0 && <div className="lead-active-filters" aria-label="Filtros ativos">{activeLabels.map((option) => <button type="button" key={option.id} onClick={() => toggleFilter(option.id)}>{option.label}<span aria-hidden="true">×</span></button>)}<button type="button" className="clear-all" onClick={() => onChange([])}>Limpar todos</button></div>}
  </section>;
}

function Leads({ leads, selected, onSelect, search, setSearch, onContinue, notify }: { leads: DashboardLead[]; selected: DashboardLead; onSelect:(lead:DashboardLead)=>void; search:string; setSearch:(value:string)=>void; onContinue:()=>void; notify:(message:string)=>void }) {
  return <div className="lead-management"><section className="table-panel panel"><div className="toolbar"><div className="search-field">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Buscar lead" placeholder="Buscar por nome, região ou intenção"/></div><span className="live-leads"><i/> {leads.length} perfis cadastrados</span></div><div className="lead-table"><div className="table-row table-head"><span>Lead</span><span>Intenção</span><span>Região</span><span>Prioridade</span><span>Temperatura</span><span/></div>{leads.map((lead)=><button type="button" className={`table-row ${selected.id===lead.id?'selected':''}`} key={lead.id} onClick={()=>onSelect(lead)}><span className="lead-cell"><i className={`lead-avatar avatar-${lead.tone}`}>{lead.initials}</i><b>{lead.name}<small>{lead.phone}</small></b></span><span>{lead.intent}</span><span>{lead.region}</span><span className="score-cell"><i style={{width:`${lead.score}%`}}/><b>{lead.score}</b></span><span><em className={`temperature temp-${lead.tone}`}>{lead.status}</em></span><span>›</span></button>)}{leads.length===0&&<div className="empty-leads"><span>◎</span><h3>Nenhum resultado</h3><p>Limpe a busca para consultar os perfis cadastrados.</p></div>}</div></section><aside className="captured-profile panel"><div className="captured-head"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><p className="eyebrow">Perfil completo</p><h2>{selected.name}</h2><span>{new Date(selected.createdAt).toLocaleString('pt-BR')}</span></div><em className={`temperature temp-${selected.tone}`}>{selected.status}</em></div><div className="profile-explanation"><span>i</span><div><strong>Resumo comercial</strong><p>{selected.summary}</p></div></div><dl><div><dt>Objetivo</dt><dd>{selected.goal}</dd></div><div><dt>Tipo de imóvel</dt><dd>{selected.propertyType}</dd></div><div><dt>Região desejada</dt><dd>{selected.region}</dd></div><div><dt>Faixa de investimento</dt><dd>{selected.budget}</dd></div><div><dt>Telefone</dt><dd>{selected.phone}</dd></div><div><dt>E-mail</dt><dd>{selected.email||'Não informado'}</dd></div><div className="profile-wide"><dt>Informações adicionais</dt><dd>{selected.details||'Nenhuma observação adicional.'}</dd></div></dl><div className="captured-score"><span>Prioridade comercial</span><strong>{selected.score}<small>/100</small></strong><i><b style={{width:`${selected.score}%`}}/></i></div><button type="button" className="profile-whatsapp demo-channel" onClick={() => { notify(`Atendimento aberto para ${selected.name}`); onContinue(); }}>Abrir atendimento →</button></aside></div>;
}

function Properties({ properties, search, setSearch, add, onOpen }: { properties:Property[]; search:string; setSearch:(value:string)=>void; add:()=>void; onOpen:(property:Property)=>void }) {
  const [purpose, setPurpose] = useState<'Todos' | 'Venda' | 'Aluguel'>('Todos');
  const [filterOpen, setFilterOpen] = useState(false);
  const [minMatch, setMinMatch] = useState(0);
  const visible = properties.filter((property) => `${property.title} ${property.district}`.toLowerCase().includes(search.toLowerCase()) && (purpose === 'Todos' || property.purpose === purpose) && property.match >= minMatch);
  return <><div className="catalog-toolbar"><div className="search-field">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Buscar imóvel" placeholder="Buscar imóvel ou bairro"/></div><div className="catalog-actions"><select aria-label="Finalidade" value={purpose} onChange={(event) => setPurpose(event.target.value as typeof purpose)}><option>Todos</option><option>Venda</option><option>Aluguel</option></select><button type="button" className={filterOpen ? 'filter-active' : ''} onClick={() => setFilterOpen((open) => !open)}>Mais filtros</button><button type="button" className="primary-button" onClick={add}>＋ Adicionar</button></div></div>{filterOpen && <div className="filter-panel panel"><label>Compatibilidade mínima <strong>{minMatch}%</strong><input type="range" min="0" max="95" step="5" value={minMatch} onChange={(event) => setMinMatch(Number(event.target.value))}/></label><button type="button" onClick={() => { setMinMatch(0); setPurpose('Todos'); setSearch(''); }}>Limpar filtros</button></div>}<div className="property-grid">{visible.map((property)=><article className="property-card" key={property.id}><button type="button" className={`property-visual ${property.tone} ${property.images.length ? 'has-image' : ''}`} onClick={() => onOpen(property)} aria-label={`Abrir ${property.title}`}>{property.images[0] ? <img src={property.images[0]} alt="" /> : <span>▦</span>}<em>{property.match}% compatível</em>{property.images.length > 1 && <b className="image-count">▧ {property.images.length}</b>}</button><div className="property-copy"><small>{property.purpose} • {property.district}</small><h3>{property.title}</h3><p>{property.meta}</p><div><strong>{property.price}</strong><button type="button" aria-label={`Ver detalhes de ${property.title}`} onClick={() => onOpen(property)}>›</button></div></div></article>)}{visible.length === 0 && <div className="empty-catalog panel"><span>▦</span><h3>Nenhum imóvel encontrado</h3><p>Ajuste ou limpe os filtros para continuar.</p><button type="button" onClick={() => { setMinMatch(0); setPurpose('Todos'); setSearch(''); }}>Limpar filtros</button></div>}</div></>;
}

function PropertyDetail({ property, close, notify, openAgenda, edit, remove }: { property:Property; close:()=>void; notify:(message:string)=>void; openAgenda:()=>void; edit:()=>void; remove:()=>void }) {
  const [saved, setSaved] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><article className="modal-card property-detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className={`property-visual ${property.tone} ${property.images.length ? 'has-image' : ''}`}>{property.images[activeImage] ? <img src={property.images[activeImage]} alt={`${property.title}, foto ${activeImage + 1}`} /> : <span>▦</span>}<em>{property.match}% compatível</em></div>{property.images.length > 1 && <div className="property-gallery-thumbs">{property.images.map((image,index) => <button type="button" className={activeImage === index ? 'active' : ''} key={`${image.slice(-24)}-${index}`} onClick={() => setActiveImage(index)} aria-label={`Ver foto ${index + 1}`}><img src={image} alt="" /></button>)}</div>}<div className="modal-head"><div><p className="eyebrow">{property.purpose} • {property.district}</p><h2>{property.title}</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><p>{property.meta}</p><strong className="detail-price">{property.price}</strong><div className="modal-actions"><button type="button" onClick={remove}>Excluir</button><button type="button" onClick={edit}>Editar</button><button type="button" className={saved ? 'saved-button' : ''} onClick={() => { setSaved((active) => !active); notify(saved ? 'Imóvel removido dos favoritos' : 'Imóvel salvo nos favoritos'); }}>{saved ? '♥ Salvo' : '♡ Salvar'}</button><button type="button" className="primary-button" onClick={() => { close(); openAgenda(); }}>Agendar visita</button></div></article></div>;
}

function ProfileModal({ profile, close, save }: { profile:{ name:string; company:string }; close:()=>void; save:(profile:{ name:string; company:string })=>void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save({ name:String(form.get('name')).trim(), company:String(form.get('company')).trim() });
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="modal-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Equipe</p><h2>Editar perfil</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><label>Nome<input name="name" defaultValue={profile.name} autoFocus required/></label><label>Imobiliária<input name="company" defaultValue={profile.company} required/></label><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Salvar perfil</button></div></form></div>;
}

function BrokerProfileModal({ brokerName, company, close }: { brokerName:string; company:string; close:()=>void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [performance, setPerformance] = useState<PerformanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadPerformance(month).then((data) => {
      if (active) {
        setPerformance(data);
        setError(null);
      }
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o desempenho.')).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [month]);

  const broker = performance?.brokers.find((item) => item.broker.toLowerCase() === brokerName.toLowerCase());
  const brokerSales = performance?.sales.filter((sale) => sale.broker === broker?.broker) || [];
  const rank = performance && broker ? performance.brokers.findIndex((item) => item.broker === broker.broker) + 1 : 0;
  const averageTicket = broker?.salesCount ? broker.sold / broker.salesCount : 0;
  const teamShare = performance?.totalSold && broker ? (broker.sold / performance.totalSold) * 100 : 0;
  const remaining = broker ? Math.max(0, broker.goal - broker.sold) : 0;
  const historyMax = Math.max(...(broker?.history.map((item) => item.sold) || []), 1);
  const monthTitle = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-01T12:00:00Z`));

  return <div className="modal-backdrop broker-profile-backdrop" role="presentation" onMouseDown={close}><article className="modal-card broker-profile-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="broker-profile-header"><div className="broker-profile-person"><span>{brokerName.split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase()}</span><div><p>Meu desempenho</p><h2>{brokerName}</h2><small>{company}</small></div></div><div className="broker-profile-actions"><label>Competência<input type="month" value={month} onChange={(event) => { setLoading(true); setError(null); setMonth(event.target.value); }} /></label><button type="button" aria-label="Fechar perfil" onClick={close}>×</button></div></div>
    {loading && !performance ? <div className="broker-profile-loading">Carregando desempenho mensal...</div> : error && !performance ? <div className="broker-profile-loading">{error}</div> : !broker ? <div className="broker-profile-loading">Este perfil ainda não possui metas associadas para {monthTitle}.</div> : <>
      <section className="broker-goal-overview"><div><p>Meta individual de {monthTitle}</p><strong>{money.format(broker.sold)}</strong><span>de {money.format(broker.goal)}</span></div><div className="broker-goal-ring" style={{ '--broker-progress':`${Math.min(100, broker.progress) * 3.6}deg` } as CSSProperties}><span><strong>{broker.progress.toFixed(0)}%</strong><small>alcançado</small></span></div><dl><div><dt>Falta para a meta</dt><dd>{money.format(remaining)}</dd></div><div><dt>Posição na equipe</dt><dd>{rank}º lugar</dd></div><div><dt>Participação no VGV</dt><dd>{teamShare.toFixed(1)}%</dd></div></dl></section>
      <section className="broker-stat-grid"><article><span>Negócios fechados</span><strong>{broker.salesCount}</strong><small>No mês selecionado</small></article><article><span>Ticket médio</span><strong>{compactMoney.format(averageTicket)}</strong><small>Por imóvel vendido</small></article><article><span>Leads recebidos</span><strong>{broker.leadsReceived}</strong><small>Carteira mensal</small></article><article><span>Leads convertidos</span><strong>{broker.convertedLeads}</strong><small>{broker.conversionRate.toFixed(1)}% de conversão</small></article><article><span>Leads recuperados</span><strong>{broker.recoveredLeads}</strong><small>Oportunidades retomadas</small></article><article><span>Visitas realizadas</span><strong>{broker.visits}</strong><small>Atendimentos presenciais</small></article></section>
      <section className="broker-profile-content"><article className="broker-month-chart"><div><p>Evolução individual</p><h3>Vendas por mês</h3></div>{broker.history.length > 0 ? <div className="broker-history-bars">{broker.history.map((item) => <div key={item.month}><span>{compactMoney.format(item.sold)}</span><i><b style={{ height:`${Math.max(10, (item.sold / historyMax) * 100)}%` }}/></i><small>{new Intl.DateTimeFormat('pt-BR', { month:'short', timeZone:'UTC' }).format(new Date(`${item.month}-01T12:00:00Z`)).replace('.','')}</small></div>)}</div> : <p className="broker-empty">Ainda não há histórico de vendas.</p>}</article><article className="broker-sales-list"><div><p>Fechamentos do mês</p><h3>Vendas recentes</h3></div>{brokerSales.length > 0 ? <ul>{brokerSales.map((sale) => <li key={sale.id}><span><strong>{sale.property}</strong><small>{sale.client} • {new Date(`${sale.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone:'UTC' })}</small></span><b>{money.format(sale.amount)}</b></li>)}</ul> : <p className="broker-empty">Nenhuma venda registrada neste mês.</p>}</article></section>
    </>}
  </article></div>;
}

function SettingsModal({ settings, close, save }: { settings:{ alerts:boolean; compact:boolean }; close:()=>void; save:(settings:{ alerts:boolean; compact:boolean })=>void }) {
  const [draft, setDraft] = useState(settings);
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="modal-card" onSubmit={(event) => { event.preventDefault(); save(draft); }} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Preferências</p><h2>Configurações</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><label className="setting-row"><span><strong>Alertas do painel</strong><small>Exibe avisos de leads e visitas.</small></span><input type="checkbox" checked={draft.alerts} onChange={(event) => setDraft((current) => ({ ...current, alerts:event.target.checked }))}/></label><label className="setting-row"><span><strong>Visualização compacta</strong><small>Prepara o painel para maior densidade.</small></span><input type="checkbox" checked={draft.compact} onChange={(event) => setDraft((current) => ({ ...current, compact:event.target.checked }))}/></label><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Salvar configurações</button></div></form></div>;
}

function Agenda({ items, setItems, notify }: { items:AppointmentRecord[]; setItems:Dispatch<SetStateAction<AppointmentRecord[]>>; notify:(message:string)=>void }) {
  const weeks = ['24—30 ago', '31 ago—06 set', '07—13 set'];
  const weekDates = [
    ['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-29','2026-08-30'],
    ['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06'],
    ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13'],
  ];
  const [week, setWeek] = useState(1);
  const [selectedDay, setSelectedDay] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<string | null>(null);
  const dates = weekDates[week];
  const days = dates.map((date) => {
    const parts = new Intl.DateTimeFormat('pt-BR', { weekday:'short', day:'2-digit', timeZone:'UTC' }).format(new Date(`${date}T12:00:00Z`)).replace('.', '').split(' ');
    return `${parts[0]} ${parts.at(-1)}`;
  });
  const activeDate = dates[selectedDay];
  const visibleItems = items.filter((item) => item.date === activeDate).sort((a,b) => a.time.localeCompare(b.time));

  async function addAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/appointments', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ date:activeDate, time:String(form.get('time')), name:String(form.get('name')), property:String(form.get('property')), broker:'Marina Oliveira', status:'Aguardando', color:'amber' }) });
      const result = await response.json() as { data?:AppointmentRecord; error?:string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível salvar o horário.');
      setItems((current) => [...current, result.data!]);
      setFormOpen(false);
      notify('Novo horário adicionado à agenda');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar o horário.');
    }
  }

  async function confirmAppointment(appointment: AppointmentRecord) {
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method:'PATCH', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ status:'Confirmada' }) });
      const result = await response.json() as { data?:AppointmentRecord; error?:string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível confirmar a visita.');
      setItems((current) => current.map((item) => item.id === appointment.id ? result.data! : item));
      notify('Visita confirmada');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível confirmar a visita.');
    }
  }

  async function removeAppointment(appointment: AppointmentRecord) {
    if (!window.confirm(`Cancelar a visita de ${appointment.name}?`)) return;
    try {
      const response = await fetch(`/api/appointments/${appointment.id}`, { method:'DELETE' });
      if (!response.ok) throw new Error('Não foi possível cancelar a visita.');
      setItems((current) => current.filter((item) => item.id !== appointment.id));
      setSelectedAppointment(null);
      notify('Visita removida da agenda');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível cancelar a visita.');
    }
  }

  const activeAppointment = visibleItems.find((item) => item.id === selectedAppointment);
  const brokerCount = new Set(visibleItems.map((item) => item.broker)).size;
  return <div className="agenda-layout"><section className="panel calendar-panel"><div className="calendar-head"><button type="button" aria-label="Semana anterior" disabled={week === 0} onClick={() => { setWeek((current) => Math.max(0, current - 1)); setSelectedDay(0); setSelectedAppointment(null); }}>‹</button><div><p className="eyebrow">Agenda persistente</p><h2>Semana {weeks[week]}</h2></div><button type="button" aria-label="Próxima semana" disabled={week === weeks.length - 1} onClick={() => { setWeek((current) => Math.min(weeks.length - 1, current + 1)); setSelectedDay(0); setSelectedAppointment(null); }}>›</button></div><div className="week-strip">{days.map((day,index)=><button type="button" className={index===selectedDay?'today':''} onClick={() => { setSelectedDay(index); setSelectedAppointment(null); }} key={dates[index]}><span>{day.split(' ')[0]}</span><strong>{day.split(' ')[1]}</strong>{index===selectedDay&&<i/>}</button>)}</div><div className="timeline">{visibleItems.map((appointment)=><button type="button" className={`appointment-row ${selectedAppointment === appointment.id ? 'selected' : ''}`} onClick={()=>setSelectedAppointment(appointment.id)} key={appointment.id}><time>{appointment.time}</time><i className={appointment.color}/><span><strong>{appointment.name}</strong><small>{appointment.property} • {appointment.broker}</small></span><em>{appointment.status}</em><b>›</b></button>)}{visibleItems.length === 0 && <div className="empty-filter">Nenhuma visita agendada para este dia.</div>}</div>{activeAppointment && <div className="appointment-detail"><div><strong>{activeAppointment.name}</strong><span>{activeAppointment.time} • {activeAppointment.property}</span></div><button type="button" onClick={() => setSelectedAppointment(null)}>Fechar</button><button type="button" onClick={() => removeAppointment(activeAppointment)}>Cancelar visita</button>{activeAppointment.status !== 'Confirmada' && <button type="button" onClick={() => confirmAppointment(activeAppointment)}>Confirmar visita</button>}</div>}</section><aside className="panel day-summary"><p className="eyebrow">Resumo do dia</p><h2>{days[selectedDay]}</h2><div className="summary-number"><strong>{visibleItems.length}</strong><span>visitas<br/>agendadas</span></div><ul><li><i className="mint"/>{visibleItems.filter((item) => item.status === 'Confirmada').length} confirmadas</li><li><i className="amber"/>{visibleItems.filter((item) => item.status === 'Aguardando').length} aguardando</li><li><i className="violet"/>{brokerCount} {brokerCount === 1 ? 'corretor' : 'corretores'}</li></ul><button type="button" className="primary-button" onClick={()=>setFormOpen((open) => !open)}>＋ Novo horário</button>{formOpen && <form className="inline-form" onSubmit={addAppointment}><span>Data selecionada: {new Date(`${activeDate}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone:'UTC' })}</span><label>Horário<input name="time" type="time" required/></label><label>Cliente<input name="name" placeholder="Nome do cliente" required/></label><label>Imóvel<input name="property" placeholder="Nome do imóvel" required/></label><div><button type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit">Adicionar</button></div></form>}</aside></div>;
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
