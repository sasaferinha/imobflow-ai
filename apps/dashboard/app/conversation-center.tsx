'use client';
/* eslint-disable @next/next/no-img-element -- property previews use uploaded data URLs */

import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type FormEvent, type ComponentProps } from 'react';
import type { LeadProfile } from '@/lib/leads';
import type { PropertyRecord } from '@/lib/operations';
import { demoContacts, demoConversationReducer, demoTemperature, type DemoContact, type DemoConversationAction, type DemoConversationState } from '@/lib/demo-conversations';

const previewLeads: LeadProfile[] = demoContacts.map(contact => ({
  id: `example-${contact.id}`, name: contact.name, phone: 'Exemplo — sem telefone real', email: null,
  goal: contact.goal, propertyType: contact.propertyType, region: contact.region, budget: contact.budget,
  details: `${contact.rooms} quartos · ${contact.payment}`, summary: contact.suggestion, score: contact.score,
  temperature: demoTemperature(contact.score), source: 'Demonstração', assignedTo: null,
  lifecycleStatus: 'Em atendimento', lastContactAt: null, inactivityDays: null,
  recoveryPotential: 'Baixo', scoreReasons: [], recoverySelected: false, createdAt: '2026-09-08T12:00:00Z',
}));

export default function ConversationCenter(props: ComponentProps<typeof ConversationWorkspace>) {
  const [preview, setPreview] = useState(!(props.leads?.length));
  const [previewState, previewDispatch] = useReducer(demoConversationReducer, undefined, () => ({
    selectedId: `lead-example-${demoContacts[0].id}`,
    threads: Object.fromEntries(demoContacts.map(contact => [`lead-example-${contact.id}`, {
      messages: contact.messages.map(message => ({ ...message })), draft: '', unread: contact.unread, humanMode: false,
    }])),
  }));
  return <>
    <div className="conversation-preview-toolbar" role="group" aria-label="Modo das conversas">
      <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Clientes cadastrados</button>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Ver demonstração</button>
      {preview && <span>Contatos fictícios. As mensagens de teste ficam apenas nesta prévia.</span>}
    </div>
    {preview ? <ConversationWorkspace {...props} demonstration state={previewState} dispatch={previewDispatch} leads={previewLeads}
      persistMessage={async () => ({ id: crypto.randomUUID(), time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) })}
      openAgenda={() => props.notify('Exemplo de agendamento: selecione um cliente cadastrado para marcar uma visita real.')}
    /> : <ConversationWorkspace {...props} />}
  </>;
}

type ConversationContact = DemoContact & { sourceLead?: LeadProfile };
const emptyThread = { messages: [], draft: '', unread: 0, humanMode: false };
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'LD';
const liveTemperature = (temperature: string) => {
  const value = normalize(temperature);
  return value.includes('frio') ? 'Frio' : value.includes('morno') ? 'Morno' : 'Quente';
};
const contactTemperature = (contact: ConversationContact) => liveTemperature(contact.sourceLead?.temperature || 'Frio');
const formatDate = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem registro';

