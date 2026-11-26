'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SocialChannel, SocialMode } from '@/lib/social-model';
import s from './social-connections.module.css';

type Account = { id: string; channel: SocialChannel; name: string; enabled: boolean; defaultMode: SocialMode; reconnectRequired?: boolean };
type Page = { id: string; name: string; instagramId: string | null; instagramName: string | null };
type Capability = { available: boolean; webhookConfigured: boolean };
type Status = { available: boolean; webhookConfigured: boolean; authorized: boolean; accounts: Account[]; pages?: Page[]; channels?: Record<SocialChannel, Capability> };
type Selection = { channel: SocialChannel; pages: Page[] };
const channels = ['facebook', 'instagram'] as const;
const channelName = (channel: SocialChannel) => channel === 'instagram' ? 'Instagram' : 'Facebook';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const capability = (status: Status, channel: SocialChannel): Capability => status.channels?.[channel] || { available: status.available, webhookConfigured: status.webhookConfigured };
function validStatus(value: Record<string, unknown>): value is Record<string, unknown> & Status {
  return typeof value.available === 'boolean' && typeof value.webhookConfigured === 'boolean' && typeof value.authorized === 'boolean'
    && (value.channels === undefined || record(value.channels) && channels.every(channel => { const item = (value.channels as Record<string, unknown>)[channel]; return record(item) && typeof item.available === 'boolean' && typeof item.webhookConfigured === 'boolean'; }))
    && Array.isArray(value.accounts) && value.accounts.every(account => record(account) && typeof account.id === 'string' && typeof account.name === 'string' && channels.includes(account.channel as SocialChannel) && typeof account.enabled === 'boolean' && (account.reconnectRequired === undefined || typeof account.reconnectRequired === 'boolean') && ['human', 'suggestions', 'automatic'].includes(String(account.defaultMode)))
    && (value.pages === undefined || Array.isArray(value.pages) && value.pages.every(page => record(page) && typeof page.id === 'string' && typeof page.name === 'string' && (page.instagramId === null || typeof page.instagramId === 'string') && (page.instagramName === null || typeof page.instagramName === 'string')));
}
async function request(action?: Record<string, unknown> | 'pages', channel?: SocialChannel): Promise<Status | { url: string }> {
  const query = action === 'pages' ? `?action=pages&channel=${channel}` : '';
  const response = await fetch(`/api/integrations/meta/social/connections${query}`, { method: action && action !== 'pages' ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', ...(action && action !== 'pages' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) } : {}) });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(record(body) && typeof body.error === 'string' ? body.error : 'Não foi possível consultar a conexão.');
  if (record(body) && typeof body.url === 'string' && typeof action === 'object' && action.action === 'connect') return { url: body.url };
  if (!record(body) || !validStatus(body)) throw new Error('Não foi possível conferir a conexão. Tente novamente.');
  return body;
}
function ChannelIcon({ channel }: { channel: SocialChannel }) {
  return channel === 'instagram'
    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>
    : <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.3 21v-8h2.8l.4-3.2h-3.2v-2c0-.9.3-1.6 1.6-1.6h1.7V3.3a22 22 0 0 0-2.5-.2c-2.5 0-4.2 1.5-4.2 4.3v2.4H8V13h2.9v8z"/></svg>;
}

/** Owner-only connections. The public return query opens a step, never grants access. */
export default function SocialConnections({ onChange }: { onChange?: () => void } = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pageId, setPageId] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [retryChannel, setRetryChannel] = useState<SocialChannel | undefined>();
  const [retryConnectChannel, setRetryConnectChannel] = useState<SocialChannel | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<SocialChannel | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(async (channel?: SocialChannel) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice(''); setRetryChannel(channel); setRetryConnectChannel(null);
    if (channel) { setSelection(null); setPageId(''); }
    try {
      // Preserve the already-connected channel even if the other permission fails.
      const snapshot = await request();
      if ('url' in snapshot) throw new Error('Resposta de conexão inválida.');
      if (!mounted.current) return;
      setStatus(snapshot);
      if (channel) {
        const account = snapshot.accounts.find(item => item.channel === channel && item.enabled);
        if (account) {
          if (!account.reconnectRequired) setNotice(`${channelName(channel)} conectado.`);
          return;
        }
        if (channel === 'instagram' && snapshot.channels) {
          // Instagram Login binds its one account in the callback. A return hint
          // alone must never fall back to Facebook Page authorization.
          setError('Não foi possível concluir a conexão do Instagram. Tente conectar novamente.');
          setRetryConnectChannel('instagram');
          return;
        }
        const next = await request('pages', channel);
        if ('url' in next) throw new Error('Resposta de conexão inválida.');
        if (!mounted.current) return;
        const pages = (next.pages || []).filter(page => channel === 'facebook' || page.instagramId);
        setStatus(next); setSelection({ channel, pages });
        setPageId(pages.length === 1 ? pages[0].id : '');
      }
    } catch (issue) {
      if (mounted.current) setError(issue instanceof Error ? issue.message : 'Não foi possível consultar a conexão.');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    // Run after hydration; the server and first client render stay identical.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const url = new URL(window.location.href);
      const channel = url.searchParams.get('social');
      if (channel === 'facebook' || channel === 'instagram') {
        setOpen(true);
        void load(channel);
        url.searchParams.delete('social');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [load]);

  async function mutate(body: Record<string, unknown>) {
    if (inFlight.current) return;
    if (body.action === 'connect' && (!status || !channels.includes(body.channel as SocialChannel) || !capability(status, body.channel as SocialChannel).available)) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    // A status/attendance failure must not resume an unrelated OAuth picker.
    setRetryChannel(body.action === 'select-page' ? selection?.channel : undefined);
    setRetryConnectChannel(body.action === 'connect' ? body.channel as SocialChannel : null);
    try {
      const next = await request(body);
      if (!mounted.current) return;
      if ('url' in next) {
        const url = new URL(next.url);
        const instagram = body.channel === 'instagram';
        if (url.origin !== (instagram ? 'https://www.instagram.com' : 'https://www.facebook.com')
          || url.pathname !== (instagram ? '/oauth/authorize' : '/v26.0/dialog/oauth')
          || url.username || url.password || url.hash) throw new Error('Endereço de autorização inválido.');
        window.location.assign(url.href); return;
      }
      setStatus(next);
      if (body.action === 'select-page' || body.action === 'disconnect') { setSelection(null); setPageId(''); setConfirmDisconnect(null); }
      setNotice(body.action === 'mode' ? 'Preferência salva para novos atendimentos.' : body.action === 'disconnect' ? 'Canal desconectado. Você pode conectar outra conta; o histórico anterior foi preservado.' : 'Conta conectada. Confira o recebimento e a resposta em Conversas.');
      onChange?.();
    } catch (issue) {
      if (mounted.current) setError(issue instanceof Error ? issue.message : 'Não foi possível confirmar a operação.');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  return <details className={s.root} open={open} onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open && !status && !inFlight.current) void load();
  }}>
    <summary>Conectar Instagram e Facebook <span>Administrador</span></summary>
    <div className={s.body} aria-busy={busy}>
      {error && <div className={s.error} role="alert"><p>{error}</p>{!retryConnectChannel && <button type="button" disabled={busy} onClick={() => void load(retryChannel)}>Tentar novamente</button>}</div>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {!status && !error && <p role="status">Carregando suas conexões…</p>}
      {status && <>
        <p className={s.intro}>Conecte cada canal com a conta que preferir.</p>
        <div className={s.channels}>{channels.map(channel => {
          const account = status.accounts.find(item => item.channel === channel && item.enabled);
          const availability = capability(status, channel);
          const picker = selection?.channel === channel ? selection : null;
          const selected = picker?.pages.find(page => page.id === pageId);
          const name = channelName(channel);
          const retryConnect = Boolean(error) && retryConnectChannel === channel;
          return <section className={s.card} key={channel} aria-label={`Conexão do ${name}`}>
            <div className={s.heading}><span className={`${s.brandMark} ${channel === 'instagram' ? s.instagram : ''}`}><ChannelIcon channel={channel}/></span><div><h3>{name}</h3></div></div>
            <div className={s.status}><span className={`${s.dot} ${account && !account.reconnectRequired ? s.connected : ''}`}/><div><strong>{account?.reconnectRequired ? 'Reconexão necessária' : account ? 'Conectado' : 'Não conectado'}</strong>{account && <span>{account.name}</span>}</div></div>
            {account?.reconnectRequired && <p className={s.note}>A autorização precisa ser renovada. Reconecte esta mesma conta para voltar a enviar mensagens.</p>}
            {!availability.available && <p className={s.note}>A ImobFlow precisa concluir a configuração do {name} para liberar a conexão.</p>}
            {availability.available && !availability.webhookConfigured && <p className={s.note}>O recebimento de mensagens do {name} ainda precisa ser habilitado pela ImobFlow.</p>}
            {confirmDisconnect === channel ? <div className={s.confirm} role="group" aria-label={`Confirmar desconexão do ${name}`}><strong>Desconectar {account?.name || name}?</strong><p>Novos atendimentos e envios serão interrompidos. O histórico continua salvo, separado da próxima conta.</p><div className={s.actions}><button type="button" disabled={busy} onClick={() => setConfirmDisconnect(null)}>Cancelar</button><button type="button" className={s.danger} disabled={busy} onClick={() => void mutate({ action: 'disconnect', channel })}>Confirmar desconexão</button></div></div>
              : account ? <>{account.reconnectRequired && <button type="button" className={s.primary} disabled={busy || !availability.available} onClick={() => void mutate({ action: 'connect', channel })}>{retryConnect ? 'Tentar reconectar' : 'Reconectar'} {name}<span aria-hidden="true"> ↗</span></button>}<button type="button" className={s.disconnect} aria-label={`Desconectar ${name}`} disabled={busy} onClick={() => { setConfirmDisconnect(channel); setSelection(null); }}>Desconectar</button></>
                : !picker && <div className={s.connectAction}><button type="button" className={s.primary} disabled={busy || !availability.available} onClick={() => void mutate({ action: 'connect', channel })}>{retryConnect ? 'Tentar conectar' : 'Conectar'} {name}<span aria-hidden="true"> ↗</span></button><p>Abre a autorização oficial do {name}.</p></div>}
            {picker && <fieldset className={s.selection} disabled={busy}><legend>Concluir conexão</legend>
              {picker.pages.length > 1 ? <label>{channel === 'instagram' ? 'Conta do Instagram' : 'Página do Facebook'}<select value={pageId} onChange={event => setPageId(event.target.value)}><option value="">Selecione uma conta</option>{picker.pages.map(page => <option key={page.id} value={page.id}>{channel === 'instagram' ? `${page.instagramName || page.name} · ${page.name}` : page.name}</option>)}</select></label> : selected ? <p>Conectar <strong>{channel === 'instagram' ? selected.instagramName || selected.name : selected.name}</strong> à ImobFlow?</p> : <p>{channel === 'instagram' ? 'Nenhuma conta profissional vinculada foi disponibilizada. Vincule seu Instagram à Página da imobiliária e autorize novamente.' : 'Nenhuma Página foi disponibilizada. Confira seu acesso à Página da imobiliária e autorize novamente.'}</p>}
              {picker.pages.length > 0 && <button type="button" className={s.primary} disabled={!selected || busy} onClick={() => void mutate({ action: 'select-page', pageId, channels: [channel] })}>Concluir conexão do {name}</button>}
              {!picker.pages.length && <button type="button" className={s.primary} disabled={busy || !availability.available} onClick={() => void mutate({ action: 'connect', channel })}>Autorizar {name} novamente</button>}
              <button type="button" disabled={busy} onClick={() => { setSelection(null); setPageId(''); setError(''); }}>Cancelar conexão</button>
            </fieldset>}
            {!account && channel === 'instagram' && status.channels && <details className={s.help} aria-label="Como conectar o Instagram"><summary>Como conectar</summary><p>Use uma conta profissional do Instagram (empresa ou criador). Entre no próprio Instagram e autorize o acesso às mensagens.</p><p>Não precisa de uma Página do Facebook. Você não informa senha ou código de acesso à ImobFlow.</p></details>}
            {account && <details className={s.preferences}><summary>Preferências de atendimento</summary><label>Novos atendimentos<select disabled={busy} value={account.defaultMode} onChange={event => void mutate({ action: 'mode', channel, mode: event.target.value })}><option value="human">Atendimento humano</option><option value="suggestions">Sugestões para o corretor</option><option value="automatic">Atendimento automático</option></select></label><p>A preferência vale para novos contatos. As respostas seguem as permissões e a janela de atendimento da Meta.</p></details>}
          </section>;
        })}</div>
      </>}
    </div>
  </details>;
}
