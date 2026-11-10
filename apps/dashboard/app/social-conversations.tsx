'use client';
/* eslint-disable @next/next/no-img-element -- images received from connected channels */
import { useEffect, useRef, useState } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import { announceDashboardChange, subscribeDashboardSync } from '@/lib/dashboard-sync';
import type { SocialContact, SocialMessage, SocialMode, SocialChannel } from '@/lib/social-model';
import { socialClaimBlockedMessage, socialObject } from '@/lib/social-model';
import type { PropertyRecord } from '@/lib/operations';
import { channelLabel } from '@/lib/lead-channel';
import { ChannelIcon } from './conversation-channels';
import ConversationAssistant from './conversation-assistant';
import ConversationRegistration from './conversation-registration';
import s from './social-conversations.module.css';

const time = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const money = (value: number | null | undefined) => value ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value) : 'Não informado';
type SocialDraftValues = { drafts: Record<string,string>; photos: Record<string,string[]> };
export type SocialDraftMemory = { read: () => SocialDraftValues; write: (drafts: SocialDraftValues['drafts'], photos: SocialDraftValues['photos']) => void; requests: Map<string,{content:string;images:string[];id:string}> };
export function createSocialDraftMemory(): SocialDraftMemory {
  let value: SocialDraftValues = { drafts: {}, photos: {} };
  return { read: () => value, write: (drafts, photos) => { value = { drafts, photos }; }, requests: new Map() };
}
function readContacts(body: unknown, channel: SocialChannel): SocialContact[] {
  const contacts = socialObject(socialObject(body).data).contacts;
  if (!Array.isArray(contacts) || contacts.some(item => !item || typeof item !== 'object' || item.channel !== channel || typeof item.id !== 'string' || typeof item.leadId !== 'string' || typeof item.name !== 'string' || !Array.isArray(item.messages) || !item.leadProfile)) throw new Error('A consulta do canal não pôde ser confirmada.');
  return contacts as SocialContact[];
}
const status = { received: 'Recebida', pending: 'Na fila', sending: 'Enviando', sent: 'Enviada', failed: 'Falhou', unknown: 'Envio sem confirmação' };

