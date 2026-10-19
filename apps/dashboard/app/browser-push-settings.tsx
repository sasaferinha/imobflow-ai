'use client';

import { useEffect, useRef, useState } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import styles from './browser-push-settings.module.css';

type PushConfiguration = { configured: boolean; publicKey: string | null; subscribed: boolean; schedulerConfigured: boolean; bindingIds: string[] };
type Capability = 'checking' | 'supported' | 'unsupported' | 'install-ios';
const workerPath = '/push-sw.js';

export function pushPublicKey(value: string) {
  if (!/^[A-Za-z0-9_-]{86,90}$/.test(value)) throw new Error('invalid_push_key');
  const binary = window.atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('invalid_push_key');
  return bytes;
}

export async function pushEndpointHash(endpoint: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function subscriptionMatchesPushKey(subscription: PushSubscription, publicKey: string | null) {
  if (!publicKey || !subscription.options.applicationServerKey) return false;
  try {
    const actual = new Uint8Array(subscription.options.applicationServerKey);
    const expected = pushPublicKey(publicKey);
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  } catch { return false; }
}

function isOurWorker(registration: ServiceWorkerRegistration) {
  const worker = registration.active || registration.waiting || registration.installing;
  return worker?.scriptURL === new URL(workerPath, window.location.origin).href;
}

async function waitForWorker(registration: ServiceWorkerRegistration) {
  if (registration.active) return;
  const worker = registration.installing || registration.waiting;
  if (!worker) throw new Error('push_worker_missing');
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => { window.clearTimeout(timer); worker.removeEventListener('statechange', check); if (error) reject(error); else resolve(); };
    const check = () => { if (worker.state === 'activated') done(); else if (worker.state === 'redundant') done(new Error('push_worker_failed')); };
    const timer = window.setTimeout(() => done(new Error('push_worker_timeout')), 15_000);
    worker.addEventListener('statechange', check); check();
  });
}

