'use client';

import { useEffect, useRef, useState } from 'react';
import { isProductDemo } from '@/lib/dashboard-transport';
import { dutyPriorityBlocked, type ConversationInboxItem } from '@/lib/conversation-inbox';
import { REMINDER_MINUTES, reminderDue } from '@/lib/panel-reminders';
import s from './conversation-assistant.module.css';

/** Opt-in, current tab only. No customer name or message content in system notifications. */
export default function ConversationAlerts({ inbox = [], ready = true, demonstration = false }: { inbox?: ConversationInboxItem[]; ready?: boolean; demonstration?: boolean }) {
  const [enabled, setEnabled] = useState(false), [status, setStatus] = useState(''), [asking, setAsking] = useState(false);
  const [minutes, setMinutes] = useState<number>(15);
  const baseline = useRef(new Map<string, number>()), enabledAt = useRef(0), live = useRef(true);
  const lastAlert = useRef(0);
  const currentInbox = useRef(inbox);
  const deferredArrivals = useRef(new Map<string, number>());
  useEffect(() => { currentInbox.current = inbox; }, [inbox]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (!enabled || !ready || demonstration || isProductDemo()) return;
    let arrivals = 0;
    for (const item of inbox) {
      const previous = baseline.current.get(item.conversationId);
      if (dutyPriorityBlocked(item, Date.now())) {
        if (previous != null && item.incomingCount > previous && item.unread > 0) deferredArrivals.current.set(item.conversationId, (deferredArrivals.current.get(item.conversationId) || 0) + item.incomingCount - previous);
        else if (previous == null && item.unread > 0 && Date.parse(item.lastMessageAt) >= enabledAt.current) deferredArrivals.current.set(item.conversationId, item.unread);
        baseline.current.set(item.conversationId, Math.max(previous || 0, item.incomingCount));
        continue;
      }
      arrivals += Math.min(item.unread, deferredArrivals.current.get(item.conversationId) || 0);
      deferredArrivals.current.delete(item.conversationId);
      if (previous != null && item.incomingCount > previous && item.unread > 0) arrivals += Math.min(item.unread, item.incomingCount - previous);
      else if (previous == null && item.unread > 0 && Date.parse(item.lastMessageAt) >= enabledAt.current) arrivals += item.unread;
      baseline.current.set(item.conversationId, Math.max(previous || 0, item.incomingCount));
    }
    if (!arrivals || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    lastAlert.current = Date.now();
    try {
      const notice = new Notification('ImobFlow · nova mensagem', { body: 'Há novas mensagens na caixa de entrada. Abra a ImobFlow para conferir.', tag: 'imobflow-incoming', silent: false });
      notice.onclick = () => { window.focus(); notice.close(); };
    } catch { /* Some browsers allow permission but reject desktop notifications; UI inbox remains authoritative. */ }
  }, [inbox, enabled, ready, demonstration]);
  useEffect(() => {
    if (!enabled || !ready || demonstration || isProductDemo()) return;
    const check = () => {
      const pending = currentInbox.current.reduce((total, item) => total + (dutyPriorityBlocked(item, Date.now()) ? 0 : Math.max(0, item.unread)), 0);
      if (!pending) { lastAlert.current = Date.now(); return; }
      if (!reminderDue(lastAlert.current, Date.now(), minutes) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      lastAlert.current = Date.now();
      try {
        const notice = new Notification('ImobFlow · atendimento pendente', { body: `Há ${pending} mensagem(ns) não lida(s). Abra a caixa de entrada para continuar o atendimento.`, tag: 'imobflow-incoming', silent: false });
        notice.onclick = () => { window.focus(); notice.close(); };
      } catch { /* Unread counters remain visible if the system blocks the alert. */ }
    };
    const timer = window.setInterval(check, 60000);
    return () => window.clearInterval(timer);
  }, [enabled, ready, demonstration, minutes]);
  async function toggle() {
    if (enabled) { setEnabled(false); setStatus('Alertas deste painel desativados.'); return; }
    if (typeof Notification === 'undefined' || !window.isSecureContext) { setStatus('Este navegador não oferece alertas de sistema. A caixa de entrada continua mostrando as novas mensagens.'); return; }
    setAsking(true);
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (!live.current) return;
      if (permission !== 'granted') { setStatus('Alertas bloqueados. Se desejar, permita notificações nas configurações do navegador.'); return; }
      baseline.current = new Map(inbox.map(item => [item.conversationId, item.incomingCount]));
      deferredArrivals.current.clear();
      enabledAt.current = Date.now(); lastAlert.current = Date.now(); setEnabled(true); setStatus('Novas mensagens geram um aviso. Mensagens não lidas geram lembretes no intervalo escolhido, enquanto esta aba estiver aberta.');
    } catch { if (live.current) setStatus('Não foi possível ativar os alertas. Sua caixa de entrada não foi alterada.'); }
    finally { if (live.current) setAsking(false); }
  }
  if (demonstration || isProductDemo()) return null;
  return <div className={s.alerts}><button type="button" className={s.alertButton} aria-pressed={enabled} disabled={!ready || asking} onClick={() => void toggle()}>{asking ? 'Verificando permissão…' : enabled ? 'Alertas ativados' : 'Ativar alertas'}<span>Com a aba de conversas aberta</span></button><label className={s.alertInterval}>Lembrar não lidas a cada<select aria-label="Intervalo de lembrete de mensagens" value={minutes} disabled={asking} onChange={event => { setMinutes(Number(event.target.value)); lastAlert.current = Date.now(); }}>{REMINDER_MINUTES.map(value => <option key={value} value={value}>{value} minutos</option>)}</select></label>{status && <p role="status">{status}</p>}</div>;
}
