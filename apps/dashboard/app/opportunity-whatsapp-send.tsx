'use client';
import { useEffect, useRef, useState } from 'react';
import { dashboardFetch as fetch } from '@/lib/dashboard-transport';
import { announceDashboardChange } from '@/lib/dashboard-sync';
import s from './opportunity-photos.module.css';
type Receipt = { id: string; delivery_status: string; delivery_error_code: number | null };
export default function OpportunityWhatsAppSend({ opportunityId, message, images }: { opportunityId: string; message: string; images: string[] }) {
  const [review, setReview] = useState<{ recipient: string; phone: string; sender: string; fingerprint: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [batch, setBatch] = useState<{ requestId: string; count: number } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const requestKeys = useRef(new Map<string,string>());
  const fingerprint = JSON.stringify({ opportunityId, content: message, images });
  useEffect(() => {
    if (!batch) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const response = await fetch(`/api/opportunities/send?requestId=${batch.requestId}`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json() as { error?: string; data: Receipt[] };
        if (!response.ok) throw new Error(body.error);
        if (controller.signal.aborted) return;
        setReceipts(body.data);
        if (body.data.length === batch.count && body.data.every((item: Receipt) => ['delivered','read','failed'].includes(item.delivery_status))) return;
      } catch { if (!controller.signal.aborted) setError('Não foi possível atualizar a confirmação. Confira o andamento na aba Conversas; não repita o envio.'); }
      if (!controller.signal.aborted && ++attempts < 40) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [batch]);
  async function prepare() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/opportunities/send?opportunityId=${opportunityId}`, { cache: 'no-store' });
      const body = await response.json() as { error?: string; data: { recipient: string; phone: string; sender: string } };
      if (!response.ok) throw new Error(body.error);
      setReview({ ...body.data, fingerprint });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível conferir a conexão.'); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (busy || !review || review.fingerprint !== fingerprint) return;
    const requestId = requestKeys.current.get(fingerprint) || crypto.randomUUID();
    requestKeys.current.set(fingerprint,requestId);
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/opportunities/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(fingerprint), requestId, confirmed: true }) });
      const body = await response.json() as { error?: string; data: { requestId: string; count: number } };
      if (!response.ok) throw new Error(body.error);
      setBatch(body.data); setReview(null); announceDashboardChange('conversations');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Sem confirmação. Confira Conversas antes de tentar novamente.'); }
    finally { setBusy(false); }
  }
  return <div className={s.direct}>
    {!batch && !review && <div className={s.actions}><button type="button" className={s.primary} disabled={busy || !message.trim()} onClick={() => void prepare()}>{busy ? 'Conferindo conexão…' : `Enviar pelo WhatsApp da imobiliária${images.length ? ` · ${images.length} foto(s)` : ''}`}</button></div>}
    {review && <div className={s.confirm} role="region" aria-label="Confirmar envio WhatsApp"><strong>Confirmar envio</strong><p>Para: {review.recipient} · +{review.phone}<br/>Remetente: {review.sender}<br/>Uma mensagem de texto e {images.length} foto(s), enviadas separadamente.</p><p className={s.previewText}>{message}</p>{review.fingerprint !== fingerprint && <p role="alert">O texto ou as fotos mudaram. Confira novamente antes de enviar.</p>}<div className={s.actions}><button type="button" disabled={busy || review.fingerprint !== fingerprint} onClick={() => void confirm()}>{busy ? 'Registrando envio…' : 'Confirmar e enviar agora'}</button><button type="button" disabled={busy} onClick={() => setReview(null)}>Voltar</button></div></div>}
    {batch && <div role="status"><strong>Envio registrado: {batch.count} mensagem(ns)</strong><p>A fila aceita pela ImobFlow não é confirmação de entrega. Confira o resultado de cada mensagem:</p><ul>{receipts.length ? receipts.map((item,index) => <li key={item.id}>{index === 0 ? 'Texto' : `Foto ${index}`}: {{pending:'na fila',sent:'aceita pelo WhatsApp; aguardando entrega',delivered:'entregue',read:'lida',failed:'falhou ou requer conferência em Conversas'}[item.delivery_status] || 'aguardando confirmação'}</li>) : <li>Aguardando atualização do envio…</li>}</ul><p>Consulte o histórico em Conversas. Não repita as mensagens já enviadas.</p></div>}
    {error && <p className={s.error} role="alert">{error}</p>}
  </div>;
}
