'use client';
/* eslint-disable @next/next/no-img-element -- previews use locally compressed data URLs */

import { useEffect, useMemo, useReducer, useState, type CSSProperties, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import type { LeadLifecycleStatus, LeadProfile } from '@/lib/leads';
import type { AppointmentRecord, PerformanceSnapshot, PropertyRecord } from '@/lib/operations';
import AutomationCenter from './automation-center';
import ConversationCenter from './conversation-center';
import { createLiveConversationState, demoConversationReducer } from '@/lib/demo-conversations';
import type { ConversationMessage } from '@/lib/conversations';
import TeamModal from './team-modal';

const PANEL_SETTINGS_KEY = 'imobflow_panel_settings';
const DATA_SYNC_CHANNEL = 'imobflow_data_sync';

type View = 'overview' | 'conversations' | 'leads' | 'properties' | 'agenda' | 'automations';
type Property = PropertyRecord;
type DashboardLead = LeadProfile & { initials: string; intent: string; status: string; tone: number };
type LeadFilter = 'rent' | 'buy' | 'hot' | 'cold' | 'house' | 'apartment';
type LeadFilterGroup = 'goal' | 'temperature' | 'property';
type LeadMode = 'all' | 'inactive' | 'forgotten' | 'recovery';
type DashboardSettings = { alerts: boolean; compact: boolean; dark: boolean };

const leadFilterGroups: Array<{ id: LeadFilterGroup; label: string; options: Array<{ id: LeadFilter; label: string }> }> = [
  { id: 'goal', label: 'Interesse', options: [{ id: 'rent', label: 'Aluguel' }, { id: 'buy', label: 'Compra' }] },
  { id: 'temperature', label: 'Temperatura', options: [{ id: 'hot', label: 'Lead quente' }, { id: 'cold', label: 'Lead frio' }] },
  { id: 'property', label: 'Tipo de imóvel', options: [{ id: 'house', label: 'Casa' }, { id: 'apartment', label: 'Apartamento' }] },
];

const navItems: Array<{ id: View; icon: string; label: string; badge?: string }> = [
  { id: 'overview', icon: '⌂', label: 'Visão geral' },
  { id: 'conversations', icon: '◌', label: 'Conversas' },
  { id: 'leads', icon: '◎', label: 'Leads' },
  { id: 'properties', icon: '▦', label: 'Imóveis' },
  { id: 'agenda', icon: '□', label: 'Agenda' },
  { id: 'automations', icon: '↗', label: 'Automações' },
];

function NavigationIcon({ view }: { view: View }) {
  const paths: Record<View, ReactNode> = {
    overview: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
    conversations: <path d="M4 4h16v12H9l-5 4V4Z" />,
    leads: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" /></>,
    properties: <><path d="M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-3h2v3" /></>,
    agenda: <><rect x="3" y="5" width="18" height="16" /><path d="M7 3v4M17 3v4M3 11h18M7 15h3M14 15h3" /></>,
    automations: <><path d="m13 2-8 12h6l-1 8 9-13h-7Z" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[view]}</svg>;
}

const headers: Record<View, { eyebrow: string; title: string; copy: string }> = {
  overview: { eyebrow: 'Visão executiva', title: 'Bom dia, Marina', copy: 'Acompanhe os principais indicadores da operação comercial.' },
  conversations: { eyebrow: 'Central de atendimento', title: 'Conversas', copy: 'Gerencie contatos, mensagens e responsáveis por cada atendimento.' },
  leads: { eyebrow: 'Gestão comercial', title: 'Leads', copy: 'Priorize oportunidades com base no perfil e no interesse de cada cliente.' },
  properties: { eyebrow: 'Portfólio imobiliário', title: 'Imóveis', copy: 'Consulte, filtre e mantenha o portfólio de imóveis atualizado.' },
  agenda: { eyebrow: 'Compromissos comerciais', title: 'Agenda', copy: 'Organize visitas, responsáveis e confirmações em um só lugar.' },
  automations: { eyebrow: 'Processos operacionais', title: 'Automações', copy: 'Monitore e controle os fluxos recorrentes da operação.' },
};

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

function parseCsvLine(line: string, separator: string) {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === separator && !quoted) {
      cells.push(value.trim()); value = '';
    } else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function normalizeCsvHeader(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseImportedDate(value: string) {
  if (!value) return null;
  const brazilian = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const normalized = brazilian ? `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}T12:00:00.000Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLeadCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('O arquivo precisa ter cabeçalho e pelo menos uma linha de dados.');
  const separator = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = parseCsvLine(lines[0], separator).map(normalizeCsvHeader);
  const aliases: Record<string, string[]> = {
    name: ['nome', 'name', 'lead', 'cliente'], phone: ['telefone', 'phone', 'celular', 'whatsapp'], email: ['email'],
    goal: ['objetivo', 'interesse', 'intencao', 'goal'], propertyType: ['tipoimovel', 'tipodeimovel', 'imovel', 'tipo'],
    region: ['regiao', 'bairro', 'cidade'], budget: ['orcamento', 'faixa', 'valor', 'budget'], details: ['detalhes', 'observacoes', 'notas'],
    source: ['origem', 'source', 'canal'], assignedTo: ['corretor', 'responsavel', 'assignedto'], lifecycleStatus: ['status', 'etapa', 'lifecycle'],
    lastContactAt: ['ultimocontato', 'dataultimocontato', 'lastcontact', 'lastcontactat'],
  };
  const column = (key: string) => headers.findIndex((header) => aliases[key].includes(header));
  const indexes = Object.fromEntries(Object.keys(aliases).map((key) => [key, column(key)]));
  if (indexes.name < 0 || (indexes.phone < 0 && indexes.email < 0)) throw new Error('Inclua as colunas Nome e Telefone ou E-mail.');
  const statuses: LeadLifecycleStatus[] = ['Novo', 'Em atendimento', 'Visita', 'Proposta', 'Convertido', 'Perdido'];
  const read = (cells: string[], key: string) => indexes[key] >= 0 ? cells[indexes[key]] || '' : '';
  return lines.slice(1).slice(0, 500).map((line) => {
    const cells = parseCsvLine(line, separator);
    const rawStatus = read(cells, 'lifecycleStatus');
    const lifecycleStatus = statuses.find((status) => normalizeCsvHeader(status) === normalizeCsvHeader(rawStatus)) || 'Novo';
    return {
      name: read(cells, 'name'), phone: read(cells, 'phone'), email: read(cells, 'email') || null,
      goal: read(cells, 'goal') || 'Não informado', propertyType: read(cells, 'propertyType') || 'Não informado',
      region: read(cells, 'region') || 'Não informado', budget: read(cells, 'budget') || 'Não informado',
      details: read(cells, 'details') || null, source: read(cells, 'source') || 'Importação CSV',
      assignedTo: read(cells, 'assignedTo') || null, lifecycleStatus,
      lastContactAt: parseImportedDate(read(cells, 'lastContactAt')),
    };
  }).filter((lead) => lead.name && (lead.phone || lead.email));
}

const money = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 });
const compactMoney = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', notation:'compact', maximumFractionDigits:1 });
const leadDate = new Intl.DateTimeFormat('pt-BR', { timeZone:'America/Sao_Paulo' });
const leadDateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo' });

async function loadPerformance(month: string) {
  const response = await fetch(`/api/performance?month=${month}`);
  const result = await response.json() as { data?:PerformanceSnapshot; error?:string };
  if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível carregar os indicadores.');
  return result.data;
}

async function loadRemoteProperties() {
  const response = await fetch('/api/properties', { cache: 'no-store' });
  const result = await response.json() as { data?: Property[]; error?: string };
  if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível carregar os imóveis cadastrados.');
  return result.data;
}

function announcePropertyChange() {
  if (!('BroadcastChannel' in window)) return;
  const channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
  channel.postMessage({ entity: 'properties', changedAt: Date.now() });
  channel.close();
}

export default function DashboardClient({ account }: { account?: { name: string; company: string; role: 'owner' | 'broker' } }) {
  const [view, setView] = useState<View>('overview');
  const [conversationState, conversationDispatch] = useReducer(demoConversationReducer, undefined, createLiveConversationState);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadFilters, setLeadFilters] = useState<LeadFilter[]>([]);
  const [leadMode, setLeadMode] = useState<LeadMode>('all');
  const [leadImportOpen, setLeadImportOpen] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [sharingProperty, setSharingProperty] = useState<Property | null>(null);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [propertyImages, setPropertyImages] = useState<string[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [utilityModal, setUtilityModal] = useState<'profile' | 'settings' | 'broker' | 'team' | null>(null);
  const [profile, setProfile] = useState({ name: account?.name || 'Corretor', company: account?.company || 'Imobiliária' });
  const [settings, setSettings] = useState<DashboardSettings>({ alerts: true, compact: false, dark: false });
  const [notifications, setNotifications] = useState<Array<{ id:number; text:string; unread:boolean }>>([]);
  const [capturedLeads, setCapturedLeads] = useState<DashboardLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<DashboardLead | null>(null);


  useEffect(() => {
    let active = true;
    const finishLoading = (remoteLeads: LeadProfile[]) => {
      const combined = remoteLeads.filter((lead, index, all) => all.findIndex((item) => item.id === lead.id) === index).map(decorateLead);
      if (active) {
        setCapturedLeads(combined);
        setSelectedLead(combined[0] || null);
      }
    };
    fetch('/api/leads')
      .then(async (response) => { if (!response.ok) throw new Error('Não foi possível carregar os clientes. Atualize a página para tentar novamente.'); return (await response.json() as { data: LeadProfile[] }).data; })
      .then(finishLoading)
      .catch(() => { if (active) notify('Falha ao carregar clientes. Atualize a página para tentar novamente.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    let channel: BroadcastChannel | null = null;
    const synchronize = () => {
      if (document.visibilityState === 'hidden') return;
      void loadRemoteProperties().then((items) => { if (active) setProperties(items); }).catch(() => undefined);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') synchronize(); };
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(DATA_SYNC_CHANNEL);
      channel.onmessage = (event) => { if (event.data?.entity === 'properties') synchronize(); };
    }
    window.addEventListener('focus', synchronize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(synchronize, 30_000);
    return () => {
      active = false;
      channel?.close();
      window.removeEventListener('focus', synchronize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!capturedLeads.length) return;
    let active = true;
    fetch('/api/conversations', { cache: 'no-store' })
      .then(async (response) => { if (!response.ok) throw new Error('Falha ao carregar conversas.'); return (await response.json() as { data: ConversationMessage[] }).data; })
      .then((messages) => {
        if (!active) return;
        const grouped = new Map<string, ConversationMessage[]>();
        for (const message of messages) grouped.set(message.leadId, [...(grouped.get(message.leadId) || []), message]);
        conversationDispatch({
          type: 'hydrate',
          contacts: [...grouped.entries()].map(([leadId, items]) => {
            return { id: `lead-${leadId}`, messages: items.map((item) => ({ id: item.id, side: item.side, text: item.text, time: item.time, images: item.images })) };
          }),
        });
      })
      .catch(() => { if (active) notify('Falha ao carregar conversas. Atualize a página para tentar novamente.'); });
    return () => { active = false; };
  }, [capturedLeads]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/properties').then(async (response) => response.ok ? (await response.json() as { data: Property[] }).data : []),
      fetch('/api/appointments').then(async (response) => response.ok ? (await response.json() as { data: AppointmentRecord[] }).data : []),
    ]).then(([remoteProperties, remoteAppointments]) => {
      if (active) {
        setProperties(remoteProperties);
        setAppointments(remoteAppointments);
      }
    }).catch(() => {
      // Mantém listas vazias: dados fictícios nunca substituem uma falha da base real.
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
        setLeadImportOpen(false);
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  useEffect(() => {
    let storedValue: string | null = null;
    let restoreTimer: number | null = null;
    try {
      storedValue = window.localStorage?.getItem(PANEL_SETTINGS_KEY) || null;
    } catch {
      // Alguns navegadores incorporados desativam o armazenamento local.
    }
    if (!storedValue) {
      try {
        const cookie = document.cookie.split('; ').find((item) => item.startsWith(`${PANEL_SETTINGS_KEY}=`));
        storedValue = cookie ? decodeURIComponent(cookie.slice(PANEL_SETTINGS_KEY.length + 1)) : null;
      } catch {
        // Mantém as preferências padrão quando nenhum armazenamento estiver disponível.
      }
    }
    if (storedValue) {
      try {
        const stored = JSON.parse(storedValue) as Partial<DashboardSettings>;
        restoreTimer = window.setTimeout(() => setSettings((current) => ({ ...current, ...stored })), 0);
      } catch {
        // Ignora preferências antigas ou corrompidas.
      }
    }
    return () => {
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
    };
  }, []);

  const visibleLeads = useMemo(() => capturedLeads.filter((lead) => {
    const matchesSearch = `${lead.name} ${lead.intent} ${lead.region}`.toLowerCase().includes(leadSearch.toLowerCase());
    const open = lead.lifecycleStatus !== 'Convertido' && lead.lifecycleStatus !== 'Perdido';
    const matchesMode = leadMode === 'all'
      || (leadMode === 'inactive' && open && (lead.inactivityDays === null || lead.inactivityDays >= 30))
      || (leadMode === 'forgotten' && open && (lead.inactivityDays === null || lead.inactivityDays >= 60))
      || (leadMode === 'recovery' && open && lead.recoveryPotential !== 'Baixo');
    return matchesSearch && matchesMode && matchesLeadFilters(lead, leadFilters);
  }), [capturedLeads, leadFilters, leadMode, leadSearch]);
  const header = headers[view];
  const headerTitle = view === 'overview' ? `Bom dia, ${profile.name.split(/\s+/)[0]}` : header.title;
  const unreadCount = notifications.filter((item) => item.unread).length;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }

  async function persistConversationMessage(input: { leadId: string; content: string; images?: string[]; propertyId?: string }) {
    const response = await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    const result = await response.json() as { data?: ConversationMessage; error?: string };
    if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível salvar a mensagem.');
    return { id: result.data.id, time: result.data.time };
  }

  async function refreshProperties() {
    setProperties(await loadRemoteProperties());
  }

  function saveSettings(nextSettings: DashboardSettings) {
    setSettings(nextSettings);
    try {
      window.localStorage?.setItem(PANEL_SETTINGS_KEY, JSON.stringify(nextSettings));
    } catch {
      // O cookie abaixo mantém a preferência quando o armazenamento local estiver bloqueado.
    }
    try {
      document.cookie = `${PANEL_SETTINGS_KEY}=${encodeURIComponent(JSON.stringify(nextSettings))}; Max-Age=31536000; Path=/; SameSite=Lax`;
    } catch {
      // A preferência continua válida durante a sessão atual.
    }
  }

  function toggleDarkMode() {
    const nextSettings = { ...settings, dark: !settings.dark };
    saveSettings(nextSettings);
    notify(nextSettings.dark ? 'Modo escuro ativado' : 'Modo claro ativado');
  }

  function replaceLead(updated: LeadProfile) {
    const decorated = decorateLead(updated, capturedLeads.findIndex((lead) => lead.id === updated.id));
    setCapturedLeads((current) => current.map((lead) => lead.id === updated.id ? decorated : lead));
    setSelectedLead(decorated);
  }

  async function updateLead(lead: DashboardLead, changes: Partial<Pick<LeadProfile, 'lifecycleStatus' | 'lastContactAt' | 'recoverySelected' | 'assignedTo'>>) {
    const optimistic = { ...lead, ...changes };
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifecycleStatus: optimistic.lifecycleStatus, lastContactAt: optimistic.lastContactAt, recoverySelected: optimistic.recoverySelected, assignedTo: optimistic.assignedTo }),
      });
      const result = await response.json() as { data?: LeadProfile; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível atualizar o lead.');
      replaceLead(result.data);
      notify('Lead atualizado');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível atualizar o lead.');
    }
  }

  async function saveProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bedrooms = Number(form.get('bedrooms'));
    const parkingSpaces = Number(form.get('parkingSpaces'));
    const area = Number(form.get('area'));
    const payload = {
      code: String(form.get('code') || ''),
      title: String(form.get('title') || 'Novo imóvel'),
      description: String(form.get('description') || ''),
      district: String(form.get('district') || 'Centro'),
      city: String(form.get('city') || ''),
      address: String(form.get('address') || ''),
      price: String(form.get('price') || 'R$ 0'),
      meta: `${bedrooms} ${bedrooms === 1 ? 'quarto' : 'quartos'} • ${parkingSpaces} ${parkingSpaces === 1 ? 'vaga' : 'vagas'} • ${area} m²`,
      tone: editingProperty?.tone || 'orchid',
      purpose: String(form.get('purpose')) === 'Aluguel' ? 'Aluguel' : 'Venda',
      status: String(form.get('status') || 'Disponível'),
      propertyType: String(form.get('propertyType') || ''),
      bedrooms,
      parkingSpaces,
      area,
      publicUrl: String(form.get('publicUrl') || ''),
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
      announcePropertyChange();
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
      announcePropertyChange();
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

  function openPropertyShare(property: Property) {
    setSelectedProperty(null);
    setSharingProperty(property);
  }

  async function sharePropertyWithLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sharingProperty) return;
    const form = new FormData(event.currentTarget);
    const lead = capturedLeads.find((item) => item.id === String(form.get('leadId')));
    if (!lead) return notify('Selecione um lead para continuar.');
    const conversationId = `lead-${lead.id}`;
    conversationDispatch({ type: 'sync', contacts: [{ id: conversationId }] });
    try {
      const content = String(form.get('message') || '').trim();
      const saved = await persistConversationMessage({ leadId: lead.id, content, images: sharingProperty.images, propertyId: sharingProperty.id });
      conversationDispatch({
        type: 'share-property', id: conversationId, messageId: saved.id, time: saved.time,
        text: content, images: sharingProperty.images, propertyTitle: sharingProperty.title,
      });
      conversationDispatch({ type: 'select', id: conversationId });
      setSharingProperty(null);
      setView('conversations');
      notify(`Imóvel salvo na conversa com ${lead.name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar o imóvel na conversa.');
    }
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

  function openLeadConversation(lead: DashboardLead) {
    const conversationId = `lead-${lead.id}`;
    conversationDispatch({ type: 'sync', contacts: [{ id: conversationId }] });
    conversationDispatch({ type: 'select', id: conversationId });
    setSelectedLead(lead);
    setView('conversations');
  }

  return (
    <main className={`app-shell ${settings.compact ? 'compact-mode' : ''} ${settings.dark ? 'dark-mode' : ''}`}>
      <aside className="sidebar">
        <button type="button" className="brand brand-button" onClick={() => openView('overview')} aria-label="Ir para a visão geral">
          <span className="brand-mark"><svg viewBox="0 0 32 44" width="32" height="44" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25" /></svg></span>
          <div><strong>ImobFlow</strong><span>Gestão Imobiliária</span></div>
        </button>
        <nav className="nav-list" aria-label="Navegação principal">
          {navItems.map((item) => (
            <button type="button" key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => openView(item.id)} aria-label={item.label} title={item.label} aria-current={view === item.id ? 'page' : undefined}>
              <span className="nav-icon"><NavigationIcon view={item.id} /></span><span className="nav-label">{item.label}</span>{item.badge && <b>{item.badge}</b>}
            </button>
          ))}
          {account?.role === 'owner' && <button type="button" className="nav-item" onClick={() => { setUtilityModal('team'); setProfileOpen(false); }} aria-label="Gerenciar corretores" title="Gerenciar corretores"><span className="nav-icon" aria-hidden="true">◉</span><span className="nav-label">Corretores</span></button>}
        </nav>
        <div className="sidebar-card"><span className="live-dot" /><div><strong>Sistema operacional</strong><span>Serviços funcionando normalmente</span></div></div>
        <div className="profile-wrap">
          <div className="profile-row"><button type="button" className="profile-identity" onClick={() => { setUtilityModal('broker'); setProfileOpen(false); }}><span className="avatar">{profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('')}</span><div><strong>{profile.name}</strong><span>{profile.company}</span></div></button><button type="button" className="profile-options" aria-label="Mais opções do perfil" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>•••</button></div>
          {profileOpen && <div className="profile-menu popover"><strong>{account?.role === 'owner' ? 'Painel do administrador' : 'Perfil do corretor'}</strong><button type="button" onClick={() => { setUtilityModal('broker'); setProfileOpen(false); }}>Meu desempenho</button>{account?.role === 'owner' && <button type="button" onClick={() => { setUtilityModal('team'); setProfileOpen(false); }}>Gerenciar corretores</button>}<button type="button" onClick={() => { setUtilityModal('profile'); setProfileOpen(false); }}>Editar perfil</button><button type="button" onClick={() => { setUtilityModal('settings'); setProfileOpen(false); }}>Configurações</button><button type="button" onClick={async () => { await fetch('/api/admin/logout', { method:'POST' }); window.location.href = '/painel'; }}>Sair do painel</button></div>}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{header.eyebrow}</p><h1>{headerTitle}</h1><p>{header.copy}</p></div>
          <div className="header-actions">
            <button type="button" className="icon-button theme-toggle" aria-label={settings.dark ? 'Ativar modo claro' : 'Ativar modo escuro'} title={settings.dark ? 'Modo claro' : 'Modo escuro'} aria-pressed={settings.dark} onClick={toggleDarkMode}>{settings.dark ? '☀' : '☾'}</button>
            <div className="notification-wrap">
              <button type="button" className="icon-button" aria-label={`Notificações: ${unreadCount} não lidas`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>♢{settings.alerts && unreadCount > 0 && <i />}</button>
              {notificationsOpen && <div className="notification-menu popover"><div><strong>Notificações</strong><button type="button" onClick={() => setNotifications((items) => items.map((item) => ({ ...item, unread: false })))}>Marcar como lidas</button></div>{notifications.map((item) => <button type="button" className={item.unread ? 'unread' : ''} key={item.id} onClick={() => { setNotifications((items) => items.map((current) => current.id === item.id ? { ...current, unread: false } : current)); notify(item.text); }}><i />{item.text}</button>)}</div>}
            </div>
            <button type="button" className="primary-button" onClick={openNewProperty}>＋ Novo imóvel</button>
          </div>
        </header>

        {view === 'overview' && <Overview notify={notify} />}
        {view === 'conversations' && <ConversationCenter state={conversationState} dispatch={conversationDispatch} notify={notify} openAgenda={() => openView('agenda')} persistMessage={persistConversationMessage} refreshProperties={refreshProperties} leads={capturedLeads} properties={properties} />}
        {view === 'leads' && <><LeadIntelligenceCenter leads={capturedLeads} mode={leadMode} onMode={setLeadMode} onImport={() => setLeadImportOpen(true)} /><LeadFilterBar leads={capturedLeads} active={leadFilters} onChange={setLeadFilters} />{selectedLead ? <Leads leads={visibleLeads} selected={selectedLead} onSelect={setSelectedLead} search={leadSearch} setSearch={setLeadSearch} onContinue={openLeadConversation} notify={notify} onUpdate={updateLead} /> : <section className="panel empty-live-data"><h2>Nenhum lead cadastrado</h2><p>Importe a carteira da imobiliária ou receba um novo contato pelo formulário do site.</p><button type="button" className="primary-button" onClick={() => setLeadImportOpen(true)}>Importar clientes</button></section>}</>}
        {view === 'properties' && <Properties properties={properties} search={propertySearch} setSearch={setPropertySearch} add={openNewProperty} onOpen={setSelectedProperty} onShare={openPropertyShare} />}
        {view === 'agenda' && <Agenda items={appointments} setItems={setAppointments} notify={notify} leads={capturedLeads} properties={properties} brokerName={profile.name} />}
        {view === 'automations' && <AutomationCenter notify={notify} />}
      </section>

      {propertyModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { setPropertyModalOpen(false); setEditingProperty(null); setPropertyImages([]); }}>
          <form className="modal-card property-editor-modal" onSubmit={saveProperty} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><p className="eyebrow">Portfólio imobiliário</p><h2>{editingProperty ? 'Editar imóvel' : 'Novo imóvel'}</h2></div><button type="button" aria-label="Fechar" onClick={() => { setPropertyModalOpen(false); setEditingProperty(null); setPropertyImages([]); }}>×</button></div>
            <section className="property-form-section"><h3>Identificação</h3><div className="form-grid"><label>Código do imóvel<input name="code" defaultValue={editingProperty?.code} placeholder="Ex.: IMO-1042" autoFocus required /></label><label>Título<input name="title" defaultValue={editingProperty?.title} placeholder="Ex.: Residencial das Flores" required /></label></div><label>Descrição<textarea name="description" defaultValue={editingProperty?.description || (editingProperty?.code ? '' : editingProperty?.meta)} placeholder="Destaques, acabamentos, condomínio e diferenciais do imóvel" rows={4} required /></label></section>
            <section className="property-form-section"><h3>Localização e valores</h3><div className="form-grid"><label>Finalidade<select name="purpose" defaultValue={editingProperty?.purpose || 'Venda'}><option>Venda</option><option>Aluguel</option></select></label><label>Preço<input name="price" defaultValue={editingProperty?.price} placeholder="R$ 650.000" required /></label></div><div className="form-grid"><label>Bairro<input name="district" defaultValue={editingProperty?.district} placeholder="Centro" required /></label><label>Cidade<input name="city" defaultValue={editingProperty?.city} placeholder="Poços de Caldas" required /></label></div><label>Endereço<input name="address" defaultValue={editingProperty?.address} placeholder="Rua, número e complemento" /></label></section>
            <section className="property-form-section"><h3>Características</h3><div className="form-grid"><label>Tipo do imóvel<select name="propertyType" defaultValue={editingProperty?.propertyType || ''} required><option value="" disabled>Selecione</option><option>Apartamento</option><option>Casa</option><option>Studio</option><option>Terreno</option><option>Comercial</option></select></label><label>Situação<select name="status" defaultValue={editingProperty?.status || 'Disponível'}><option>Disponível</option><option>Reservado</option><option>Vendido</option><option>Alugado</option></select></label></div><div className="property-number-grid"><label>Quartos<input name="bedrooms" type="number" min="0" defaultValue={editingProperty?.bedrooms} placeholder="3" required /></label><label>Vagas<input name="parkingSpaces" type="number" min="0" defaultValue={editingProperty?.parkingSpaces} placeholder="2" required /></label><label>Metragem (m²)<input name="area" type="number" min="0" step="0.01" defaultValue={editingProperty?.area} placeholder="98" required /></label></div></section>
            <div className="property-image-field">
              <div><strong>Fotos do imóvel</strong><span>Até 5 fotos em JPG, PNG ou WebP</span></div>
              <input id="property-images" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void addPropertyImages(event.target.files); event.target.value = ''; }} />
              <button type="button" className="image-upload-button" disabled={preparingImages || propertyImages.length >= 5} onClick={() => document.getElementById('property-images')?.click()}>{preparingImages ? 'Preparando fotos...' : '＋ Adicionar imagens'}</button>
              {propertyImages.length > 0 && <div className="property-image-previews">{propertyImages.map((image,index) => <div key={`${image.slice(-24)}-${index}`}><img src={image} alt={`Foto ${index + 1} do imóvel`} /><button type="button" aria-label={`Remover foto ${index + 1}`} onClick={() => setPropertyImages((current) => current.filter((_,imageIndex) => imageIndex !== index))}>×</button>{index === 0 && <span>Capa</span>}</div>)}</div>}
            </div>
            <label className="property-public-url">Link público do imóvel<input name="publicUrl" type="url" defaultValue={editingProperty?.publicUrl} placeholder="https://imobiliaria.com.br/imovel/..." /></label>
            <div className="modal-actions"><button type="button" onClick={() => { setPropertyModalOpen(false); setEditingProperty(null); setPropertyImages([]); }}>Cancelar</button><button className="primary-button" type="submit" disabled={savingProperty || preparingImages}>{savingProperty ? 'Salvando...' : 'Salvar imóvel'}</button></div>
          </form>
        </div>
      )}

      {selectedProperty && <PropertyDetail property={selectedProperty} close={() => setSelectedProperty(null)} openAgenda={() => openView('agenda')} share={() => openPropertyShare(selectedProperty)} edit={() => { setEditingProperty(selectedProperty); setPropertyImages(selectedProperty.images); setSelectedProperty(null); setPropertyModalOpen(true); }} remove={() => removeProperty(selectedProperty)} />}
      {sharingProperty && <PropertyShareModal property={sharingProperty} leads={capturedLeads} close={() => setSharingProperty(null)} submit={sharePropertyWithLead} />}
      {utilityModal === 'profile' && <ProfileModal profile={profile} close={() => setUtilityModal(null)} save={(nextProfile) => { setProfile(nextProfile); setUtilityModal(null); notify('Perfil atualizado'); }} />}
      {utilityModal === 'settings' && <SettingsModal settings={settings} close={() => setUtilityModal(null)} save={(nextSettings) => { saveSettings(nextSettings); setUtilityModal(null); notify('Configurações salvas'); }} />}
      {utilityModal === 'broker' && <BrokerProfileModal brokerName={profile.name} company={profile.company} close={() => setUtilityModal(null)} />}
      {utilityModal === 'team' && account?.role === 'owner' && <TeamModal close={() => setUtilityModal(null)} notify={notify} />}
      {leadImportOpen && <LeadImportModal close={() => setLeadImportOpen(false)} notify={notify} onImported={(leads) => { const decorated = leads.map((lead,index) => decorateLead(lead,index)); setCapturedLeads((current) => [...decorated, ...current.filter((lead) => !decorated.some((item) => item.id === lead.id))]); if (decorated[0]) setSelectedLead(decorated[0]); }} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Overview({ notify }: { notify:(message:string)=>void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [performance, setPerformance] = useState<PerformanceSnapshot | null>(null);
  const [modal, setModal] = useState<'sale' | 'goals' | null>(null);
  const [dealType, setDealType] = useState<'Venda' | 'Aluguel'>('Venda');
  const [savingDeal, setSavingDeal] = useState(false);
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
    if (savingDeal) return;
    setSavingDeal(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/performance', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ dealType, date:form.get('date'), broker:form.get('broker'), property:form.get('property'), client:form.get('client'), amount:Number(form.get('amount')) }) });
      const result = await response.json() as { error?:string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível registrar a venda.');
      setModal(null);
      notify(dealType === 'Aluguel' ? 'Aluguel registrado separadamente das vendas' : 'Venda registrada no resultado da equipe');
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível registrar o negócio.');
    } finally { setSavingDeal(false); }
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
    if (!window.confirm('Excluir este registro de negócio?')) return;
    try {
      const response = await fetch(`/api/performance/sales/${id}`, { method:'DELETE' });
      if (!response.ok) throw new Error('Não foi possível excluir o negócio.');
      await refresh();
      notify('Negócio removido do resultado');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível excluir o negócio.');
    }
  }

  if (loading && !performance) return <div className="performance-loading panel">Carregando indicadores comerciais...</div>;
  if (!performance) return <div className="performance-loading panel">{loadError || 'Os indicadores não estão disponíveis neste momento.'}</div>;

  const goalProgress = performance.companyGoal ? Math.min(100, (performance.totalSold / performance.companyGoal) * 100) : 0;
  const remaining = Math.max(0, performance.companyGoal - performance.totalSold);
  const monthTitle = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const defaultSaleDate = month === new Date().toISOString().slice(0, 7) ? new Date().toISOString().slice(0, 10) : `${month}-01`;

  const performanceKey = `${month}-${performance.totalSold}-${performance.salesCount}-${performance.history.map((item) => `${item.month}:${item.sold}`).join('|')}`;
  return <>
    <div className="performance-animated" key={performanceKey}>
    <section className="performance-toolbar"><div><span className={`performance-live ${performance.dataMode === 'demo' ? 'demo' : ''}`}><i/> {performance.dataMode === 'demo' ? 'Dados demonstrativos locais' : 'Dados atualizados'}</span><strong>Resultados de {monthTitle}</strong></div><div><label>Competência<input type="month" value={month} onChange={(event) => { setLoading(true); setLoadError(null); setMonth(event.target.value); }} /></label><button type="button" onClick={() => setModal('goals')}>Editar metas</button><button type="button" className="primary-button" onClick={() => setModal('sale')}>＋ Registrar negócio</button></div></section>

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

      <article className="panel sales-history"><div className="panel-heading"><div><p className="eyebrow">Evolução comercial</p><h2>Vendas nos últimos meses</h2></div></div><SalesHistoryChart history={performance.history} /></article>
    </section>

    <section className="panel recent-sales"><div className="panel-heading"><div><p className="eyebrow">Movimentação</p><h2>Negócios registrados</h2></div><strong>{money.format(performance.totalSold)} em vendas · {money.format(performance.sales.filter((sale) => sale.dealType === 'Aluguel').reduce((sum, sale) => sum + sale.amount, 0))}/mês em aluguéis registrados</strong></div><div className="recent-sales-table"><div className="sale-row sale-head"><span>Data</span><span>Corretor</span><span>Cliente</span><span>Imóvel</span><span>Valor</span><span/></div>{performance.sales.slice(0,8).map((sale) => <div className="sale-row" key={sale.id}><time>{new Date(`${sale.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone:'UTC' })}</time><strong>{sale.broker}</strong><span>{sale.client}</span><span>{sale.property}<small className="deal-type-label">{sale.dealType || 'Venda'}</small></span><b>{money.format(sale.amount)}{sale.dealType === 'Aluguel' ? '/mês' : ''}</b><button type="button" aria-label={`Excluir venda de ${sale.client}`} onClick={() => removeSale(sale.id)}>×</button></div>)}{performance.sales.length === 0 && <p className="performance-empty">Nenhuma venda registrada neste mês.</p>}</div></section>
    </div>

    {modal === 'sale' && <div className="modal-backdrop" role="presentation" onMouseDown={() => !savingDeal && setModal(null)}><form className="modal-card deal-modal" onSubmit={registerSale} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">Resultado comercial</p><h2>{dealType === 'Venda' ? 'Registrar venda' : 'Registrar aluguel'}</h2></div><button type="button" disabled={savingDeal} aria-label="Fechar" onClick={() => setModal(null)}>×</button></div>
      <div className="native-segments" role="group" aria-label="Tipo de negócio">{(['Venda', 'Aluguel'] as const).map((type) => <button type="button" disabled={savingDeal} aria-pressed={dealType === type} key={type} onClick={() => setDealType(type)}>{type === 'Venda' ? 'Imóvel vendido' : 'Aluguel'}</button>)}</div>
      <p className="deal-help">{dealType === 'Venda' ? 'Registre o valor total da venda concluída.' : 'Informe o valor mensal contratado. Aluguéis não são somados ao VGV de vendas.'}</p>
      <div className="form-grid"><label>Data<input name="date" type="date" defaultValue={defaultSaleDate} required /></label><label>Corretor<select name="broker" required>{performance.brokers.map((broker) => <option key={broker.broker}>{broker.broker}</option>)}</select></label></div>
      <label>Cliente<input name="client" placeholder={dealType === 'Venda' ? 'Nome do comprador' : 'Nome do locatário'} required /></label><label>Imóvel<input name="property" placeholder={dealType === 'Venda' ? 'Imóvel vendido' : 'Imóvel alugado'} required /></label>
      <label>{dealType === 'Venda' ? 'Valor da venda (R$)' : 'Aluguel mensal (R$)'}<input key={dealType} name="amount" type="number" min="0.01" step="0.01" placeholder={dealType === 'Venda' ? '575000,00' : '2500,00'} required /></label>
      <p className="deal-help">O registro financeiro não muda automaticamente a situação do catálogo. Atualize o imóvel em Editar.</p>
      <div className="modal-actions"><button type="button" disabled={savingDeal} onClick={() => setModal(null)}>Cancelar</button><button type="submit" disabled={savingDeal} className="primary-button">{savingDeal ? 'Salvando…' : dealType === 'Venda' ? 'Registrar venda' : 'Registrar aluguel'}</button></div>
    </form></div>}

    {modal === 'goals' && <div className="modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><form className="modal-card performance-settings-modal" onSubmit={saveGoals} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Planejamento mensal</p><h2>Metas e conversão</h2></div><button type="button" aria-label="Fechar" onClick={() => setModal(null)}>×</button></div><label>Meta da imobiliária<input name="companyGoal" type="number" min="0" step="10000" defaultValue={performance.companyGoal} required /></label><div className="form-grid"><label>Leads recebidos<input name="leadsReceived" type="number" min="0" defaultValue={performance.leadsReceived} required /></label><label>Leads convertidos<input name="convertedLeads" type="number" min="0" defaultValue={performance.convertedLeads} required /></label></div><label>Leads recuperados<input name="recoveredLeads" type="number" min="0" defaultValue={performance.recoveredLeads} required /></label><div className="broker-goal-fields"><strong>Metas individuais</strong>{performance.brokers.map((broker,index) => <label key={broker.broker}>{broker.broker}<input name={`broker-goal-${index}`} type="number" min="0" step="10000" defaultValue={broker.goal} required /></label>)}</div><div className="modal-actions"><button type="button" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="primary-button">Salvar indicadores</button></div></form></div>}
  </>;
}

function SalesHistoryChart({ history }: { history: { month: string; sold: number }[] }) {
  if (!history.length) return <p className="performance-empty">Ainda não há histórico de vendas.</p>;
  const maximum = Math.max(...history.map((item) => item.sold), 1);
  const points = history.map((item, index) => ({
    x: history.length === 1 ? 320 : 16 + index * 608 / (history.length - 1),
    y: 204 - item.sold / maximum * 176,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const chartKey = history.map((item) => `${item.month}:${item.sold}`).join('|');
  return <figure className="native-sales-chart chart-reveal" key={chartKey}>
    <svg viewBox="0 0 640 224" role="img" aria-label="Evolução das vendas por mês. Valores detalhados abaixo.">
      {[28, 72, 116, 160, 204].map((y) => <line key={y} x1="16" x2="624" y1={y} y2={y} className="chart-gridline" />)}
      <polygon points={`${points[0].x},204 ${line} ${points[points.length - 1].x},204`} className="chart-area" />
      <polyline points={line} className="chart-line" />
      {points.map((point, index) => <circle key={history[index].month} cx={point.x} cy={point.y} r="4" className="chart-point" style={{ '--chart-index': index } as CSSProperties}><title>{history[index].month + ': ' + money.format(history[index].sold)}</title></circle>)}
    </svg>
    <figcaption className="chart-values">{history.map((item) => <div key={item.month}><span>{new Intl.DateTimeFormat('pt-BR', { month:'short', timeZone:'UTC' }).format(new Date(`${item.month}-01T12:00:00Z`)).replace('.','')}</span><strong>{compactMoney.format(item.sold)}</strong></div>)}</figcaption>
  </figure>;
}

function LeadIntelligenceCenter({ leads, mode, onMode, onImport }: { leads: DashboardLead[]; mode: LeadMode; onMode: (mode: LeadMode) => void; onImport: () => void }) {
  const openLeads = leads.filter((lead) => !['Convertido', 'Perdido'].includes(lead.lifecycleStatus));
  const inactive = openLeads.filter((lead) => lead.inactivityDays === null || lead.inactivityDays >= 30);
  const forgotten = openLeads.filter((lead) => lead.inactivityDays === null || lead.inactivityDays >= 60);
  const high = openLeads.filter((lead) => lead.recoveryPotential === 'Alto');
  const medium = openLeads.filter((lead) => lead.recoveryPotential === 'Médio');
  const estimatedRecovery = Math.min(openLeads.length, Math.round(high.length * .3 + medium.length * .15));
  const completeness = leads.length ? Math.round(leads.reduce((total, lead) => total + [lead.phone, lead.email, lead.goal !== 'Não informado', lead.propertyType !== 'Não informado', lead.region !== 'Não informado', lead.budget !== 'Não informado', lead.lastContactAt].filter(Boolean).length / 7, 0) / leads.length * 100) : 0;
  const selected = leads.filter((lead) => lead.recoverySelected).length;

  const cards: Array<{ id: LeadMode; label: string; value: number; detail: string; tone: string }> = [
    { id: 'all', label: 'Base diagnosticada', value: leads.length, detail: `${completeness}% de completude média`, tone: 'blue' },
    { id: 'inactive', label: 'Leads inativos', value: inactive.length, detail: '30 dias ou sem contato', tone: 'amber' },
    { id: 'forgotten', label: 'Oportunidades esquecidas', value: forgotten.length, detail: '60 dias sem avanço', tone: 'slate' },
    { id: 'recovery', label: 'Potencial de recuperação', value: high.length + medium.length, detail: `estimativa de ${estimatedRecovery} retomadas`, tone: 'green' },
  ];

  return <section className="lead-intelligence">
    <div className="lead-intelligence-head"><div><p className="eyebrow">Inteligência da base</p><h2>Diagnóstico e recuperação</h2><p>Encontre oportunidades paradas antes de iniciar qualquer automação.</p></div><div><span>{selected} na carteira de recuperação</span><button type="button" className="primary-button" onClick={onImport}>＋ Importar base</button></div></div>
    <div className="lead-diagnostic-grid">{cards.map((card) => <button type="button" className={`lead-diagnostic-card ${card.tone} ${mode === card.id ? 'active' : ''}`} onClick={() => onMode(card.id)} key={card.id}><span>{card.label}</span><strong>{card.value}</strong><small>{card.detail}</small><i>Ver leads →</i></button>)}</div>
    <div className="lead-diagnosis-note"><span>Diagnóstico</span><p>{leads.length === 0 ? 'Importe uma base para iniciar a análise.' : inactive.length === 0 ? 'A base está ativa e não há oportunidades paradas no momento.' : `${Math.round(inactive.length / Math.max(openLeads.length, 1) * 100)}% da carteira aberta está inativa. Priorize os ${high.length} leads de alto potencial, revise dados ausentes e só depois programe reativação.`}</p><button type="button" onClick={() => onMode(mode === 'all' ? 'recovery' : 'all')}>{mode === 'all' ? 'Abrir oportunidades' : 'Voltar à base completa'}</button></div>
  </section>;
}

function LeadImportModal({ close, notify, onImported }: { close: () => void; notify: (message: string) => void; onImported: (leads: LeadProfile[]) => void }) {
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof parseLeadCsv>>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size > 5_000_000) { setError('Selecione um CSV de até 5 MB.'); return; }
    try {
      const leads = parseLeadCsv(await file.text());
      if (leads.length === 0) throw new Error('Nenhum lead válido foi encontrado no arquivo.');
      setFileName(file.name); setPreview(leads); setError(null);
    } catch (reason) {
      setPreview([]); setFileName(''); setError(reason instanceof Error ? reason.message : 'Não foi possível ler o CSV.');
    }
  }

  function downloadTemplate() {
    const content = 'Nome;Telefone;Email;Objetivo;Tipo de imóvel;Região;Orçamento;Último contato;Status;Origem;Corretor;Observações\nAna Souza;(35) 99999-0000;ana@exemplo.com;Comprar;Apartamento;Centro;Até R$ 600 mil;15/07/2026;Em atendimento;Portal;Marina Oliveira;Prefere varanda';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'modelo-leads-imobflow.csv'; link.click(); URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!preview.length) return;
    setImporting(true);
    try {
      const response = await fetch('/api/leads/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: preview }) });
      const result = await response.json() as { data?: { imported: number; skipped: number; leads: LeadProfile[] }; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível importar a base.');
      onImported(result.data.leads);
      notify(`${result.data.imported} leads importados${result.data.skipped ? ` e ${result.data.skipped} duplicados ignorados` : ''}`);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar a base.');
    } finally { setImporting(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><article className="modal-card lead-import-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Entrada de dados</p><h2>Importar base de leads</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><p className="lead-import-intro">Envie uma planilha CSV. O ImobFlow identifica colunas, ignora duplicados e calcula prioridade, inatividade e potencial de recuperação.</p><input id="lead-csv-file" className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0])} /><button type="button" className={`lead-import-drop ${preview.length ? 'ready' : ''}`} onClick={() => document.getElementById('lead-csv-file')?.click()}><span>{preview.length ? '✓' : '⇧'}</span><strong>{fileName || 'Selecionar arquivo CSV'}</strong><small>{preview.length ? `${preview.length} registros válidos encontrados` : 'Até 500 leads por arquivo • máximo de 5 MB'}</small></button><div className="lead-import-columns"><strong>Colunas reconhecidas</strong><p>Nome, telefone, e-mail, objetivo, tipo de imóvel, região, orçamento, último contato, status, origem, corretor e observações.</p><button type="button" onClick={downloadTemplate}>Baixar modelo CSV</button></div>{error && <p className="lead-import-error">{error}</p>}{preview.length > 0 && <div className="lead-import-preview"><div><strong>Prévia da importação</strong><span>{preview.length} leads prontos</span></div>{preview.slice(0, 4).map((lead,index) => <div key={`${lead.phone}-${index}`}><span><b>{lead.name}</b><small>{lead.phone || lead.email}</small></span><span>{lead.goal}<small>{lead.propertyType}</small></span><span>{lead.region}<small>{lead.lastContactAt ? new Date(lead.lastContactAt).toLocaleDateString('pt-BR') : 'Sem último contato'}</small></span></div>)}</div>}<div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="button" className="primary-button" disabled={!preview.length || importing} onClick={() => void submit()}>{importing ? 'Analisando e importando...' : `Importar ${preview.length || ''} leads`}</button></div></article></div>;
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

function Leads({ leads, selected, onSelect, search, setSearch, onContinue, notify, onUpdate }: { leads: DashboardLead[]; selected: DashboardLead; onSelect:(lead:DashboardLead)=>void; search:string; setSearch:(value:string)=>void; onContinue:(lead:DashboardLead)=>void; notify:(message:string)=>void; onUpdate:(lead:DashboardLead, changes:Partial<Pick<LeadProfile, 'lifecycleStatus' | 'lastContactAt' | 'recoverySelected' | 'assignedTo'>>)=>void }) {
  const statuses: LeadLifecycleStatus[] = ['Novo', 'Em atendimento', 'Visita', 'Proposta', 'Convertido', 'Perdido'];
  return <div className="lead-management"><section className="table-panel panel"><div className="toolbar"><div className="search-field">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Buscar lead" placeholder="Buscar por nome, região ou intenção"/></div><span className="live-leads"><i/> {leads.length} {leads.length === 1 ? 'perfil encontrado' : 'perfis encontrados'}</span></div><div className="lead-table"><div className="table-row table-head intelligence-row"><span>Lead</span><span>Intenção</span><span>Etapa</span><span>Primeiro contato</span><span>Inatividade</span><span>Recuperação</span><span>Prioridade</span><span/></div>{leads.map((lead)=><button type="button" className={`table-row intelligence-row ${selected.id===lead.id?'selected':''}`} key={lead.id} onClick={()=>onSelect(lead)}><span className="lead-cell"><i className={`lead-avatar avatar-${lead.tone}`}>{lead.initials}</i><b>{lead.name}<small>{lead.source}</small></b></span><span>{lead.intent}<small>{lead.region}</small></span><span><em className="lifecycle-badge">{lead.lifecycleStatus}</em></span><span className="first-contact-date">{leadDate.format(new Date(lead.createdAt))}</span><span className={lead.inactivityDays === null || lead.inactivityDays >= 30 ? 'inactive-days alert' : 'inactive-days'}>{lead.inactivityDays === null ? 'Sem registro' : `${lead.inactivityDays} dias`}</span><span><em className={`recovery-badge recovery-${normalizeCsvHeader(lead.recoveryPotential)}`}>{lead.recoveryPotential}</em></span><span className="score-cell" aria-label={`Prioridade ${lead.score} de 100`}><b>{lead.score}</b><small>/100</small></span><span>›</span></button>)}{leads.length===0&&<div className="empty-leads"><span>◎</span><h3>Nenhum resultado</h3><p>Ajuste o diagnóstico, a busca ou os filtros para consultar a base.</p></div>}</div></section><aside className="captured-profile panel"><div className="captured-head"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><p className="eyebrow">Análise individual</p><h2>{selected.name}</h2><span>{selected.source} • primeiro contato em {leadDate.format(new Date(selected.createdAt))}</span></div><em className={`recovery-badge recovery-${normalizeCsvHeader(selected.recoveryPotential)}`}>{selected.recoveryPotential}</em></div><div className="profile-explanation"><span>i</span><div><strong>Diagnóstico comercial</strong><p>{selected.summary}</p></div></div><div className="lead-operational-fields"><label>Etapa comercial<select value={selected.lifecycleStatus} onChange={(event) => onUpdate(selected, { lifecycleStatus:event.target.value as LeadLifecycleStatus })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label>Responsável<input value={selected.assignedTo || ''} placeholder="Sem responsável" onChange={(event) => onSelect({ ...selected, assignedTo:event.target.value })} onBlur={(event) => onUpdate(selected, { assignedTo:event.target.value || null })}/></label></div><dl><div><dt>Objetivo</dt><dd>{selected.goal}</dd></div><div><dt>Tipo de imóvel</dt><dd>{selected.propertyType}</dd></div><div><dt>Região desejada</dt><dd>{selected.region}</dd></div><div><dt>Faixa de investimento</dt><dd>{selected.budget}</dd></div><div><dt>Primeiro contato</dt><dd>{leadDateTime.format(new Date(selected.createdAt))}</dd></div><div><dt>Último contato</dt><dd>{selected.lastContactAt ? leadDateTime.format(new Date(selected.lastContactAt)) : 'Não registrado'}</dd></div><div><dt>Tempo inativo</dt><dd>{selected.inactivityDays === null ? 'Sem histórico' : `${selected.inactivityDays} dias`}</dd></div></dl><div className="score-explanation"><div><span>Prioridade comercial</span><strong>{selected.score}<small>/100</small></strong></div><ul>{selected.scoreReasons.slice(0,5).map((reason) => <li key={reason}>✓ {reason}</li>)}</ul></div><div className="lead-action-grid"><button type="button" onClick={() => onUpdate(selected, { lastContactAt:new Date().toISOString(), lifecycleStatus:'Em atendimento' })}>Registrar contato agora</button><button type="button" className={selected.recoverySelected ? 'selected-recovery' : ''} onClick={() => onUpdate(selected, { recoverySelected:!selected.recoverySelected })}>{selected.recoverySelected ? '✓ Na carteira de recuperação' : '＋ Adicionar à recuperação'}</button></div><button type="button" className="profile-whatsapp demo-channel" onClick={() => { notify(`Atendimento aberto para ${selected.name}`); onContinue(selected); }}>Abrir conversa com {selected.name.split(' ')[0]} →</button><p className="automation-boundary">Nenhuma mensagem será enviada automaticamente nesta etapa.</p></aside></div>;
}

function Properties({ properties, search, setSearch, add, onOpen, onShare }: { properties:Property[]; search:string; setSearch:(value:string)=>void; add:()=>void; onOpen:(property:Property)=>void; onShare:(property:Property)=>void }) {
  const [purpose, setPurpose] = useState<'Todos' | 'Venda' | 'Aluguel'>('Todos');
  const [catalogTab, setCatalogTab] = useState('Todos');
  const visible = properties.filter((property) => `${property.title} ${property.district}`.toLowerCase().includes(search.toLowerCase()) && (purpose === 'Todos' || property.purpose === purpose) && (catalogTab === 'Todos' || (catalogTab === 'Vendidos' ? property.status === 'Vendido' : catalogTab === 'Alugados' ? property.status === 'Alugado' : catalogTab === 'Aluguel' ? property.purpose === 'Aluguel' && (!property.status || property.status === 'Disponível') : property.purpose === 'Venda' && (!property.status || property.status === 'Disponível'))));
  return <><div className="native-segments catalog-segments" role="group" aria-label="Categorias de imóveis">{['Todos', 'À venda', 'Aluguel', 'Vendidos', 'Alugados'].map((tab) => <button type="button" key={tab} aria-pressed={catalogTab === tab} onClick={() => setCatalogTab(tab)}>{tab}</button>)}</div><div className="catalog-toolbar"><div className="search-field">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} aria-label="Buscar imóvel" placeholder="Buscar imóvel ou bairro"/></div><div className="catalog-actions"><select aria-label="Finalidade" value={purpose} onChange={(event) => setPurpose(event.target.value as typeof purpose)}><option>Todos</option><option>Venda</option><option>Aluguel</option></select><button type="button" className="primary-button" onClick={add}>＋ Adicionar</button></div></div><div className="property-grid">{visible.map((property)=><article className="property-card" key={property.id}><button type="button" className={`property-visual ${property.tone} ${property.images.length ? 'has-image' : ''}`} onClick={() => onOpen(property)} aria-label={`Abrir ${property.title}`}>{property.images[0] ? <img src={property.images[0]} alt="" /> : <span>▦</span>}{property.images.length > 1 && <b className="image-count">▧ {property.images.length}</b>}</button><div className="property-copy"><small>{property.status && property.status !== 'Disponível' ? property.status : property.purpose} • {property.district}</small><h3>{property.title}</h3><p>{property.meta}</p><div><strong>{property.price}</strong><span className="property-card-actions"><button type="button" className="property-share-button" onClick={() => onShare(property)}>Enviar</button><button type="button" aria-label={`Ver detalhes de ${property.title}`} onClick={() => onOpen(property)}>›</button></span></div></div></article>)}{visible.length === 0 && <div className="empty-catalog panel"><span>▦</span><h3>Nenhum imóvel encontrado</h3><p>Ajuste ou limpe os filtros para continuar.</p><button type="button" onClick={() => { setPurpose('Todos'); setCatalogTab('Todos'); setSearch(''); }}>Limpar filtros</button></div>}</div></>;
}

function PropertyDetail({ property, close, openAgenda, share, edit, remove }: { property:Property; close:()=>void; openAgenda:()=>void; share:()=>void; edit:()=>void; remove:()=>void }) {
  const [activeImage, setActiveImage] = useState(0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}>
    <article className="modal-card property-detail-modal native-property-detail" role="dialog" aria-modal="true" aria-label={property.title} onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-head"><div><p className="eyebrow">{property.district} · {property.purpose}</p><h2>{property.title}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={close}>×</button></header>
      <div className="property-detail-content">
        <div className="detail-media">
          {property.images.length ? <div className="detail-photo"><img src={property.images[activeImage] || property.images[0]} alt={property.title + ', foto ' + (activeImage + 1)} /></div> : <div className="detail-no-photo"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></svg><strong>Sem fotos cadastradas</strong><span>Adicione fotos em Editar imóvel.</span></div>}
          {property.images.length > 1 && <div className="property-gallery-thumbs">{property.images.map((image,index) => <button type="button" className={activeImage === index ? 'active' : ''} aria-pressed={activeImage === index} key={index} onClick={() => setActiveImage(index)} aria-label={'Ver foto ' + (index + 1)}><img src={image} alt="" /></button>)}</div>}
        </div>
        <div className="detail-information"><div className="detail-status-row"><span className="detail-status">{property.status || 'Disponível'}</span>{property.code && <span className="property-code">{property.code}</span>}</div><p className="detail-price-label">{property.purpose === 'Aluguel' ? 'Aluguel mensal anunciado' : 'Valor anunciado'}</p><strong className="detail-price">{property.price}</strong><div className="detail-facts">{property.meta.split('•').map((item,index) => <span key={index}>{item.trim()}</span>)}</div>{property.description && <p className="property-description">{property.description}</p>}<dl><div><dt>Finalidade</dt><dd>{property.purpose}</dd></div><div><dt>Tipo</dt><dd>{property.propertyType || 'Não informado'}</dd></div><div><dt>Bairro</dt><dd>{property.district}</dd></div><div><dt>Cidade</dt><dd>{property.city || 'Não informada'}</dd></div><div><dt>Endereço</dt><dd>{property.address || 'Não informado'}</dd></div></dl>{property.publicUrl && <a className="property-public-link" href={property.publicUrl} target="_blank" rel="noreferrer">Abrir anúncio público ↗</a>}</div>
      </div>
      <footer className="modal-actions"><button type="button" className="danger-button" onClick={remove}>Excluir</button><button type="button" onClick={edit}>Editar imóvel</button><button type="button" onClick={() => { close(); openAgenda(); }}>Agendar visita</button><button type="button" className="primary-button" onClick={share}>Enviar imóvel</button></footer>
    </article>
  </div>;
}

function PropertyShareModal({ property, leads, close, submit }: { property:Property; leads:DashboardLead[]; close:()=>void; submit:(event:FormEvent<HTMLFormElement>)=>void }) {
  const [leadSearch, setLeadSearch] = useState('');
  const [category, setCategory] = useState<'Todos' | 'Quentes' | 'Mornos' | 'Frios'>('Todos');
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id || '');
  const filteredLeads = leads.filter((lead) => {
    const temperature = normalizeCsvHeader(lead.temperature);
    const categoryMatches = category === 'Todos' || (category === 'Quentes' ? temperature.includes('quente') : category === 'Mornos' ? temperature.includes('morno') : temperature.includes('frio'));
    return categoryMatches && normalizeCsvHeader(`${lead.name} ${lead.region} ${lead.budget} ${lead.lifecycleStatus}`).includes(normalizeCsvHeader(leadSearch));
  });
  const defaultMessage = `Separei uma opção que combina com o seu perfil:\n\n${property.title}\n${property.purpose} · ${property.propertyType || 'Imóvel'}\n${property.district}${property.city ? `, ${property.city}` : ''}\n${property.meta}\n${property.price}${property.publicUrl ? `\n\nVeja os detalhes: ${property.publicUrl}` : ''}`;
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="modal-card property-share-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Compartilhar oportunidade</p><h2>Enviar imóvel</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><div className="share-property-preview">{property.images[0] ? <img src={property.images[0]} alt="" /> : <span>▦</span>}<div><strong>{property.title}</strong><small>{property.district} · {property.price}</small><em>{property.images.length ? `${property.images.length} ${property.images.length === 1 ? 'foto incluída' : 'fotos incluídas'}` : 'Sem fotos cadastradas'}</em></div></div><input type="hidden" name="leadId" value={selectedLeadId} /><div className="lead-picker"><label>Cliente ou lead<div className="picker-search">⌕<input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Pesquisar pelo nome do cliente" /></div></label><div className="picker-categories" role="group" aria-label="Categorias de leads">{(['Todos', 'Quentes', 'Mornos', 'Frios'] as const).map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="lead-picker-results">{filteredLeads.map((lead) => <button type="button" className={selectedLeadId === lead.id ? 'selected' : ''} aria-pressed={selectedLeadId === lead.id} key={lead.id} onClick={() => setSelectedLeadId(lead.id)}><span className={`lead-avatar avatar-${lead.tone}`}>{lead.initials}</span><span><strong>{lead.name}</strong><small>{lead.region} · {lead.budget}</small></span><em>{lead.temperature}</em></button>)}{!filteredLeads.length && <p className="picker-empty">Nenhum cliente encontrado nesta categoria.</p>}</div></div><label>Mensagem<textarea name="message" defaultValue={defaultMessage} rows={7} required /></label><p className="share-channel-note"><span>Conversa do ImobFlow</span> O envio externo pelo WhatsApp será ativado quando a API estiver conectada.</p><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={!selectedLeadId}>Enviar para conversa</button></div></form></div>;
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
  const brokerSales = performance?.sales.filter((sale) => sale.dealType !== 'Aluguel' && sale.broker === broker?.broker) || [];
  const rank = performance && broker ? performance.brokers.findIndex((item) => item.broker === broker.broker) + 1 : 0;
  const averageTicket = broker?.salesCount ? broker.sold / broker.salesCount : 0;
  const teamShare = performance?.totalSold && broker ? (broker.sold / performance.totalSold) * 100 : 0;
  const remaining = broker ? Math.max(0, broker.goal - broker.sold) : 0;
  const historyMax = Math.max(...(broker?.history.map((item) => item.sold) || []), 1);
  const monthTitle = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const brokerAnimationKey = `${month}-${broker?.sold || 0}-${broker?.history.map((item) => `${item.month}:${item.sold}`).join('|') || ''}`;

  return <div className="modal-backdrop broker-profile-backdrop" role="presentation" onMouseDown={close}><article className="modal-card broker-profile-modal" onMouseDown={(event) => event.stopPropagation()}>
    <div className="broker-profile-header"><div className="broker-profile-person"><span>{brokerName.split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase()}</span><div><p>Meu desempenho</p><h2>{brokerName}</h2><small>{company}{performance?.dataMode === 'demo' ? ' • dados demonstrativos locais' : ''}</small></div></div><div className="broker-profile-actions"><label>Competência<input type="month" value={month} onChange={(event) => { setLoading(true); setError(null); setMonth(event.target.value); }} /></label><button type="button" aria-label="Fechar perfil" onClick={close}>×</button></div></div>
    {loading && !performance ? <div className="broker-profile-loading">Carregando desempenho mensal...</div> : error && !performance ? <div className="broker-profile-loading">{error}</div> : !broker ? <div className="broker-profile-loading">Este perfil ainda não possui metas associadas para {monthTitle}.</div> : <div className="broker-performance-reveal" key={brokerAnimationKey}>
      <section className="broker-goal-overview"><div><p>Meta individual de {monthTitle}</p><strong>{money.format(broker.sold)}</strong><span>de {money.format(broker.goal)}</span></div><div className="broker-goal-ring" style={{ '--broker-progress':'0deg', '--broker-progress-target':`${Math.min(100, broker.progress) * 3.6}deg` } as CSSProperties}><span><strong>{broker.progress.toFixed(0)}%</strong><small>alcançado</small></span></div><dl><div><dt>Falta para a meta</dt><dd>{money.format(remaining)}</dd></div><div><dt>Posição na equipe</dt><dd>{rank}º lugar</dd></div><div><dt>Participação no VGV</dt><dd>{teamShare.toFixed(1)}%</dd></div></dl></section>
      <section className="broker-stat-grid"><article><span>Negócios fechados</span><strong>{broker.salesCount}</strong><small>No mês selecionado</small></article><article><span>Ticket médio</span><strong>{compactMoney.format(averageTicket)}</strong><small>Por imóvel vendido</small></article><article><span>Leads recebidos</span><strong>{broker.leadsReceived}</strong><small>Carteira mensal</small></article><article><span>Leads convertidos</span><strong>{broker.convertedLeads}</strong><small>{broker.conversionRate.toFixed(1)}% de conversão</small></article><article><span>Leads recuperados</span><strong>{broker.recoveredLeads}</strong><small>Oportunidades retomadas</small></article><article><span>Visitas realizadas</span><strong>{broker.visits}</strong><small>Atendimentos presenciais</small></article></section>
      <section className="broker-profile-content"><article className="broker-month-chart"><div><p>Evolução individual</p><h3>Vendas por mês</h3></div>{broker.history.length > 0 ? <div className="broker-history-bars">{broker.history.map((item) => <div key={item.month}><span>{compactMoney.format(item.sold)}</span><i><b style={{ height:`${Math.max(10, (item.sold / historyMax) * 100)}%` }}/></i><small>{new Intl.DateTimeFormat('pt-BR', { month:'short', timeZone:'UTC' }).format(new Date(`${item.month}-01T12:00:00Z`)).replace('.','')}</small></div>)}</div> : <p className="broker-empty">Ainda não há histórico de vendas.</p>}</article><article className="broker-sales-list"><div><p>Fechamentos do mês</p><h3>Vendas recentes</h3></div>{brokerSales.length > 0 ? <ul>{brokerSales.map((sale) => <li key={sale.id}><span><strong>{sale.property}</strong><small>{sale.client} • {new Date(`${sale.date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone:'UTC' })}</small></span><b>{money.format(sale.amount)}</b></li>)}</ul> : <p className="broker-empty">Nenhuma venda registrada neste mês.</p>}</article></section>
    </div>}
  </article></div>;
}

