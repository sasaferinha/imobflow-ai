'use client';

import { useEffect, useState } from 'react';
import { dashboardFetch, isProductDemo } from '@/lib/dashboard-transport';
import { subscribeDashboardSync } from '@/lib/dashboard-sync';
import { visibleUrgentQueue, type UrgentQueueSnapshot } from '@/lib/conversation-urgency';
import styles from './conversation-urgent-alert.module.css';

const emptyLeadIds: string[] = [];

export default function ConversationUrgentAlert({ currentBrokerId, visibleLeadIds = emptyLeadIds, ready = false, demonstration = false, onOpen }: {
  currentBrokerId?: string;
  visibleLeadIds?: string[];
  ready?: boolean;
  demonstration?: boolean;
  onOpen: (leadId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<UrgentQueueSnapshot | null>(null);
  const [clock, setClock] = useState({ now: 0, visible: false, online: false });
  useEffect(() => {
    if (!ready || demonstration || isProductDemo() || !currentBrokerId) return;
    const updateClock = () => setClock({ now: Date.now(), visible: document.visibilityState === 'visible', online: navigator.onLine });
    const invalidate = () => { setSnapshot(null); updateClock(); };
    const onVisibility = () => { if (document.visibilityState !== 'visible') setSnapshot(null); updateClock(); };
    const onChange = (event: Event | MessageEvent) => {
      const entity = 'data' in event ? event.data?.entity : (event as CustomEvent).detail?.entity;
      if (entity === 'conversations' || entity === 'leads') invalidate();
    };
    // A local/cross-tab claim invalidates the notice before its replacement read finishes.
    // A read receipt alone does not dismiss a client still waiting for a reply.
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('imobflow_data_sync') : null;
    if (channel) channel.onmessage = onChange;
    window.addEventListener('imobflow_data_changed', onChange);
    const unsubscribe = subscribeDashboardSync({
      entities: ['conversations', 'conversation-inbox', 'leads'], interval: 15_000,
      load: async signal => {
        if (!navigator.onLine) throw new Error('offline');
        // The server checks current ownership and full waiting history in the database;
        // never infer urgency from the paginated 200-message display or unread counts.
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) controller.abort();
        const timeout = window.setTimeout(abort, 15_000);
        try {
          const response = await dashboardFetch('/api/conversations/urgent', { signal: controller.signal, cache: 'no-store', credentials: 'same-origin' });
          if (!response.ok) throw new Error('urgent_snapshot_unavailable');
          const payload = await response.json() as { data?: UrgentQueueSnapshot['data']; fetchedAt?: number } | null;
          if (!payload || !Array.isArray(payload.data) || !Number.isFinite(payload.fetchedAt)) throw new Error('urgent_snapshot_invalid');
          return { actorId: currentBrokerId, fetchedAt: payload.fetchedAt!, data: payload.data };
        } finally {
          controller.abort();
          window.clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
        }
      },
      apply: value => { setSnapshot(value); updateClock(); },
      onError: () => setSnapshot(null),
    });
    const timer = window.setInterval(updateClock, 1_000);
    window.addEventListener('offline', invalidate);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe(); window.clearInterval(timer);
      channel?.close();
      window.removeEventListener('imobflow_data_changed', onChange);
      window.removeEventListener('offline', invalidate);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, demonstration, currentBrokerId]);
  const pending = visibleUrgentQueue({ snapshot, visibleLeadIds: new Set(visibleLeadIds), currentBrokerId,
    ready: ready && clock.visible && clock.online, demonstration: demonstration || isProductDemo(), now: clock.now });
  // The live region remains mounted, but unchanged counts are not reannounced on polls.
  const announcement = pending.length ? `${pending.length} ${pending.length === 1 ? 'cliente sem corretor precisa' : 'clientes sem corretor precisam'} de atendimento humano.` : '';
  const next = pending[0];
  return <>
    <span className={styles.srOnly} role="alert" aria-atomic="true">{announcement}</span>
    {next && <section className={styles.banner} aria-label="Atendimento humano urgente">
      <svg className={styles.icon} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></svg>
      <div className={styles.copy}><strong>CLIENTE ESTÁ SOZINHO E PRECISA SER ATENDIDO</strong>
        <p>{pending.length === 1 ? '1 cliente está' : `${pending.length} clientes estão`} sem corretor, com mensagem aguardando resposta. Abra a conversa e confira o atendimento.</p>
      </div>
      <button type="button" className={styles.open} onClick={() => onOpen(next.leadId)}>Abrir próximo atendimento <span aria-hidden="true">→</span></button>
    </section>}
  </>;
}