export default function SocialConversations({ channel, demonstration = false, initialLeadId, currentBrokerId, isAdministrator = false, properties = [], onBusyChange, notify, memory }: {
  channel: SocialChannel; demonstration?: boolean; initialLeadId?: string; currentBrokerId?: string; isAdministrator?: boolean;
  memory: SocialDraftMemory; properties?: PropertyRecord[]; onBusyChange: (busy: boolean) => void; notify: (text: string) => void;
}) {
  const demo = demonstration || isProductDemo(), label = channelLabel(channel);
  const [contacts, setContacts] = useState<SocialContact[] | null>(null), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(''), [search, setSearch] = useState(''), [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => memory.read().drafts), [profileOpen, setProfileOpen] = useState(false), [picker, setPicker] = useState(false);
  const [older, setOlder] = useState<Record<string, { messages: SocialMessage[]; cursor: string | null }>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string[]>>(() => memory.read().photos);
  const [checkedAt, setCheckedAt] = useState(0);
  const pending = useRef(memory.requests), lock = useRef(false);
  const appliedInitialLead = useRef<string | null>(null);
  const history = useRef<HTMLDivElement>(null), nearBottom = useRef(true), mounted = useRef(true);
  useEffect(() => { memory.write(drafts,photos); }, [memory,drafts,photos]);
  const selected = contacts?.find(contact => contact.id === selectedId) || contacts?.[0];
  useEffect(() => {
    if (busy || !initialLeadId || appliedInitialLead.current === initialLeadId) return;
    const contact = contacts?.find(item => item.leadId === initialLeadId);
    if (!contact) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { appliedInitialLead.current = initialLeadId; setSelectedId(contact.id); } });
    return () => { cancelled = true; };
  }, [contacts,initialLeadId,busy]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusyChange(false); }; }, [onBusyChange]);
  useEffect(() => {
    if (demo) return;
    return subscribeDashboardSync({ entities: ['social-conversations', 'leads'], interval: 5000,
      load: async signal => {
        const response = await dashboardFetch(`/api/integrations/meta/social/inbox?channel=${channel}`, { signal, cache: 'no-store' });
        const body = socialObject(await response.json());
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Não foi possível consultar este canal.');
        return readContacts(body,channel);
      }, apply: rows => { setContacts(rows); setCheckedAt(Date.now()); setError(''); }, onError: reason => { setContacts(null); setError(reason instanceof Error ? reason.message : 'Falha na consulta.'); } });
  }, [channel, demo]);
  useEffect(() => { if (nearBottom.current && history.current) history.current.scrollTop = history.current.scrollHeight; }, [selected?.id, selected?.messages.length]);
  const canEdit = Boolean(selected && (isAdministrator || selected.assignedBrokerId === currentBrokerId));
  const claimBlocked = socialClaimBlockedMessage(selected?.claimBlockedReason);
  const needsClaim = Boolean(selected && selected.assignedBrokerId !== currentBrokerId);
  const draft = selected ? drafts[selected.id] || '' : '';
  const images = selected ? photos[selected.id] || [] : [];
  function setDraft(text: string) { if (selected) setDrafts(previous => ({ ...previous, [selected.id]: text })); }
  function choose(id: string) { if (busy) return; setSelectedId(id); setPicker(false); setProfileOpen(false); nearBottom.current = true; setError(''); }
  async function perform(path: string, body: object) {
    const response = await dashboardFetch(`/api/integrations/meta/social/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = socialObject(await response.json());
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Não foi possível concluir no ${label}.`);
    return socialObject(data.data);
  }
  async function loadOlder() {
    if (!selected || loadingOlder) return;
    const id = selected.id, before = older[id]?.cursor ?? selected.nextCursor;
    if (!before || older[id]?.cursor === null) return;
    setLoadingOlder(true);
    try {
      const response = await dashboardFetch('/api/integrations/meta/social/inbox?' + new URLSearchParams({ channel, threadId: id, before }), { cache: 'no-store' });
      const body = socialObject(await response.json());
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Não foi possível carregar o histórico.');
      const contact = readContacts(body,channel).find(row => row.id === id && row.leadId === selected.leadId);
      if (!contact) throw new Error('Seu acesso à conversa mudou. Atualize a lista.');
      setOlder(previous => ({ ...previous, [id]: { cursor: contact.nextCursor, messages: [...contact.messages,...(previous[id]?.messages || [])].filter((row,index,all) => all.findIndex(item => item.id === row.id) === index) } }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao carregar histórico.'); }
    finally { setLoadingOlder(false); }
  }
  async function changeMode(mode: SocialMode) {
    if (!selected || lock.current || demo) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError('');
    try { await perform('handoff', { threadId: selected.id, mode }); announceDashboardChange('social-conversations'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao alterar atendimento.'); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  async function send() {
    if (!selected || !draft.trim() || lock.current || demo || !selected.canSend || !canEdit) return;
    const id = selected.id, content = draft.trim(), media = [...images];
    let request = pending.current.get(id);
    if (!request || request.content !== content || JSON.stringify(request.images) !== JSON.stringify(media)) {
      request = { content, images: media, id: crypto.randomUUID() }; pending.current.set(id, request);
    }
    lock.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await perform('messages', { threadId: id, content, images: media, requestId: request.id });
      if (result.threadId !== id || !Array.isArray(result.messages) || !result.messages.length || result.messages.some(message => !message || typeof message.id !== 'string' || message.direction !== 'outgoing' || !['sent','pending','sending','failed','unknown'].includes(message.status))) throw new Error('O envio ainda não pôde ser confirmado. O rascunho foi mantido.');
      const messages = result.messages as SocialMessage[];
      const uncertain = messages.some(message => message.status !== 'sent');
      if (uncertain) setError('O envio teve falha ou ainda aguarda confirmação. Confira o histórico antes de repetir.');
      else {
        setDrafts(previous => previous[id]?.trim() === content ? { ...previous, [id]: '' } : previous);
        setPhotos(previous => ({ ...previous, [id]: [] })); pending.current.delete(id);
      }
      nearBottom.current = true; announceDashboardChange('social-conversations'); announceDashboardChange('leads');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível confirmar o envio. O rascunho foi mantido.'); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  const filtered = (contacts || []).filter(contact => contact.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const available = properties.filter(property => property.status === 'Disponível' || property.status === 'Reservado');
  return <section id="conversation-channel-content" className={s.root} data-selected={Boolean(selectedId)} aria-label={`Conversas do ${label}`}>
    {demo ? <div className={s.empty}><ChannelIcon channel={channel}/><h2>{label}</h2><p>No ambiente real, conecte a conta da imobiliária para atender seus clientes por este canal. A demonstração não envia mensagens.</p></div>
      : !contacts?.length ? <div className={s.empty}><ChannelIcon channel={channel}/><h2>{contacts ? `Nenhuma conversa do ${label}` : error ? 'Canal indisponível' : 'Carregando conversas…'}</h2><p>{error || 'As novas mensagens da conta conectada aparecerão aqui. O administrador pode conferir a conexão em Integrações.'}</p>{isAdministrator && <a href="#integrations">Abrir Integrações</a>}</div>
      : <div className={s.grid}>
        <aside className={s.list}><h2>{label} · Caixa de entrada</h2><label className={s.search}><input aria-label={`Buscar contato no ${label}`} placeholder="Buscar cliente" value={search} onChange={event => setSearch(event.target.value)}/></label><div className={s.contacts}>{filtered.map(contact => <button type="button" disabled={busy} className={s.contact} aria-pressed={contact.id === selected?.id} key={contact.id} onClick={() => choose(contact.id)}><strong>{contact.name}</strong><span>{drafts[contact.id] ? `Rascunho: ${drafts[contact.id]}` : contact.messages.at(-1)?.text || 'Mensagem recebida'}</span><small>{contact.assignedTo || 'Aguardando responsável'}{contact.lastMessageAt ? ` · ${time(contact.lastMessageAt)}` : ''}</small>{contact.urgent && <small className={s.attention}>Aguardando resposta</small>}</button>)}</div></aside>
        <section className={s.thread}>{selected && <>
          <header className={s.head}><button className={`${s.button} ${s.back}`} disabled={busy} onClick={() => setSelectedId('')} type="button">Voltar</button><div><h3>{selected.name}</h3><p>{label} · {selected.assignedTo || 'Sem responsável'}</p></div><div className={s.actions}>
            <ConversationRegistration leadId={selected.leadId} customerName={selected.name} allowNewNegotiation disabled={busy || !canEdit} notify={notify} onSaved={() => announceDashboardChange('leads')}/>
            <ConversationAssistant leadId={selected.leadId} customerName={selected.name} disabled={busy || !canEdit} notify={notify} onUseReply={text => setDraft(`${draft}${draft ? '\n\n' : ''}${text}`.slice(0, 2000))} onSaved={() => announceDashboardChange('leads')}/>
            <button className={s.button} type="button" onClick={() => setProfileOpen(value => !value)} aria-expanded={profileOpen}>Ficha do cliente</button>
          </div></header>
          <div className={s.mode}><label>Atendimento <select aria-label={`Modo de atendimento no ${label}`} disabled={busy || !canEdit} value={selected.mode} onChange={event => void changeMode(event.target.value as SocialMode)}><option value="human">Corretor</option><option value="suggestions">Corretor com assistente</option>{isAdministrator && <option value="automatic">IA automática</option>}</select></label>{needsClaim && (isAdministrator || !selected.assignedBrokerId) ? <button type="button" className={s.button} disabled={busy || Boolean(claimBlocked)} onClick={() => void changeMode('human')}>Assumir atendimento</button> : !canEdit ? <span>Atendimento de outro corretor.</span> : null}{claimBlocked && needsClaim && <span>{claimBlocked}</span>}{selected.urgent && selected.waitingSince && <span className={s.attention} role="status">Aguardando resposta desde {time(selected.waitingSince)}</span>}</div>
          {profileOpen && <aside data-motion-menu="profile" className={s.profile} aria-label="Ficha do cliente"><dl>{Object.entries({ Origem: label, Objetivo: selected.leadProfile.goal, 'Tipo de imóvel': selected.leadProfile.propertyType, Região: selected.leadProfile.region, 'Orçamento máximo': money(selected.leadProfile.budgetMax) }).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value || 'Não informado'}</dd></div>)}</dl><a href="#opportunities">Ver imóveis compatíveis</a></aside>}
          <div className={s.history} ref={history} onScroll={event => { const el = event.currentTarget; nearBottom.current = el.scrollHeight-el.scrollTop-el.clientHeight < 100; }}>
            {(older[selected.id] ? older[selected.id].cursor : selected.nextCursor) && <button type="button" className={s.button} disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}
            {[...(older[selected.id]?.messages || []),...selected.messages].filter((row,index,all) => all.findIndex(item => item.id === row.id) === index).map(message => <article className={s.message} key={message.id} data-outgoing={message.direction === 'outgoing'}><p>{message.text}</p>{message.mediaUrls.map((url,index) => message.mediaType === 'audio' ? <audio key={url} controls preload="none" src={url}/> : message.mediaType === 'video' ? <video key={url} controls preload="none" src={url}/> : message.mediaType === 'image' ? <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Imagem ${index+1} da conversa`} loading="lazy"/></a> : <a key={url} href={url} target="_blank" rel="noreferrer">Abrir anexo</a>)}<small>{time(message.at)} · {status[message.status] || 'Recebida'}{message.source === 'ai' ? ' · IA' : ''}</small>{message.error && <p role="status">{message.error}</p>}</article>)}
          </div>
          {picker && <div className={s.picker}><strong>Escolha um imóvel do catálogo</strong><div>{available.map(property => <button className={s.button} type="button" key={property.id} onClick={() => { setDraft(`${property.title}\n${[property.district,property.city].filter(Boolean).join(', ')} · ${property.price}`); setPhotos(previous => ({ ...previous, [selected.id]: property.images.filter(url => url.startsWith('https://')).slice(0,5) })); setPicker(false); }}>{property.title}</button>)}</div>{!available.length && <p>Nenhum imóvel disponível no catálogo carregado.</p>}</div>}
          {error && <p role="alert" className={s.error}>{error}</p>}
          {!selected.canSend && <p className={s.hint}>{selected.connectionReady === false ? 'A conexão deste canal está incompleta ou desativada. O administrador pode reconectar em Integrações.' : !selected.windowEndsAt || Date.parse(selected.windowEndsAt) <= checkedAt ? 'Aguarde uma nova mensagem do cliente neste canal para reabrir a janela de resposta.' : needsClaim ? 'Assuma o atendimento para enviar por este canal.' : selected.mode === 'automatic' ? 'A IA está atendendo. Selecione Corretor para responder pessoalmente.' : 'Atualize a conversa para confirmar a disponibilidade de envio.'}</p>}
          {images.length > 0 && <p className={s.hint}>{images.length} foto(s) do imóvel selecionadas <button type="button" disabled={busy} onClick={() => setPhotos(previous => ({ ...previous, [selected.id]: [] }))}>Remover fotos</button></p>}
          <form className={s.composer} onSubmit={event => { event.preventDefault(); void send(); }}><button type="button" className={s.button} disabled={busy || !canEdit} onClick={() => setPicker(value => !value)}>Imóvel</button><textarea rows={1} maxLength={2000} aria-label={`Mensagem para ${selected.name} no ${label}`} placeholder={`Mensagem pelo ${label}…`} value={draft} disabled={busy || !canEdit} onChange={event => setDraft(event.target.value)}/><button className={s.button} disabled={busy || !canEdit || !selected.canSend || !draft.trim()} type="submit">{busy ? 'Enviando…' : 'Enviar'}</button></form>
        </>}</section>
      </div>}
  </section>;
}