function ConversationWorkspace({ state, dispatch, notify, openAgenda, persistMessage, refreshProperties, claimLead, currentBrokerName, leads = [], properties = [], demonstration = false }: {
  state: DemoConversationState; dispatch: Dispatch<DemoConversationAction>;
  notify: (message: string) => void; openAgenda: () => void;
  persistMessage: (input: { leadId: string; content: string; images?: string[]; propertyId?: string }) => Promise<{ id: string; time: string }>;
  refreshProperties: () => Promise<void>;
  claimLead: (lead: LeadProfile) => Promise<void>;
  currentBrokerName: string;
  leads?: LeadProfile[]; properties?: PropertyRecord[];
  demonstration?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const contacts = useMemo<ConversationContact[]>(() => {
    return leads.map((lead, index) => ({
      id: `lead-${lead.id}`, name: lead.name, initials: initials(lead.name), tone: index % 4,
      category: lead.lifecycleStatus || 'Lead da base', style: 'Atendimento da base',
      goal: lead.goal, propertyType: lead.propertyType, region: lead.region, budget: lead.budget,
      rooms: lead.details || 'Preferências registradas', payment: 'Consultar dados do lead', score: lead.score,
      stage: lead.lifecycleStatus, unread: 0, messages: [], sourceLead: lead,
      suggestion: `Olá, ${lead.name.split(' ')[0]}! Vi seu interesse em ${lead.goal.toLowerCase()}. Posso ajudar com opções na região ${lead.region}?`,
    }));
  }, [leads]);
  const contactIds = useMemo(() => contacts.map((contact) => ({ id: contact.id, unread: contact.unread })), [contacts]);
  useEffect(() => { dispatch({ type: 'sync', contacts: contactIds }); }, [contactIds, dispatch]);

  const selected = contacts.find((contact) => contact.id === state.selectedId) || contacts[0];
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const thread = selected ? state.threads[selected.id] || emptyThread : emptyThread;
  const lead = selected?.sourceLead;
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [selected?.id, thread.messages.length]);
  if (!selected || !lead) return <div className="conversation-demo"><section className="conversation-temperature-guide" aria-label="Como interpretar a temperatura dos leads"><div><strong>Temperatura do lead</strong><span>Use o nível de interesse para priorizar os atendimentos.</span></div><dl><div><dt className="conversation-temperature" data-temperature="Frio">Frio</dt><dd>Contato inicial ou com poucas informações.</dd></div><div><dt className="conversation-temperature" data-temperature="Morno">Morno</dt><dd>Tem interesse, mas ainda está avaliando opções.</dd></div><div><dt className="conversation-temperature" data-temperature="Quente">Quente</dt><dd>Perfil completo e pronto para avançar.</dd></div></dl></section><section className="panel empty-live-data"><h2>Nenhuma conversa disponível</h2><p>As conversas aparecerão aqui quando houver clientes cadastrados no banco de dados.</p></section></div>;
  const leadId = lead.id;
  const filtered = contacts.filter((contact) => {
    const current = state.threads[contact.id] || emptyThread;
    return (!onlyUnread || current.unread > 0) && normalize(`${contact.name} ${contact.style} ${contact.region}`).includes(normalize(search));
  });
  const stage = lead?.lifecycleStatus || selected.stage;
  const temperature = contactTemperature(selected);
  const assignedBroker = lead.assignedTo?.trim() || null;
  const isCurrentBroker = Boolean(assignedBroker && normalize(assignedBroker) === normalize(currentBrokerName));
  const sourceLabel = demonstration ? 'Perfil fictício para demonstração' : 'Dados do banco de leads';
  const leadHighlights = lead
    ? [['Objetivo', lead.goal], ['Tipo de imóvel', lead.propertyType], ['Região desejada', lead.region], ['Investimento', lead.budget]]
    : [['Objetivo', selected.goal], ['Tipo de imóvel', selected.propertyType], ['Região desejada', selected.region], ['Investimento', selected.budget]];
  const leadOperationalData = lead
    ? [['Preferências', lead.details || 'Não informado'], ['Corretor responsável', lead.assignedTo || 'Sem corretor responsável'], ['Último contato', formatDate(lead.lastContactAt)], ['Telefone', lead.phone], ...(lead.email ? [['E-mail', lead.email]] : [])]
    : [['Quartos', selected.rooms], ['Pagamento', selected.payment], ['Estilo de atendimento', selected.style]];

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!thread.draft.trim()) return;
    try {
      const saved = await persistMessage({ leadId, content: thread.draft.trim() });
      dispatch({ type: 'send', id: selected.id, messageId: saved.id, time: saved.time });
      notify(demonstration ? 'Mensagem adicionada à prévia. Nenhum cliente foi contatado.' : 'Mensagem salva no histórico do lead.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar a mensagem.');
    }
  }
  async function shareProperty(property: PropertyRecord) {
    const text = `Separei uma opção que combina com o seu perfil:\n\n${property.purpose} · ${property.propertyType || 'Imóvel'}\n${property.district}${property.city ? `, ${property.city}` : ''}\n${property.meta}\n${property.price}${property.publicUrl ? `\n\nVeja os detalhes: ${property.publicUrl}` : ''}`;
    try {
      const saved = await persistMessage({ leadId, content: text, images: property.images, propertyId: property.id });
      dispatch({ type: 'share-property', id: selected.id, messageId: saved.id, time: saved.time, text, images: property.images, propertyTitle: property.title });
      setPropertyPickerOpen(false);
      notify(demonstration ? `${property.title} adicionado apenas à demonstração.` : `${property.title} salvo na conversa com ${selected.name}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível salvar o imóvel na conversa.');
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
    if (demonstration || isCurrentBroker) return;
    try {
      await claimLead(lead);
      notify(`${selected.name} agora está no seu atendimento.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível assumir este atendimento.');
    }
  }
  return <div className="conversation-demo">
    <section className="conversation-temperature-guide" aria-label="Como interpretar a temperatura dos leads">
      <div><strong>Temperatura do lead</strong><span>Use o nível de interesse para priorizar os atendimentos.</span></div>
      <dl>
        <div><dt className="conversation-temperature" data-temperature="Frio">Frio</dt><dd>Contato inicial ou com poucas informações.</dd></div>
        <div><dt className="conversation-temperature" data-temperature="Morno">Morno</dt><dd>Tem interesse, mas ainda está avaliando opções.</dd></div>
        <div><dt className="conversation-temperature" data-temperature="Quente">Quente</dt><dd>Perfil completo e pronto para avançar.</dd></div>
      </dl>
    </section>
    <div className="inbox-layout">
      <aside className="inbox-list panel" aria-label="Conversas">
        <div className="inbox-search">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Buscar conversa" placeholder="Buscar cliente, perfil ou região" /></div>
        <div className="inbox-tabs"><button type="button" aria-pressed={!onlyUnread} className={!onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(false)}>Todas</button><button type="button" aria-pressed={onlyUnread} className={onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(true)}>Não lidas</button></div>
        {filtered.map((contact) => {
          const current = state.threads[contact.id] || emptyThread;
          const last = current.messages[current.messages.length - 1];
          const contactHeat = contactTemperature(contact);
          return <button type="button" className={`contact-row ${selected.id === contact.id ? 'selected' : ''}`} aria-pressed={selected.id === contact.id} onClick={() => dispatch({ type: 'select', id: contact.id })} key={contact.id}>
            <span className={`lead-avatar avatar-${contact.tone}`}>{contact.initials}</span>
            <span><span className="conversation-name-line"><strong>{contact.name}</strong><span className="conversation-temperature" data-temperature={contactHeat}>{contactHeat}</span></span><small className="conversation-owner-line">{contact.sourceLead?.assignedTo ? `Atendimento: ${contact.sourceLead.assignedTo}` : 'Sem corretor responsável'}</small><small>{last?.text || 'Dados cadastrados; ainda sem mensagens neste painel.'}</small></span>
            <time>{last?.time || 'Base'}</time>{current.unread > 0 && <b aria-label={`${current.unread} mensagens não lidas`}>{current.unread}</b>}
          </button>;
        })}
        {!filtered.length && <p className="empty-filter">Nenhuma conversa encontrada. Ajuste a busca ou selecione “Todas”.</p>}
      </aside>
      <section className="full-chat panel" aria-label={`Conversa com ${selected.name}`}>
        <div className="full-chat-head"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><span className="conversation-name-line"><strong>{selected.name}</strong><span className="conversation-temperature" data-temperature={temperature}>{temperature}</span></span><span className="conversation-owner-line">{assignedBroker ? `Corretor responsável: ${assignedBroker}` : 'Sem corretor responsável'}</span></div>{!demonstration && !isCurrentBroker && <button type="button" className="conversation-claim-button" onClick={() => void claimConversation()}>Assumir atendimento</button>}{isCurrentBroker && <span className="conversation-assigned-state">Você está atendendo</span>}</div>
        <div className="full-chat-body" ref={bodyRef}><span className="chat-date">Conversa vinculada ao lead</span>{thread.messages.length ? thread.messages.map((message) => <div className={`bubble ${message.side} ${message.propertyTitle ? 'property-message' : ''}`} key={message.id}>{message.images?.length ? <div className="message-property-images">{message.images.slice(0,3).map((image,index) => <img key={index} src={image} alt={`${message.propertyTitle}, foto ${index + 1}`} />)}</div> : null}<span className="visually-hidden">{message.side === 'incoming' ? selected.name : 'Atendimento'}: </span>{message.propertyTitle && <strong>{message.propertyTitle}</strong>}<p>{message.text}</p><small>{message.time} · Painel</small></div>) : <p className="conversation-empty-thread">Ainda não há mensagens deste lead no painel. A ficha ao lado foi carregada da base para orientar o corretor.</p>}</div>
        <div className="conversation-suggestion"><span>Resposta sugerida · Dados do lead</span><p>{selected.suggestion}</p><button type="button" onClick={() => { dispatch({ type: 'draft', id: selected.id, text: selected.suggestion }); composerRef.current?.focus(); }}>Usar resposta</button></div>
        <form className="full-composer" onSubmit={send}><button type="button" aria-label="Anexos" disabled title="Anexos diretos serão habilitados com o canal de mensagens">＋</button><button type="button" className="conversation-property-button" disabled={loadingProperties} onClick={() => void openPropertyPicker()}>{loadingProperties ? 'Atualizando…' : '▦ Imóvel'}</button><input ref={composerRef} value={thread.draft} onChange={(event) => dispatch({ type: 'draft', id: selected.id, text: event.target.value })} aria-label={`Mensagem para ${selected.name}`} placeholder="Escreva uma resposta…" maxLength={4000}/><button className="send-button" type="submit" disabled={!thread.draft.trim()} aria-label="Adicionar mensagem">➜</button></form>
      </section>
      <aside className="lead-profile panel" aria-label={`Ficha comercial de ${selected.name}`}>
        <header className="conversation-lead-header"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><p>Ficha comercial</p><span className="conversation-name-line"><h3>{selected.name}</h3><span className="conversation-temperature" data-temperature={temperature}>{temperature}</span></span><span className="conversation-data-source">{sourceLabel}{lead?.source ? ` · ${lead.source}` : ''}</span></div></header>
        <div className="conversation-classifications" aria-label="Classificação do cliente"><span className="conversation-stage conversation-badge" aria-label={`Etapa: ${stage}`}>{stage}</span></div>
        <section className="conversation-priority-card" key={`${selected.id}-${lead?.score || selected.score}`} aria-label="Prioridade comercial">
          <div><span>Prioridade comercial</span><strong>{lead.score}<small>/100</small></strong></div><i aria-hidden="true"><b style={{ width: `${lead.score}%` }}/></i><p>Base de leads sincronizada para este atendimento.</p>
        </section>
        <section className="conversation-lead-highlights" aria-label="Critérios de busca do lead">{leadHighlights.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
        <section className="conversation-lead-details"><h4>Contexto do atendimento</h4><dl>{leadOperationalData.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
        <button type="button" className="profile-action" onClick={openAgenda}>Agendar visita</button><p className="conversation-profile-note">Consulte esta ficha antes de responder no canal conectado.</p>
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
