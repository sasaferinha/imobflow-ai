'use client';

import { useEffect, useRef, useState } from 'react';
import { isProductDemo } from '@/lib/dashboard-transport';
import type { ConversationInboxItem } from '@/lib/conversation-inbox';
import s from './conversation-assistant.module.css';

/** Opt-in, current tab only. No customer name or message content in system notifications. */
export default function ConversationAlerts({ inbox = [], ready = true, demonstration = false }: { inbox?: ConversationInboxItem[]; ready?: boolean; demonstration?: boolean }) {
  const [enabled, setEnabled] = useState(false), [status, setStatus] = useState(''), [asking, setAsking] = useState(false);
  const baseline = useRef(new Map<string, number>()), enabledAt = useRef(0), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!enabled || !ready || demonstration || isProductDemo()) return;
    let arrivals = 0;
    for (const item of inbox) {
      const previous = baseline.current.get(item.conversationId);
      if (previous != null && item.incomingCount > previous && item.unread > 0) arrivals += Math.min(item.unread, item.incomingCount - previous);
      else if (previous == null && item.unread > 0 && Date.parse(item.lastMessageAt) >= enabledAt.current) arrivals += item.unread;
      baseline.current.set(item.conversationId, Math.max(previous || 0, item.incomingCount));
    }
    if (!arrivals || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const notice = new Notification('ImobFlow · nova mensagem', { body: 'Há novas mensagens na caixa de entrada. Abra a ImobFlow para conferir.', tag: 'imobflow-incoming', silent: false });
      notice.onclick = () => { window.focus(); notice.close(); };
    } catch { /* Some browsers allow permission but reject desktop notifications; UI inbox remains authoritative. */ }
  }, [inbox, enabled, ready, demonstration]);
  async function toggle() {
    if (enabled) { setEnabled(false); setStatus('Alertas deste painel desativados.'); return; }
    if (typeof Notification === 'undefined' || !window.isSecureContext) { setStatus('Este navegador não oferece alertas de sistema. A caixa de entrada continua mostrando as novas mensagens.'); return; }
    setAsking(true);
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (!live.current) return;
      if (permission !== 'granted') { setStatus('Alertas bloqueados. Se desejar, permita notificações nas configurações do navegador.'); return; }
      baseline.current = new Map(inbox.map(item => [item.conversationId, item.incomingCount]));
      enabledAt.current = Date.now(); setEnabled(true); setStatus('Ativos enquanto esta aba de conversas estiver aberta. A entrega depende do navegador e do sistema.');
    } catch { if (live.current) setStatus('Não foi possível ativar os alertas. Sua caixa de entrada não foi alterada.'); }
    finally { if (live.current) setAsking(false); }
  }
  if (demonstration || isProductDemo()) return null;
  return <div className={s.alerts}><button type="button" className={s.alertButton} aria-pressed={enabled} disabled={!ready || asking} onClick={() => void toggle()}>{asking ? 'Verificando permissão…' : enabled ? 'Alertas ativados' : 'Ativar alertas'}<span>Com a aba de conversas aberta</span></button>{status && <p role="status">{status}</p>}</div>;
}
