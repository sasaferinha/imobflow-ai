'use client';
import { dashboardFetch as fetch } from '@/lib/dashboard-transport';
/* eslint-disable @next/next/no-img-element -- property previews use uploaded data URLs */

import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type FormEvent, type ComponentProps } from 'react';
import type { LeadProfile } from '@/lib/leads';
import type { ConversationMessage, ConversationAttendanceSummary } from '@/lib/conversations';
import type { PropertyRecord } from '@/lib/operations';
import { demoContacts, demoConversationReducer, demoTemperature, type DemoContact, type DemoConversationAction, type DemoConversationState } from '@/lib/demo-conversations';
import { announceDashboardChange, subscribeDashboardSync } from '@/lib/dashboard-sync';
import type { SharedDemoThread } from '@/lib/shared-demo-conversations';
import { ConversationMessageBubble } from './conversation-message';
import { ConversationSettings } from './conversation-settings';
import { ConversationAttendanceBadge, ConversationAttendanceBanner, describeConversationAttendance } from './conversation-attendance';

const previewLeads: LeadProfile[] = demoContacts.map(contact => ({
  id: `example-${contact.id}`, name: contact.name, phone: 'Exemplo — sem telefone real', email: null,
  goal: contact.goal, propertyType: contact.propertyType, region: contact.region, budget: contact.budget,
  details: `${contact.rooms} quartos · ${contact.payment}`, summary: contact.suggestion, score: contact.score, scoreDefined: true,
  temperature: demoTemperature(contact.score), source: 'Demonstração', assignedTo: null,
  lifecycleStatus: 'Em atendimento', lastContactAt: null, inactivityDays: null,
  recoveryPotential: 'Baixo', scoreReasons: [], recoverySelected: false, createdAt: '2026-09-08T12:00:00Z',
}));

