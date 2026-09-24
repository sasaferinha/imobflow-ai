'use client';
import { dashboardFetch as fetch } from '@/lib/dashboard-transport';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Script from 'next/script';
import { beginMetaSignup, type FacebookSdk, type SignupAssets } from '@/lib/meta-whatsapp-signup-client';
import './whatsapp-integration.css';

type Connection = {
  configured: boolean; phoneNumberId: string; apiVersion: string; enabled: boolean; hasAccessToken: boolean;
  verification: 'unchecked' | 'verified' | 'failed'; verificationError?: string;
  displayPhoneNumber?: string; verifiedName?: string | null; verifiedAt?: string; businessAppConnected?: boolean | null;
};
type EmbeddedConfig = { appId: string; configId: string; available: boolean; loginConfigured: boolean; webhookConfigured: boolean; apiVersion: string };
type Feedback = { kind: 'error' | 'success' | 'info'; message: string };

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as { data?: T; error?: string } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error || 'Não foi possível carregar a configuração. Tente novamente.');
  return payload.data;
}

export default function WhatsAppIntegration({ canEdit, onOpenConversations }: { canEdit: boolean; onOpenConversations: () => void }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [embedded, setEmbedded] = useState<EmbeddedConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'authorizing' | 'saving' | 'checking' | 'disconnecting'>('idle');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [sdkStatus, setSdkStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [manualOpen, setManualOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [pin, setPin] = useState('');
  const [enabled, setEnabled] = useState(true);
  const sdk = useRef<FacebookSdk | null>(null);
  const cleanupSignup = useRef<(() => void) | null>(null);
  const pendingSignup = useRef<(SignupAssets & { code: string }) | null>(null);
  const mounted = useRef(false);
  const busy = phase !== 'idle';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cleanupSignup.current?.(); };
  }, []);

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    const abort = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const results = await Promise.allSettled([
          fetch('/api/conversations/whatsapp', { cache: 'no-store', signal: abort.signal }).then(readResponse<Connection>),
          fetch('/api/integrations/meta/embedded-signup', { cache: 'no-store', signal: abort.signal }).then(readResponse<EmbeddedConfig>),
        ]);
        if (!active) return;
        if (results[0].status === 'rejected') throw results[0].reason;
        const data = results[0].value;
        setConnection(data); setPhoneNumberId(data.phoneNumberId); setEnabled(data.configured ? data.enabled : true);
        if (results[1].status === 'fulfilled') setEmbedded(results[1].value);
        else setFeedback({ kind: 'error', message: 'A opção de conexão pela Meta não pôde ser consultada. Atualize a configuração ou use a opção manual.' });
      } catch (error) {
        if (active) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar a configuração.' });
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; abort.abort(); };
  }, [canEdit, loadAttempt]);

  useEffect(() => {
    if (!embedded?.available || sdkStatus !== 'loading') return;
    // Next's script event can fire before the SDK exposes window.FB. Poll briefly
    // so a slow Meta load does not leave the main action silently unavailable.
    const interval = window.setInterval(() => {
      if ((window as Window & { FB?: FacebookSdk }).FB) prepareSdk();
    }, 250);
    const timeout = window.setTimeout(() => setSdkStatus(current => current === 'loading' ? 'failed' : current), 15000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [embedded?.available, sdkStatus]);

  function prepareSdk() {
    const facebook = (window as Window & { FB?: FacebookSdk }).FB;
    if (!facebook || !embedded) { setSdkStatus('failed'); return; }
    facebook.init({ appId: embedded.appId, cookie: true, xfbml: false, version: embedded.apiVersion });
    sdk.current = facebook; setSdkStatus('ready');
  }

  async function finishSignup(data: SignupAssets & { code: string }) {
    setPhase('saving');
    setFeedback({ kind: 'info', message: 'Autorização recebida. Validando o número e ativando o recebimento na Meta…' });
    try {
      const result = await fetch('/api/integrations/meta/embedded-signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, pin }),
      }).then(readResponse<Connection>);
      if (!mounted.current) return;
      setConnection(result); setPhoneNumberId(result.phoneNumberId); setEnabled(result.enabled); setAccessToken('');
      setFeedback({ kind: 'success', message: 'Número autorizado e configuração salva. Agora confira o recebimento e a resposta com uma mensagem de teste.' });
    } catch (error) {
      if (mounted.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível concluir a conexão. Tente novamente.' });
    } finally { pendingSignup.current = null; if (mounted.current) { setPin(''); setConnectOpen(false); setPhase('idle'); } }
  }

  function connect() {
    if (busy || !embedded?.available) return;
    if (!sdk.current) prepareSdk();
    if (!sdk.current) {
      setFeedback({ kind: 'error', message: 'A janela da Meta ainda não carregou. Aguarde alguns segundos e tente novamente. Se persistir, atualize a página e desative o bloqueador de conteúdo para esta tela.' });
      return;
    }
    pendingSignup.current = null;
    setPin(''); setConnectOpen(false);
    setPhase('authorizing');
    setFeedback({ kind: 'info', message: 'Na janela da Meta, escolha a conta WhatsApp da sua empresa, confirme o número e permita o acesso.' });
    cleanupSignup.current?.();
    cleanupSignup.current = beginMetaSignup(sdk.current, embedded.configId, {
      complete: data => { if (!mounted.current) return; pendingSignup.current = data; setPhase('idle'); setConnectOpen(true); setFeedback({ kind: 'info', message: 'Autorização recebida. Informe o PIN de proteção para concluir a ativação.' }); },
      error: message => { if (mounted.current) { setFeedback({ kind: 'error', message }); setPhase('idle'); setPin(''); } },
    }, true);
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setPhase('saving'); setFeedback({ kind: 'info', message: 'Conferindo na Meta se a autorização dá acesso a esse número…' });
    try {
      const result = await fetch('/api/conversations/whatsapp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumberId: phoneNumberId.trim(), wabaId: wabaId.trim(), accessToken: accessToken.trim(), apiVersion: embedded?.apiVersion || connection?.apiVersion || 'v26.0', enabled }),
      }).then(readResponse<Connection>);
      if (!mounted.current) return;
      setConnection(result); setAccessToken(''); setManualOpen(false);
      setFeedback({ kind: 'success', message: result.enabled ? 'Acesso ao número confirmado e configuração salva. Faça o teste de mensagem abaixo para conferir envio e recebimento.' : 'Configuração salva com a integração pausada.' });
    } catch (error) {
      if (mounted.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível salvar a configuração.' });
    } finally { if (mounted.current) { setAccessToken(''); setPhase('idle'); } }
  }

  async function verify() {
    if (busy) return;
    setPhase('checking'); setFeedback(null);
    try {
      const result = await fetch('/api/conversations/whatsapp?verify=1', { cache: 'no-store' }).then(readResponse<Connection>);
      if (!mounted.current) return;
      setConnection(result);
      setFeedback({ kind: result.verification === 'verified' ? 'success' : 'error', message: result.verification === 'verified' ? 'A Meta confirmou o acesso a esse número. A entrega de mensagens deve ser conferida no teste abaixo.' : result.verificationError || 'Não há autorização salva para conferir o número. Conecte pela Meta ou informe um token válido.' });
    } catch (error) { if (mounted.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível conferir o acesso.' }); }
    finally { if (mounted.current) setPhase('idle'); }
  }

  async function disconnect() {
    if (busy || !canEdit || !connection?.configured) return;
    setPhase('disconnecting'); setFeedback(null);
    try {
      const result = await fetch('/api/conversations/whatsapp', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true, phoneNumberId: connection.phoneNumberId }) }).then(readResponse<Connection>);
      if (!mounted.current) return;
      setConnection(result); setPhoneNumberId(''); setWabaId(''); setAccessToken(''); setPin(''); setEnabled(true); setConfirmDisconnect(false);
      setFeedback({ kind: 'success', message: 'WhatsApp desvinculado da ImobFlow. Histórico preservado. Para voltar a usar, conecte e autorize o número novamente.' });
    } catch (error) { if (mounted.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível desvincular.' }); }
    finally { if (mounted.current) setPhase('idle'); }
  }

  if (!canEdit) return <section className="panel"><div className="panel-heading"><p className="eyebrow">Integrações</p><h2>WhatsApp Business</h2></div><p>Somente o administrador pode conectar o WhatsApp da empresa.</p></section>;

  const status = !connection ? 'Configuração indisponível' : !connection.configured ? 'Nenhum número configurado' : !connection.enabled ? 'Integração pausada' : !connection.hasAccessToken ? 'Autorização pendente' : connection.verification === 'failed' ? 'Revisar autorização' : connection.verification === 'verified' ? 'Acesso ao número confirmado' : 'Número salvo · falta conferir';
  return <section className="panel whatsapp-setup" aria-busy={loading || busy}>
    {embedded?.available && <Script id="facebook-jssdk" src="https://connect.facebook.net/pt_BR/sdk.js" strategy="afterInteractive" onLoad={prepareSdk} onReady={prepareSdk} onError={() => setSdkStatus('failed')} />}
    <div className="wa-card-heading"><span className="wa-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 11.5a8 8 0 0 1-8 8 9 9 0 0 1-3.5-.7L4 20l1.2-4.5a8 8 0 1 1 14.8-4Z"/><path d="M8.5 8.5c0 3.5 3.5 7 7 7l1-2-2-1-1 1c-1.5-.5-2.5-1.5-3-3l1-1-1-2-2 1Z"/></svg></span><div><h2>WhatsApp Business</h2><p className="wa-intro">As conversas da sua imobiliária, em um só lugar.</p></div></div>
    {feedback && <p className={`wa-feedback ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.message}</p>}
    {loading ? <p role="status">Carregando a configuração do WhatsApp…</p> : <>
      <div className="wa-status"><span className={`wa-status-dot ${connection?.verification === 'verified' && connection.enabled ? 'verified' : ''}`} /><div><strong>{status}</strong>{connection?.configured && <p>{connection.displayPhoneNumber || `Identificação do número: ${connection.phoneNumberId}`}{connection.verifiedName ? ` · ${connection.verifiedName}` : ''}</p>}</div><button type="button" disabled={busy} onClick={() => { setFeedback(null); setLoadAttempt(value => value + 1); }}>Atualizar configuração</button></div>
      {connection?.configured && <div className="wa-disconnect">
        {!confirmDisconnect ? <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Desvincular WhatsApp</button> : <div role="group" aria-label="Confirmar desvinculação do WhatsApp">
          <strong>Desvincular este WhatsApp da ImobFlow?</strong>
          <p>O bot e novos envios pelo painel serão interrompidos. Envios pendentes serão cancelados; mensagens já em processamento podem terminar. O histórico será preservado.</p>
          <p>Isso não exclui sua conta nem libera o registro do número na Meta para ativação no aplicativo. Essa migração deve ser feita com suporte.</p>
          <div className="wa-test-actions"><button type="button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancelar</button><button type="button" disabled={busy} onClick={() => void disconnect()}>{phase === 'disconnecting' ? 'Desvinculando…' : 'Confirmar desvinculação'}</button></div>
        </div>}
      </div>}
      {connection && <div className="wa-connect-action"><button className="primary-button" type="button" disabled={busy || !embedded?.available} onClick={connect}>{phase === 'authorizing' ? 'Aguardando a Meta…' : connection.configured ? 'Reconectar WhatsApp' : 'Conectar WhatsApp'}<span aria-hidden="true"> ↗</span></button><p>{embedded?.available ? 'Abre a janela oficial da Meta. Sem copiar ID ou token.' : 'Conexão automática ainda indisponível. A configuração da ImobFlow na Meta está pendente.'}</p>{embedded?.available && sdkStatus === 'loading' && <p role="status">Preparando a conexão com a Meta…</p>}{embedded?.available && sdkStatus === 'failed' && <p role="alert">Não foi possível carregar a Meta. Recarregue a página e permita os scripts da Meta.</p>}{phase === 'authorizing' && <button type="button" onClick={() => { cleanupSignup.current?.(); pendingSignup.current = null; setPhase('idle'); setFeedback(null); }}>Cancelar tentativa</button>}</div>}
      {connection && connectOpen && embedded?.available && <ol className="wa-steps" aria-label="Conectar pela Meta">
        <li><span className="wa-step-number">2</span><div><h3>{connection.configured ? 'Gerencie a autorização' : 'Autorize o WhatsApp'}</h3>
          {embedded?.available ? <>
            <p>Autorização recebida. Conclua a ativação do número.</p>
            <form onSubmit={event => { event.preventDefault(); if (!busy && pendingSignup.current && /^\d{6}$/.test(pin)) void finishSignup(pendingSignup.current); }} className="wa-meta-form">
              <label htmlFor="wa-pin">PIN de proteção do número<input id="wa-pin" type="password" autoComplete="new-password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} aria-describedby="wa-pin-help" disabled={busy} /></label>
              <small id="wa-pin-help">Digite o PIN de 6 dígitos do número. Para um número novo, escolha um PIN e guarde-o para futuras conexões.</small>
              <button className="primary-button" type="submit" disabled={busy || pin.length !== 6}>{phase === 'saving' ? 'Validando e salvando…' : 'Concluir conexão'}</button>
              <button type="button" disabled={busy} onClick={() => { pendingSignup.current = null; setPin(''); setConnectOpen(false); setFeedback(null); }}>Cancelar</button>
            </form>
            {sdkStatus === 'failed' && <p className="wa-feedback error" role="alert">A janela de conexão não carregou. Permita os scripts da Meta no navegador e recarregue esta página, ou use a configuração manual.</p>}
            {phase === 'authorizing' && <button type="button" onClick={() => { cleanupSignup.current?.(); setPhase('idle'); setPin(''); setFeedback({ kind: 'info', message: 'Tentativa encerrada. Feche a janela da Meta antes de começar novamente.' }); }}>Encerrar tentativa</button>}
          </> : <div className="wa-unavailable"><strong>{embedded ? 'A conexão pela Meta ainda não está habilitada' : 'Disponibilidade da conexão não confirmada'}</strong><p>{embedded ? 'Peça ao suporte do ImobFlow para habilitar essa opção. Se você já possui uma conta na API do WhatsApp, pode informar os dados pela configuração manual.' : 'Atualize a configuração para tentar novamente. A configuração manual está disponível para quem já possui uma conta na API do WhatsApp.'}</p><button type="button" onClick={() => setManualOpen(true)}>Configurar manualmente</button></div>}
        </div></li>
      </ol>}
      {connection?.configured && <div className="wa-test-actions"><button type="button" disabled={busy || !connection.hasAccessToken} onClick={() => void verify()}>{phase === 'checking' ? 'Conferindo…' : 'Verificar conexão'}</button><button type="button" disabled={busy || !connection.enabled} onClick={onOpenConversations}>Abrir Conversas</button><small>Envie uma mensagem de outro telefone e responda pelo painel para testar.</small></div>}
      {connection?.verification === 'verified' && <p className="wa-feedback info">{connection.businessAppConnected === true ? 'WhatsApp Business conectado junto ao painel. Envie uma mensagem pelo aplicativo e confira se aparece em Conversas. O histórico depende da sincronização habilitada na Meta.' : connection.businessAppConnected === false ? 'Este número está conectado somente à API. Para registrar mensagens enviadas pelo aplicativo, é necessário conectar o WhatsApp Business em coexistência. Fale com o suporte antes de alterar o número.' : 'A sincronização do aplicativo WhatsApp Business ainda precisa ser confirmada para este número.'}</p>}
      {connection && <details className="wa-manual" open={manualOpen} onToggle={event => setManualOpen(event.currentTarget.open)}><summary>Configurações avançadas</summary><p>Configuração manual para suporte técnico e contas já ativadas na API do WhatsApp.</p><p>O aplicativo Meta precisa receber o campo <code>messages</code> no webhook deste ImobFlow. Peça apoio técnico se essa etapa ainda não foi concluída.</p><form onSubmit={submitManual} className="wa-manual-form">
        <label htmlFor="wa-phone-id">Identificação do número na Meta<input id="wa-phone-id" value={phoneNumberId} onChange={event => setPhoneNumberId(event.target.value)} inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} placeholder="Ex.: 123456789012345" required disabled={busy} /><small>Copie o Phone Number ID, não o telefone com +55.</small></label>
        <label htmlFor="wa-waba-id">ID da conta WhatsApp Business<input id="wa-waba-id" value={wabaId} onChange={event => setWabaId(event.target.value)} inputMode="numeric" pattern="[0-9]{5,30}" maxLength={30} placeholder="Ex.: 1480866203849141" disabled={busy} /><small>Opcional, mas recomendado: ativa o webhook de recebimento na conta WhatsApp Business correta.</small></label>
        <label htmlFor="wa-token">Novo token de acesso<input id="wa-token" type="password" autoComplete="new-password" value={accessToken} onChange={event => setAccessToken(event.target.value)} minLength={10} maxLength={4096} required disabled={busy} /><small>Use um token com permissão de gerenciar a conta e enviar mensagens. O token salvo nunca é exibido.</small></label>
        <label className="wa-enabled"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy} />Habilitar envio e recebimento no ImobFlow</label>
        <button type="submit" className="primary-button" disabled={busy}>{phase === 'saving' ? 'Validando e salvando…' : 'Validar e salvar configuração'}</button>
      </form></details>}
    </>}
  </section>;
}
