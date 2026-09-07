'use client';

import { useEffect, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { demoContacts, demoTemperature, type DemoConversationAction, type DemoConversationState } from '@/lib/demo-conversations';

export default function ConversationCenter({ state, dispatch, notify, openAgenda }: {
  state: DemoConversationState; dispatch: Dispatch<DemoConversationAction>;
  notify: (message: string) => void; openAgenda: () => void;
}) {
  const [search, setSearch] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const selected = demoContacts.find(contact => contact.id === state.selectedId)!;
  const thread = state.threads[selected.id];
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [selected.id, thread.messages.length]);
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = demoContacts.filter(contact =>
    (!onlyUnread || state.threads[contact.id].unread > 0) &&
    normalize(contact.name + ' ' + contact.category + ' ' + contact.style).includes(normalize(search)));
  function send(event: FormEvent) {
    event.preventDefault();
    if (!thread.draft.trim()) return;
    dispatch({ type: 'send', id: selected.id, messageId: crypto.randomUUID(), time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
    notify('Mensagem adicionada ao exemplo. Nenhum envio externo realizado.');
  }
  return <div className="conversation-demo">
    <p className="conversation-demo-notice"><strong>Demonstração · {demoContacts.length} perfis fictícios</strong><span>Mensagens e dados ilustrativos. As alterações ficam apenas nesta sessão; nenhum contato recebe mensagens.</span></p>
    <div className="inbox-layout">
      <aside className="inbox-list panel" aria-label="Conversas de demonstração">
        <div className="inbox-search">⌕ <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Buscar conversa" placeholder="Buscar cliente, perfil ou estilo" /></div>
        <div className="inbox-tabs"><button type="button" aria-pressed={!onlyUnread} className={!onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(false)}>Todas</button><button type="button" aria-pressed={onlyUnread} className={onlyUnread ? 'selected' : ''} onClick={() => setOnlyUnread(true)}>Não lidas</button></div>
        {filtered.map(contact => {
          const current = state.threads[contact.id];
          const last = current.messages[current.messages.length - 1];
          return <button type="button" className={`contact-row ${selected.id === contact.id ? 'selected' : ''}`} aria-pressed={selected.id === contact.id} onClick={() => dispatch({ type: 'select', id: contact.id })} key={contact.id}>
            <span className={`lead-avatar avatar-${contact.tone}`}>{contact.initials}</span>
            <span><strong>{contact.name}</strong><span className="conversation-category">{contact.category}</span><small>{last.text}</small></span>
            <time>{last.time}</time>{current.unread > 0 && <b aria-label={`${current.unread} mensagens não lidas no exemplo`}>{current.unread}</b>}
          </button>;
        })}
        {!filtered.length && <p className="empty-filter">Nenhuma conversa encontrada. Ajuste a busca ou selecione “Todas”.</p>}
      </aside>
      <section className="full-chat panel" aria-label={`Conversa de exemplo com ${selected.name}`}>
        <div className="full-chat-head"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><div><strong>{selected.name}</strong><span>Exemplo · {thread.humanMode ? 'Marina responsável' : 'Triagem'} · {selected.style}</span></div><button type="button" aria-pressed={thread.humanMode} className={thread.humanMode ? 'active-action' : ''} onClick={() => { dispatch({ type: 'assign', id: selected.id }); notify('Responsável alterado apenas nesta demonstração.'); }}>{thread.humanMode ? 'Retomar triagem' : 'Assumir conversa'}</button></div>
        <div className="full-chat-body" ref={bodyRef}><span className="chat-date">Conversa ilustrativa</span>{thread.messages.map(message => <div className={`bubble ${message.side}`} key={message.id}><span className="visually-hidden">{message.side === 'incoming' ? selected.name : 'Atendimento'}: </span>{message.text}<small>{message.time} · Exemplo</small></div>)}</div>
        <div className="conversation-suggestion"><span>Resposta sugerida · {selected.style}</span><p>{selected.suggestion}</p><button type="button" onClick={() => { dispatch({ type: 'draft', id: selected.id, text: selected.suggestion }); composerRef.current?.focus(); }}>Usar resposta</button></div>
        <form className="full-composer" onSubmit={send}><button type="button" aria-label="Anexos de demonstração" onClick={() => notify('Anexos não são enviados nesta demonstração.')}>＋</button><input ref={composerRef} value={thread.draft} onChange={event => dispatch({ type: 'draft', id: selected.id, text: event.target.value })} aria-label={`Mensagem de exemplo para ${selected.name}`} placeholder="Escreva uma resposta de exemplo…" maxLength={4000}/><button className="send-button" type="submit" disabled={!thread.draft.trim()} aria-label="Adicionar mensagem ao exemplo">➜</button></form>
      </section>
      <aside className="lead-profile panel"><div className="profile-hero"><span className={`lead-avatar avatar-${selected.tone}`}>{selected.initials}</span><h3>{selected.name}</h3><p>Cliente fictício · {selected.category}</p>
        <div className="conversation-classifications" aria-label="Classificação do cliente">
          <span className="conversation-stage conversation-badge" aria-label={`Etapa: ${selected.stage}`}>{selected.stage}</span>
          <span className="conversation-temperature conversation-badge" data-temperature={demoTemperature(selected.score)} aria-label={`Temperatura: ${demoTemperature(selected.score)}`}>{demoTemperature(selected.score)}</span>
        </div>
      </div><div className="score-ring"><strong>{selected.score}</strong><span>Prioridade ilustrativa</span></div>
        <dl>{[['Intenção', selected.goal], ['Tipo', selected.propertyType], ['Região', selected.region], ['Orçamento', selected.budget], ['Quartos', selected.rooms], ['Pagamento', selected.payment], ['Estilo de atendimento', selected.style]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <button type="button" className="profile-action" onClick={openAgenda}>Abrir agenda</button><p className="conversation-profile-note">Este exemplo não cria leads nem compromissos no banco de dados.</p>
      </aside>
    </div>
  </div>;
}