function SettingsModal({ settings, close, save }: { settings:DashboardSettings; close:()=>void; save:(settings:DashboardSettings)=>void }) {
  const [draft, setDraft] = useState(settings);
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><form className="modal-card" onSubmit={(event) => { event.preventDefault(); save(draft); }} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Preferências</p><h2>Configurações</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><label className="setting-row"><span><strong>Modo escuro</strong><small>Reduz o brilho e aplica contraste adequado em todo o painel.</small></span><input type="checkbox" checked={draft.dark} onChange={(event) => setDraft((current) => ({ ...current, dark:event.target.checked }))}/></label><label className="setting-row"><span><strong>Alertas do painel</strong><small>Exibe avisos de leads e visitas.</small></span><input type="checkbox" checked={draft.alerts} onChange={(event) => setDraft((current) => ({ ...current, alerts:event.target.checked }))}/></label><label className="setting-row"><span><strong>Visualização compacta</strong><small>Prepara o painel para maior densidade.</small></span><input type="checkbox" checked={draft.compact} onChange={(event) => setDraft((current) => ({ ...current, compact:event.target.checked }))}/></label><div className="modal-actions"><button type="button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Salvar configurações</button></div></form></div>;
}

function Agenda({ items, setItems, notify, leads, properties, brokerName }: { items:AppointmentRecord[]; setItems:Dispatch<SetStateAction<AppointmentRecord[]>>; notify:(message:string)=>void; leads:DashboardLead[]; properties:Property[]; brokerName:string }) {
  const [week, setWeek] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<string | null>(null);
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + week * 7);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  const weekLabel = `${new Date(dates[0] + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} — ${new Date(dates[6] + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  function changeWeek(offset: number) {
    setWeek((current) => current + offset); setSelectedAppointment(null);
  }
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
      const response = await fetch('/api/appointments', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ date:activeDate, time:String(form.get('time')), name:String(form.get('name')), property:String(form.get('property')), broker:brokerName, status:'Aguardando', color:'amber' }) });
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
  return <div className="agenda-layout native-agenda">
    <section className="panel calendar-panel">
      <div className="calendar-head">
        <div><p className="eyebrow">Calendário de visitas</p><h2>{weekLabel}</h2></div>
        <nav className="calendar-navigation" aria-label="Navegação da agenda">
          <button type="button" onClick={() => { setWeek(0); setSelectedDay((new Date().getDay() + 6) % 7); setSelectedAppointment(null); }}>Hoje</button>
          <button type="button" aria-label="Semana anterior" onClick={() => changeWeek(-1)}>‹</button>
          <button type="button" aria-label="Próxima semana" onClick={() => changeWeek(1)}>›</button>
        </nav>
      </div>
      <div className="week-strip" aria-label="Dias da semana">
        {days.map((day,index) => <button type="button" className={index === selectedDay ? 'today' : ''} aria-pressed={index === selectedDay} aria-label={new Date(dates[index] + 'T12:00:00').toLocaleDateString('pt-BR', { dateStyle: 'full' })} onClick={() => { setSelectedDay(index); setSelectedAppointment(null); }} key={dates[index]}>
          <span>{day.split(' ')[0]}</span><strong>{day.split(' ')[1]}</strong>
          <small>{items.filter((item) => item.date === dates[index]).length || '—'}</small>
        </button>)}
      </div>
      <div className="agenda-day-heading"><h3>{new Date(activeDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><span>{visibleItems.length} {visibleItems.length === 1 ? 'visita' : 'visitas'}</span></div>
      <div className="timeline">
        {visibleItems.map((appointment) => <button type="button" aria-expanded={selectedAppointment === appointment.id} className={`appointment-row ${selectedAppointment === appointment.id ? 'selected' : ''}`} onClick={() => setSelectedAppointment(appointment.id)} key={appointment.id}>
          <time>{appointment.time}</time><i className={appointment.color}/><span><strong>{appointment.name}</strong><small>{appointment.property}</small><small>{appointment.broker}</small></span><em>{appointment.status}</em><b aria-hidden="true">›</b>
        </button>)}
        {visibleItems.length === 0 && <div className="agenda-empty"><span aria-hidden="true">＋</span><h3>Seu dia está livre</h3><p>Nenhuma visita agendada para esta data.</p><button type="button" className="profile-action" onClick={() => setFormOpen(true)}>Agendar uma visita</button></div>}
      </div>
      {activeAppointment && <div className="appointment-detail"><div><strong>{activeAppointment.name}</strong><span>{activeAppointment.time} • {activeAppointment.property}</span></div><div className="appointment-detail-actions"><button type="button" onClick={() => setSelectedAppointment(null)}>Fechar</button><button type="button" className="cancel-visit" onClick={() => removeAppointment(activeAppointment)}>Cancelar visita</button>{activeAppointment.status !== 'Confirmada' && <button type="button" className="confirm-visit" onClick={() => confirmAppointment(activeAppointment)}>Confirmar visita</button>}</div></div>}
    </section>
    <aside className="panel day-summary"><p className="eyebrow">Resumo do dia</p><h2>{new Date(activeDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}</h2>
      <div className="summary-number"><strong>{visibleItems.length}</strong><span>visitas agendadas</span></div>
      <ul><li><span><i className="mint"/>Confirmadas</span><strong>{visibleItems.filter((item) => item.status === 'Confirmada').length}</strong></li><li><span><i className="amber"/>Aguardando</span><strong>{visibleItems.filter((item) => item.status === 'Aguardando').length}</strong></li><li><span><i className="blue"/>Corretores</span><strong>{brokerCount}</strong></li></ul>
      <button type="button" className="primary-button" aria-expanded={formOpen} onClick={() => setFormOpen((open) => !open)}>＋ Novo horário</button>
      {formOpen && <form className="inline-form" onSubmit={addAppointment}><h3>Nova visita</h3><span>{new Date(activeDate + 'T12:00:00').toLocaleDateString('pt-BR')}</span><label>Horário<input name="time" type="time" required/></label><label>Cliente<select name="name" required defaultValue=""><option value="" disabled>Selecione um lead</option>{leads.map((lead) => <option key={lead.id} value={lead.name}>{lead.name}</option>)}</select></label><label>Imóvel<select name="property" required defaultValue=""><option value="" disabled>Selecione um imóvel</option>{properties.map((property) => <option key={property.id} value={property.title}>{property.title}</option>)}</select></label><div><button type="button" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit">Adicionar</button></div></form>}
    </aside>
  </div>;
}