export default function BrowserPushSettings({ ready = false, demonstration = false }: { ready?: boolean; demonstration?: boolean }) {
  const [capability, setCapability] = useState<Capability>('checking');
  const [configuration, setConfiguration] = useState<PushConfiguration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [keyChanged, setKeyChanged] = useState(false);
  const [revision, setRevision] = useState(0);
  const live = useRef(false);
  const busyRef = useRef(false);
  const readGeneration = useRef(0);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; operation.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!ready || demonstration || isProductDemo()) return;
    let active = true;
    const generation = ++readGeneration.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const refresh = () => { if (!busyRef.current && document.visibilityState === 'visible') setRevision(value => value + 1); };
    async function readStatus() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (ios && !standalone) { if (active) setCapability('install-ios'); window.clearTimeout(timeout); return; }
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || !crypto.subtle) {
        if (active) setCapability('unsupported'); window.clearTimeout(timeout); return;
      }
      if (active) { setCapability('supported'); setPermission(Notification.permission); }
      try {
        const registration = await navigator.serviceWorker.getRegistration('/painel');
        const local = registration && isOurWorker(registration) ? await registration.pushManager.getSubscription() : null;
        const hash = local ? await pushEndpointHash(local.endpoint) : null;
        const response = await dashboardFetch(`/api/notifications/push${hash ? `?endpointHash=${hash}` : ''}`, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) throw new Error('push_status_unavailable');
        const status = await response.json() as PushConfiguration;
        if (!active || generation !== readGeneration.current) return;
        const matchesKey = Boolean(local && subscriptionMatchesPushKey(local, status.publicKey));
        setSubscription(local);
        setKeyChanged(Boolean(local && status.configured === true && !matchesKey));
        setConfiguration({ configured: status.configured === true, publicKey: typeof status.publicKey === 'string' ? status.publicKey : null,
          subscribed: Boolean(local && matchesKey && status.subscribed === true && Array.isArray(status.bindingIds) && status.bindingIds.length),
          schedulerConfigured: status.schedulerConfigured === true, bindingIds: Array.isArray(status.bindingIds) ? status.bindingIds : [] });
      } catch {
        if (active && generation === readGeneration.current) { setConfiguration(null); setNotice('Não foi possível verificar os avisos deste aparelho. Tente verificar novamente.'); }
      } finally { window.clearTimeout(timeout); }
    }
    void readStatus();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [ready, demonstration, revision]);

  const available = Boolean(configuration?.configured && configuration.publicKey && configuration.schedulerConfigured);
  const enabled = Boolean(available && configuration?.subscribed && subscription && permission === 'granted');
  async function enable() {
    if (busy || !available || !configuration?.publicKey || capability !== 'supported' || !ready || demonstration || isProductDemo()) return;
    busyRef.current = true; readGeneration.current++; setBusy(true); setNotice('');
    const controller = new AbortController(); operation.current = controller;
    let created: PushSubscription | null = null;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      // Permission is requested only inside this explicit click, never on page load.
      const allowed = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (!live.current || controller.signal.aborted) return;
      setPermission(allowed);
      if (allowed !== 'granted') { setNotice('Sem permissão, nenhum aviso será enviado a este aparelho. Você pode permitir nas configurações do navegador.'); return; }
      const previous = await navigator.serviceWorker.getRegistration('/painel');
      if (previous && !isOurWorker(previous)) throw new Error('push_worker_conflict');
      const registration = await navigator.serviceWorker.register(workerPath, { scope: '/painel', updateViaCache: 'none' });
      await waitForWorker(registration);
      if (!live.current || controller.signal.aborted) return;
      let existing = await registration.pushManager.getSubscription();
      if (existing && !subscriptionMatchesPushKey(existing, configuration.publicKey)) {
        if (!await existing.unsubscribe()) throw new Error('push_old_key_removal_failed');
        existing = null;
      }
      const local = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushPublicKey(configuration.publicKey) });
      if (!existing) created = local;
      if (!live.current || controller.signal.aborted) { if (created) await created.unsubscribe(); return; }
      const response = await dashboardFetch('/api/notifications/push', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: local.toJSON() }) });
      const result = await response.json() as { ok?: boolean; bindingId?: string };
      if (!response.ok || result.ok !== true || !result.bindingId) throw new Error('push_subscription_unconfirmed');
      if (live.current) { setSubscription(local); setKeyChanged(false); setConfiguration(current => current ? { ...current, subscribed: true, bindingIds: [result.bindingId!] } : null);
        setNotice('Avisos autorizados neste aparelho. A entrega depende da conexão, das permissões do sistema e da sessão ativa da ImobFlow.'); }
    } catch {
      if (created) { try { await created.unsubscribe(); } catch { /* A missing server binding cannot display a notification. */ } }
      if (live.current) { setConfiguration(current => current ? { ...current, subscribed: false } : null); setNotice('Não foi possível confirmar a ativação. Nenhum aviso foi marcado como ativo. Verifique novamente ou tente em outro navegador compatível.'); }
    } finally {
      window.clearTimeout(timeout); busyRef.current = false; if (live.current) setBusy(false); operation.current = null;
    }
  }
  async function disable() {
    const endpoint = subscription?.endpoint || pendingRemoval;
    if (busy || !endpoint || !ready || demonstration || isProductDemo()) return;
    busyRef.current = true; readGeneration.current++; setBusy(true); setNotice('');
    const controller = new AbortController(); operation.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    let browserStopped = false;
    try {
      if (subscription) browserStopped = await subscription.unsubscribe(); else browserStopped = true;
      if (!live.current) return;
      if (browserStopped) { setSubscription(null); setPendingRemoval(endpoint); setConfiguration(current => current ? { ...current, subscribed: false } : null); }
      const response = await dashboardFetch('/api/notifications/push', { method: 'DELETE', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
      if (!response.ok) throw new Error('push_removal_unconfirmed');
      if (live.current) { setSubscription(null); setPendingRemoval(null); setConfiguration(current => current ? { ...current, subscribed: false } : null);
        setNotice('Avisos desativados para esta conta neste aparelho. Para revogar também a permissão do site, use as configurações do navegador.'); }
    } catch {
      if (live.current) setNotice(browserStopped ? 'Avisos interrompidos neste aparelho. Falta confirmar a remoção no servidor; clique em Concluir remoção.' : 'Não foi possível confirmar a desativação. Tente novamente ou bloqueie as notificações nas configurações do navegador.');
    } finally { window.clearTimeout(timeout); busyRef.current = false; if (live.current) setBusy(false); operation.current = null; }
  }
  if (demonstration || isProductDemo()) return null;
  return <details className={styles.root}>
    <summary>Avisos no celular <span>{enabled ? 'Ativos neste aparelho' : 'Configurar'}</span></summary>
    <div className={styles.content}>
      <strong>Avisar mesmo com o painel fechado</strong>
      <p>Ative no navegador do celular que você deseja avisar. Não usamos o telefone cadastrado e não enviamos WhatsApp ou SMS.</p>
      <p>Avisos a partir de 2 minutos sem aceite para plantonistas e, a partir de 5 minutos, também para os demais corretores elegíveis, conforme a rotina de verificação. Sem nomes ou conteúdo de clientes na tela bloqueada.</p>
      {capability === 'checking' && <p>Verificando compatibilidade…</p>}
      {capability === 'install-ios' && <p className={styles.hint}>No iPhone ou iPad, abra a ImobFlow no Safari, toque em Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e ative aqui. É necessário iOS/iPadOS 16.4 ou superior.</p>}
      {capability === 'unsupported' && <p className={styles.hint}>Este navegador não oferece os recursos necessários. Tente um navegador atualizado com HTTPS. Os avisos dentro da ImobFlow continuam disponíveis.</p>}
      {capability === 'supported' && configuration && !available && <p className={styles.hint}>Servidor ainda pendente de configuração{!configuration.schedulerConfigured ? ' e rotina de verificação' : ''}. A ativação ficará disponível quando essa preparação estiver concluída.</p>}
      {capability === 'supported' && permission === 'denied' && <p className={styles.hint}>Notificações bloqueadas neste navegador. Para permitir, abra as configurações de notificações deste site e depois clique em Verificar novamente.</p>}
      {keyChanged && <p className={styles.hint}>A configuração de segurança dos avisos mudou. Reative neste aparelho para atualizar a inscrição.</p>}
      <div className={styles.actions}>
        {capability === 'supported' && !enabled && !pendingRemoval && <button type="button" disabled={!ready || busy || !available || permission === 'denied'} onClick={() => void enable()}>{busy ? 'Aguarde…' : keyChanged ? 'Reativar neste aparelho' : 'Ativar neste aparelho'}</button>}
        {(subscription || pendingRemoval) && <button type="button" className={styles.secondary} disabled={!ready || busy} onClick={() => void disable()}>{pendingRemoval ? 'Concluir remoção' : 'Desativar neste aparelho'}</button>}
        <button type="button" className={styles.secondary} disabled={!ready || busy} onClick={() => { setNotice(''); setRevision(value => value + 1); }}>Verificar novamente</button>
      </div>
      {notice && <p className={styles.status} role="status">{notice}</p>}
      <small>Autorize individualmente em cada aparelho. Não há garantia de entrega se o sistema bloquear avisos, não houver internet ou a sessão estiver encerrada.</small>
    </div>
  </details>;
}
