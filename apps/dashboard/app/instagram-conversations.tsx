'use client';

import { useEffect, useState } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import type { InstagramInbox } from '@/lib/instagram-inbox';
import { ChannelIcon } from './conversation-channels';
import s from './conversation-channels.module.css';

const formatTime = (at: string) => new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/** Isolated read-only intake. Never mount the WhatsApp composer for an Instagram contact. */
export default function InstagramConversations({ demonstration = false, initialLeadId }: { demonstration?: boolean; initialLeadId?: string }) {
  const preview = demonstration || isProductDemo();
  const [data, setData] = useState<InstagramInbox | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!preview);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState(initialLeadId || '');
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (preview) return;
    const abort = new AbortController();
    void dashboardFetch('/api/conversations/instagram', { signal: abort.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Seu acesso precisa ser verificado. Entre novamente na ImobFlow.' : 'Não foi possível consultar as mensagens do Instagram. Tente novamente.');
      const result = await response.json() as { data?: InstagramInbox };
      if (!result.data || !Array.isArray(result.data.contacts) || result.data.readOnly !== true) throw new Error('A consulta do Instagram está indisponível.');
      if (!abort.signal.aborted) setData(result.data);
    }).catch(reason => {
      if (!abort.signal.aborted) { setData(null); setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o Instagram.'); }
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [preview, attempt]);
  function refresh() {
    setData(null); setError(''); setLoading(true); setAttempt(value => value + 1);
  }
  const contacts = (data?.contacts || []).filter(contact => contact.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const selected = contacts.find(contact => contact.id === selectedId) || contacts[0];
  return <section id="conversation-channel-content" className={s.instagram} aria-label="Conversas do Instagram">
    <div className={s.notice}>
      <ChannelIcon channel="instagram" />
      <div><strong>Instagram · somente consulta</strong><p>A conexão completa ainda precisa ser ativada e testada. Respostas, fotos, importação do histórico e IA não estão habilitadas neste canal.</p></div>
      {!preview && <button type="button" disabled={loading} onClick={refresh}>{loading ? 'Consultando…' : 'Atualizar'}</button>}
    </div>
    {preview ? <div className={s.empty}><ChannelIcon channel="instagram" /><h2>Instagram na demonstração</h2><p>Este canal está em preparação. Nenhuma conta é conectada e nenhuma mensagem real é consultada nesta prévia.</p></div>
      : error ? <div className={s.empty} role="alert"><h2>Não foi possível carregar</h2><p>{error}</p><button className={s.reload} type="button" onClick={refresh}>Tentar novamente</button></div>
      : loading ? <div className={s.empty} role="status"><ChannelIcon channel="instagram" /><h2>Consultando mensagens do Instagram…</h2></div>
      : !data?.contacts.length ? <div className={s.empty}><ChannelIcon channel="instagram" /><h2>Nenhuma DM disponível</h2><p>A conexão e o teste de uma conta profissional estão pendentes. Os textos recebidos pela integração atual, quando disponíveis para sua imobiliária, aparecerão aqui.</p></div>
      : <><div className={s.grid}>
        <aside className={s.list} aria-label="Contatos do Instagram"><h2>Mensagens recebidas</h2><label className={s.search}><span>Buscar contato</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome do contato" /></label><div className={s.contacts}>{contacts.map(contact => <button type="button" className={s.contact} key={contact.id} aria-pressed={selected?.id === contact.id} onClick={() => setSelectedId(contact.id)}><strong>{contact.name}</strong><span>{contact.messages.at(-1)?.text || 'Sem texto disponível'}</span>{contact.lastMessageAt && <small>{formatTime(contact.lastMessageAt)}</small>}</button>)}{!contacts.length && <p className={s.noResults}>Nenhum contato encontrado nesta busca.</p>}</div></aside>
        <section className={s.thread} aria-label={selected ? `Histórico de ${selected.name}` : 'Histórico do Instagram'}>{selected ? <><header><h3>{selected.name}</h3><p>{selected.assignedTo ? `Responsável: ${selected.assignedTo}` : 'Sem responsável definido'} · Instagram</p></header><div className={s.messages}>{selected.messages.map(message => <article className={s.message} key={message.id}><p>{message.text}</p><time dateTime={message.at}>{formatTime(message.at)}</time></article>)}{!selected.messages.length && <p className={s.noResults}>Não há mensagens de texto disponíveis para este contato.</p>}</div><footer>Envio pela ImobFlow ainda não habilitado. Para responder agora, use o aplicativo do Instagram. A IA permanece desligada neste canal.</footer></> : <p className={s.noResults}>Selecione um contato para consultar.</p>}</section>
      </div><p className={s.limit}>Consulta dos {data.limit} contatos Instagram mais recentemente cadastrados, ordenados pela última mensagem disponível. Até 40 textos por contato; não representa o histórico completo do Instagram.</p></>}
  </section>;
}