export default function ConversationCenter(props: ComponentProps<typeof ConversationWorkspace>) {
  const [preview, setPreview] = useState(false);
  const [demoReady, setDemoReady] = useState(false);
  const [demoSyncFailed, setDemoSyncFailed] = useState(false);
  const [previewState, previewDispatch] = useReducer(demoConversationReducer, undefined, () => ({
    selectedId: `lead-example-${demoContacts[0].id}`,
    threads: Object.fromEntries(demoContacts.map(contact => [`lead-example-${contact.id}`, {
      messages: contact.messages.map(message => ({ ...message })), draft: '', unread: contact.unread, humanMode: false,
    }])),
  }));
  useEffect(() => subscribeDashboardSync({
    entities: ['demo-conversations'],
    load: async signal => {
      const response = await fetch('/api/conversations/demo', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Falha ao sincronizar a demonstração.');
      return (await response.json() as { data: SharedDemoThread[] }).data;
    },
    apply: contacts => { previewDispatch({ type: 'hydrate', contacts }); setDemoReady(true); setDemoSyncFailed(false); },
    onError: () => setDemoSyncFailed(true),
  }), []);
  async function saveDemoAction(input: { contactId: string; action: 'claim' | 'message'; content?: string; messageId?: string; propertyId?: string }) {
    const response = await fetch('/api/conversations/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json() as { data?: SharedDemoThread; error?: string };
    if (!response.ok || !result.data) throw new Error(result.error || 'Não foi possível salvar o atendimento.');
    previewDispatch({ type: 'hydrate', contacts: [result.data] });
    announceDashboardChange('demo-conversations');
    return result.data;
  }
  return <>
    <div className="conversation-tools">
    <div className="conversation-preview-toolbar" role="group" aria-label="Modo das conversas">
      <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Clientes cadastrados</button>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Ver demonstração</button>
      {preview && <span role="status">{demoSyncFailed ? 'Não foi possível atualizar a demonstração. Tentando reconectar…' : !demoReady ? 'Carregando atendimentos da empresa…' : 'Demonstração compartilhada com sua equipe. Nenhuma mensagem é enviada a clientes reais.'}</span>}
    </div>
    {!preview&&<ConversationSettings/>}
    </div>
    {preview ? <ConversationWorkspace {...props} demonstration ready={demoReady} state={previewState} dispatch={previewDispatch} leads={previewLeads}
      claimLead={async lead => { await saveDemoAction({ contactId: lead.id, action: 'claim' }); }}
      persistMessage={async input => {
        const messageId = crypto.randomUUID();
        const thread = await saveDemoAction({ contactId: input.leadId, action: 'message', content: input.content, messageId, propertyId: input.propertyId });
        const message = thread.messages.find(item => item.id === messageId)!;
        return { id: message.id, time: message.time };
      }}
      openAgenda={() => props.notify('Exemplo de agendamento: selecione um cliente cadastrado para marcar uma visita real.')}
    /> : <ConversationWorkspace {...props} />}
  </>;
}

type ConversationContact = DemoContact & { sourceLead?: LeadProfile };
const emptyThread: DemoConversationState['threads'][string] = { messages: [], draft: '', unread: 0, humanMode: false };
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'LD';
const liveTemperature = (temperature: string) => {
  const value = normalize(temperature);
  return value.includes('indefinido') ? 'Indefinido' : value.includes('frio') ? 'Frio' : value.includes('morno') ? 'Morno' : 'Quente';
};
const contactTemperature = (contact: ConversationContact) => liveTemperature(contact.sourceLead?.temperature || 'Frio');
const formatDate = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem registro';

function ConversationWorkspace({ state, dispatch, notify, openAgenda, persistMessage, refreshProperties, claimLead, currentBrokerName, currentBrokerId, isAdministrator = false, leads = [], properties = [], demonstration = false, ready = true }: {
  state: DemoConversationState; dispatch: Dispatch<DemoConversationAction>;
  notify: (message: string) => void; openAgenda: () => void;
  persistMessage: (input: { leadId: string; content: string; images?: string[]; propertyId?: string }) => Promise<{ id: string; time: string }>;
  refreshProperties: () => Promise<void>;
  claimLead: (lead: LeadProfile) => Promise<void>;
  currentBrokerId?:string;
  isAdministrator?: boolean;
  currentBrokerName: string;
  leads?: LeadProfile[]; properties?: PropertyRecord[];
  demonstration?: boolean;
  ready?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [sendNotice, setSendNotice] = useState('');
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [profileOpen, setProfileOpen] = useState(true);
  const profileToggleRef = useRef<HTMLButtonElement>(null);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const contacts = useMemo<ConversationContact[]>(() => {
    return leads.map((lead, index) => ({
      id: `lead-${lead.id}`, name: lead.name, initials: initials(lead.name), tone: index % 4,
      category: lead.lifecycleStatus || 'Lead da base', style: 'Atendimento da base',
      goal: lead.goal, propertyType: lead.propertyType, region: lead.region, budget: lead.budget,
      rooms: lead.details || 'Preferências registradas', payment: 'Consultar dados do lead', score: lead.score,
      stage: lead.lifecycleStatus, unread: 0, messages: [], sourceLead: lead,
      suggestion: `Olá, ${lead.name.split(' ')[0]}! Como posso ajudar na sua busca por um imóvel?`,
    }));
  }, [leads]);
  const contactIds = useMemo(() => contacts.map((contact) => ({ id: contact.id, unread: contact.unread })), [contacts]);
  useEffect(() => { dispatch({ type: 'sync', contacts: contactIds }); }, [contactIds, dispatch]);

  const selected = contacts.find((contact) => contact.id === state.selectedId) || contacts[0];
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const thread = selected ? state.threads[selected.id] || emptyThread : emptyThread;
  const lead = selected?.sourceLead;
  const [historyPage, setHistoryPage] = useState<{ leadId: string; cursor: string | null; ready: boolean }>({ leadId: '', cursor: null, ready: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const selectedLeadRef = useRef(lead?.id);
  useEffect(() => { selectedLeadRef.current = lead?.id; }, [lead?.id]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setSendNotice(''); });
    return () => { active = false; };
  }, [selected?.id]);
  const preserveScroll = useRef<number | null>(null);
  const newestSeen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (demonstration || !lead?.id) return;
    const id = lead.id;
    let active = true;
    newestSeen.current = undefined;
    queueMicrotask(() => {
      if (!active) return;
      setHistoryPage({ leadId: id, cursor: null, ready: false });
      setLoadingOlder(false);
    });
    const unsubscribe = subscribeDashboardSync({ entities: ['conversations'], interval: 10000,
      load: async signal => {
        const response = await fetch(`/api/conversations?leadId=${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o histórico.');
        return await response.json() as { data: ConversationMessage[]; attendance: ConversationAttendanceSummary[]; nextCursor?: string | null };
      },
      apply: result => {
        const messages = result.data.filter(message => message.leadId === id);
        const gap = Boolean(newestSeen.current && messages.length && !messages.some(message => message.id === newestSeen.current));
        newestSeen.current = messages.at(-1)?.id;
        dispatch({ type: 'hydrate', merge: true, contacts: [{ id: `lead-${id}`, messages, attendance: result.attendance?.find(item => item.leadId === id) || null }] });
        setHistoryPage(current => ({ leadId: id, cursor: !gap && current.leadId === id && current.ready ? current.cursor : result.nextCursor || null, ready: true }));
      },
      onError: () => setHistoryPage(current => ({ ...current, ready: false })),
    });
    return () => { active = false; unsubscribe(); };
  }, [lead?.id, demonstration, dispatch]);
  async function loadOlderMessages() {
    if (!lead || !historyPage.cursor || loadingOlder) return;
    const id = lead.id;
    setLoadingOlder(true);
    try {
      const response = await fetch(`/api/conversations?leadId=${encodeURIComponent(id)}&before=${encodeURIComponent(historyPage.cursor)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar mensagens anteriores.');
      const result = await response.json() as { data: ConversationMessage[]; nextCursor: string | null };
      if (selectedLeadRef.current !== id) return;
      if (bodyRef.current) preserveScroll.current = bodyRef.current.scrollHeight - bodyRef.current.scrollTop;
      dispatch({ type: 'hydrate', merge: true, contacts: [{ id: `lead-${id}`, messages: result.data.filter(message => message.leadId === id) }] });
      setHistoryPage(current => ({ ...current, cursor: result.nextCursor }));
    } catch { if (selectedLeadRef.current === id) notify('Não foi possível carregar mensagens anteriores. Tente novamente.'); }
    finally { if (selectedLeadRef.current === id) setLoadingOlder(false); }
  }
  useEffect(() => {
    if (!bodyRef.current) return;
    bodyRef.current.scrollTop = preserveScroll.current === null ? bodyRef.current.scrollHeight : bodyRef.current.scrollHeight - preserveScroll.current;
    preserveScroll.current = null;
  }, [selected?.id, thread.messages.length]);
  ready = ready && (!lead || demonstration || historyPage.leadId === lead.id && historyPage.ready);
  if(!ready&&!selected)return <section className="panel empty-live-data" role="status"><h2>Sincronizando conversas</h2><p>Aguarde a confirmação do carregamento. Em caso de falha, os controles permanecerão desabilitados.</p></section>;
  if (!selected || !lead) return <div className="conversation-demo conversation-clean"><section className="panel empty-live-data"><h2>Nenhuma conversa disponível</h2><p>As conversas aparecerão aqui quando houver clientes cadastrados no banco de dados.</p></section></div>;
  const leadId = lead.id;
  const filtered = contacts.filter((contact) => {
    const current = state.threads[contact.id] || emptyThread;
    return (!onlyUnread || current.unread > 0) && normalize(`${contact.name} ${contact.style} ${contact.region}`).includes(normalize(search));
  });
  const stage = lead?.lifecycleStatus || selected.stage;
  const temperature = contactTemperature(selected);
  const ownership = thread.attendance ?? thread.messages.find(message => message.attendanceMode);
  const attendance = describeConversationAttendance({
    snapshot: { ...ownership, assignedTo: thread.attendance ? thread.attendance.assignedTo : lead.assignedTo },
    currentBrokerId, isAdministrator, lifecycleStatus: lead.lifecycleStatus, hasMessages: thread.messages.length > 0,
  });
  const assignedBroker = (demonstration ? thread.assignedTo : attendance.owner)?.trim() || null;
  const isCurrentBroker = demonstration ? Boolean(assignedBroker && normalize(assignedBroker) === normalize(currentBrokerName)) : attendance.isCurrentBroker;
  const canClaim = demonstration ? !isCurrentBroker : attendance.canClaim;
  const canSend = demonstration || attendance.canSend;
  const sourceLabel = demonstration ? 'Perfil fictício para demonstração' : 'Dados do banco de leads';
  // This exact legacy registration note is metadata, not a housing preference.
  // Mixed or unfamiliar text stays visible; never change the stored lead data.
  const registrationNote = normalize(lead.details || '').replace(/\s+/g, ' ').replace(/[.!]+$/, '')
    === normalize('Lead criado automaticamente a partir de uma mensagem recebida no WhatsApp');
  const leadHighlights = lead
    ? [['Objetivo', lead.goal], ['Tipo de imóvel', lead.propertyType], ['Região / bairro', lead.region], ['Investimento', lead.budget], ...(lead.details && !registrationNote ? [['Preferências', lead.details]] : [])]
    : [['Objetivo', selected.goal], ['Tipo de imóvel', selected.propertyType], ['Região desejada', selected.region], ['Investimento', selected.budget]];
  const leadOperationalData = lead
    ? [['Último contato', formatDate(lead.lastContactAt)], ['Telefone', lead.phone ? `•••• ${lead.phone.slice(-4)}` : 'Não informado'], ...(lead.email ? [['E-mail', lead.email]] : []), ...(registrationNote ? [['Registro', lead.details!]] : [])]
    : [['Quartos', selected.rooms], ['Pagamento', selected.payment], ['Estilo de atendimento', selected.style]];

  async function submitDraft() {
    if (!lead || !thread.draft.trim() || !ready || !canSend || savingRef.current) return;
    const content = thread.draft.trim();
    setSendNotice('');
    savingRef.current = true; setSaving(true);
    try {
      const saved = await persistMessage({ leadId, content });
      dispatch({ type: 'send', id: selected.id, messageId: saved.id, time: saved.time, text: content });
      notify(demonstration ? 'Mensagem adicionada à prévia. Nenhum cliente foi contatado.' : 'Mensagem salva no histórico do lead.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível salvar a mensagem.';
      setSendNotice(message);
      notify(message);
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    await submitDraft();
  }
  async function shareProperty(property: PropertyRecord) {
    if (!lead || !ready || !canSend || savingRef.current) return;
    savingRef.current = true; setSaving(true);
    const text = `Separei uma opção que combina com o seu perfil:\n\n${property.purpose} · ${property.propertyType || 'Imóvel'}\n${property.district}${property.city ? `, ${property.city}` : ''}\n${property.meta}\n${property.price}${property.publicUrl ? `\n\nVeja os detalhes: ${property.publicUrl}` : ''}`;
    try {
      const saved = await persistMessage({ leadId, content: text, images: property.images, propertyId: property.id });
      dispatch({ type: 'share-property', id: selected.id, messageId: saved.id, time: saved.time, text, images: demonstration?property.images:[], propertyTitle: property.title });
      setPropertyPickerOpen(false);
      notify(demonstration ? `${property.title} adicionado apenas à demonstração.` : `${property.title} salvo na conversa com ${selected.name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar o imóvel na conversa.');
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  async function openPropertyPicker() {
    setLoadingProperties(true);
    try {
      await refreshProperties();
      setPropertyPickerOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível atualizar a lista de imóveis.');
    } finally {
      setLoadingProperties(false);
    }
  }
  async function claimConversation() {
    if (!lead || !canClaim || !ready || savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      await claimLead(lead);
      notify(`${selected.name} agora está no seu atendimento.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível assumir este atendimento.');
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }
  async function releaseConversation(){
    if(demonstration || !attendance.canRelease || !ready || savingRef.current)return;
    savingRef.current = true; setSaving(true);
    try{const response=await fetch('/api/conversations/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId,release:true})});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error || 'Não foi possível devolver o atendimento.');announceDashboardChange('conversations');notify('Atendimento automático retomado para as próximas mensagens.');}
    catch(e){notify(e instanceof Error?e.message:'Não foi possível devolver o atendimento.');}finally{savingRef.current = false; setSaving(false);}
  }
  return <div className="conversation-demo conversation-clean">
    {!ready&&<p role="status">A sincronização está indisponível. Aguarde a atualização antes de enviar.</p>}
    <div className={`inbox-layout${profileOpen ? ' has-profile' : ''}`}>
      <aside className="inbox-list panel" aria-label="Conversas">
        <div className="inbox-search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar conversa" placeholder="Buscar cliente, perfil ou região" /></div>
        <div className="inbox-tabs"><button type="button" aria-pressed={!onlyUnread} className={!onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(false)}>Todas</button><button type="button" aria-pressed={onlyUnread} className={onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(true)}>Não lidas</button></div>
        {filtered.map((contact) => {
          const current = state.threads[contact.id] || emptyThread;
          const last = current.messages[current.messages.length - 1];
          const currentOwnership = current.attendance ?? current.messages.find(message => message.attendanceMode);
          const currentAttendance = describeConversationAttendance({
            snapshot: { ...currentOwnership, assignedTo: current.attendance ? current.attendance.assignedTo : contact.sourceLead?.assignedTo },
            currentBrokerId, isAdministrator, lifecycleStatus: contact.sourceLead?.lifecycleStatus, hasMessages: current.messages.length > 0,
          });
          const contactBroker = (demonstration ? current.assignedTo : currentAttendance.owner)?.trim();
          return <button type="button" className={`contact-row ${selected.id === contact.id ? 'selected' : ''}`} aria-pressed={selected.id === contact.id} onClick={() => dispatch({ type: 'select', id: contact.id })} key={contact.id}>
            <span className={`lead-avatar avatar-${contact.tone}`}>{contact.initials}</span>
            <span><strong>{contact.name}</strong><small>{last?.text || 'Ainda sem mensagens'}</small><small className="conversation-contact-broker" title={contactBroker ? `Corretor responsável: ${contactBroker}` : 'Sem corretor responsável'}>{contactBroker ? `Corretor: ${contactBroker}` : 'Sem corretor responsável'}</small>{!demonstration && <ConversationAttendanceBadge attendance={currentAttendance}/>}</span>
            <time>{last?.time || ''}</time>{current.unread > 0 && <b aria-label={`${current.unread} mensagens não lidas`}>{current.unread}</b>}
          </button>;
        })}
        {!filtered.length && <p className="empty-filter">Nenhuma conversa encontrada. Ajuste a busca ou selecione “Todas”.</p>}
      </aside>
      <section className="full-chat panel" aria-label={`Conversa com ${selected.name}`}>
        <div className="full-chat-head">
          <span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span>
          <div className="conversation-contact-heading"><strong>{selected.name}</strong><span className="conversation-owner-line">{assignedBroker ? `Corretor responsável: ${assignedBroker}${isCurrentBroker ? ' (você)' : ''}` : 'Sem corretor responsável'}</span></div>
          <div className="conversation-head-actions">
            {canClaim && <button type="button" className="conversation-claim-button" disabled={!ready || saving} onClick={() => void claimConversation()}>Assumir atendimento</button>}
            <button ref={profileToggleRef} type="button" aria-expanded={profileOpen} aria-controls="conversation-client-profile" onClick={() => setProfileOpen(open => !open)}>Ficha do cliente</button>
          </div>
        </div>
        {!demonstration && <ConversationAttendanceBanner attendance={attendance} ready={ready} saving={saving} release={() => void releaseConversation()}/>}
        <div className="full-chat-body" ref={bodyRef}>{!demonstration && historyPage.leadId === leadId && historyPage.cursor && <button type="button" className="conversation-property-button" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}{thread.messages.length ? thread.messages.map(message => <ConversationMessageBubble key={message.id} message={message} demo={demonstration}/>) : <p className="conversation-empty-thread">{ready ? 'Ainda não há mensagens deste lead no painel.' : 'Carregando histórico…'}</p>}</div>
        <details className="conversation-quick-reply" key={selected.id}><summary>Resposta sugerida</summary><div><p>{selected.suggestion}</p><button type="button" onClick={() => { dispatch({ type: 'draft', id: selected.id, text: selected.suggestion }); composerRef.current?.focus(); }}>Usar resposta</button></div></details>
        {sendNotice && <p className="conversation-send-notice" role="alert">{sendNotice}</p>}
        <form className="full-composer" onSubmit={send}><button type="button" className="conversation-property-button" disabled={loadingProperties || !ready || saving || !canSend} onClick={() => void openPropertyPicker()}>{loadingProperties ? 'Atualizando…' : 'Imóvel'}</button><input ref={composerRef} value={thread.draft} onChange={(event) => { setSendNotice(''); dispatch({ type: 'draft', id: selected.id, text: event.target.value }); }} aria-label={`Mensagem para ${selected.name}`} placeholder={canSend ? 'Escreva uma resposta…' : attendance.mode === 'closed' ? 'Conversa encerrada' : canClaim ? 'Assuma o atendimento para enviar' : 'Envio disponível ao corretor responsável'} maxLength={4000}/><button className="send-button" type="button" onClick={() => void submitDraft()} disabled={!thread.draft.trim() || !ready || saving || !canSend} aria-label="Adicionar mensagem"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12 7-7 7 7M12 5v14"/></svg></button></form>
      </section>
      <aside id="conversation-client-profile" hidden={!profileOpen} className="lead-profile panel" aria-label={`Ficha comercial de ${selected.name}`}>
        <div className="conversation-profile-title"><h2>Ficha do cliente</h2><button type="button" aria-label="Fechar ficha do cliente" onClick={() => { setProfileOpen(false); profileToggleRef.current?.focus(); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
        <div className="conversation-priority-line"><span>Score do lead</span><strong data-defined={Boolean(lead.scoreDefined)} aria-label={lead.scoreDefined ? `${lead.score}/100` : 'Indefinido'}>{lead.scoreDefined ? <>{lead.score}<small>/100</small></> : 'Indefinido'}</strong></div>
        <dl className="conversation-lead-highlights" aria-label="Critérios de busca do lead">{leadHighlights.map(([label, value]) => <div className={label === 'Preferências' ? 'profile-preferences' : undefined} key={label}><dt>{label}</dt><dd>{value || 'Não informado'}</dd></div>)}</dl>
        <details className="conversation-lead-details conversation-extra-details" key={selected.id}><summary>Mais dados do cliente<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></summary>
          <span className="conversation-data-source">{sourceLabel}{lead?.source ? ` · ${lead.source}` : ''}</span>
          <div className="conversation-classifications" aria-label="Classificação do cliente"><span className="conversation-stage conversation-badge" aria-label={`Etapa: ${stage}`}>{stage}</span><span className="conversation-temperature" data-temperature={temperature}>{temperature}</span></div>
          <dl>{leadOperationalData.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </details>
        <button type="button" className="profile-action" onClick={openAgenda}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/></svg>Agendar visita</button>
      </aside>
    </div>
    {propertyPickerOpen && <ConversationPropertyPicker properties={properties} customerName={selected.name} close={() => setPropertyPickerOpen(false)} select={shareProperty} />}
  </div>;
}

function ConversationPropertyPicker({ properties, customerName, close, select }: { properties:PropertyRecord[]; customerName:string; close:()=>void; select:(property:PropertyRecord)=>void }) {
  const [search, setSearch] = useState('');
  const [purpose, setPurpose] = useState<'Todos' | 'Venda' | 'Aluguel'>('Todos');
  const shareable = properties.filter((property) => property.status !== 'Vendido' && property.status !== 'Alugado' && (purpose === 'Todos' || property.purpose === purpose) && normalize(`${property.title} ${property.code || ''} ${property.district} ${property.city || ''} ${property.propertyType || ''}`).includes(normalize(search)));
  return <div className="modal-backdrop" role="presentation" onMouseDown={close}><section className="modal-card conversation-property-picker" role="dialog" aria-modal="true" aria-label={`Enviar imóvel para ${customerName}`} onMouseDown={(event) => event.stopPropagation()}><div className="modal-head"><div><p className="eyebrow">Conversa com {customerName}</p><h2>Selecionar imóvel</h2></div><button type="button" aria-label="Fechar" onClick={close}>×</button></div><div className="picker-search">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por nome, código, bairro ou cidade" autoFocus /></div><div className="picker-categories" role="group" aria-label="Filtrar por finalidade">{(['Todos', 'Venda', 'Aluguel'] as const).map((item) => <button type="button" key={item} aria-pressed={purpose === item} onClick={() => setPurpose(item)}>{item}</button>)}</div><div className="conversation-property-results">{shareable.map((property) => <button type="button" key={property.id} onClick={() => select(property)}><span className="picker-property-image">{property.images[0] ? <img src={property.images[0]} alt="" /> : '▦'}</span><span><strong>{property.title}</strong><small>{property.code ? `${property.code} · ` : ''}{property.district}{property.city ? `, ${property.city}` : ''}{property.status === 'Reservado' ? ' · Reservado' : ''}</small><em>{property.meta}</em></span><b>{property.price}</b></button>)}{!shareable.length && <p className="picker-empty">Nenhum imóvel disponível ou reservado encontrado com esses filtros.</p>}</div><p className="share-channel-note"><span>Fotos e informações incluídas.</span> Imóveis reservados aparecem identificados; vendidos e alugados não podem ser enviados.</p></section></div>;
}
