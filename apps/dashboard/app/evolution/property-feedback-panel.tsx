'use client';
import { useState } from 'react';
import s from './property-workflows.module.css';
type Feedback = { id: string; propertyName: string; expiresAt: string; submittedAt: string | null; visitScore: number | null; propertyScore: number | null; interest: string | null; comment: string | null; deliveryStatus: string | null; url: string | null };
const deliveryLabels: Record<string, string> = { pending: 'Na fila do WhatsApp', sending: 'Enviando pelo WhatsApp', sent: 'Enviado ao WhatsApp', failed: 'Envio falhou', uncertain: 'Entrega não confirmada', cancelled: 'Envio cancelado' };
export default function PropertyFeedbackPanel({ caseId, disabled = false, demonstration = false }: { caseId: string; disabled?: boolean; demonstration?: boolean }) {
  const [requests, setRequests] = useState<Feedback[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function load(create = false, send = false) {
    if (demonstration) { setMessage('A pesquisa pública estará disponível na operação real, após uma visita ou negociação concluída.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(create ? '/api/property-feedback' : `/api/property-feedback?caseId=${encodeURIComponent(caseId)}`, create ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, send }) } : { cache: 'no-store' });
      const body = await response.json() as { requests: Feedback[]; reason?: string; error?: string }; if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a avaliação.');
      setRequests(body.requests); setMessage(body.reason || '');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className={s.panel} aria-label="Avaliação do cliente"><h3>Avaliação do cliente</h3><p>Após uma visita ou negociação concluída, o cliente pode avaliar a visita e o imóvel por um link individual, válido por 90 dias. O envio automático depende de uma conversa WhatsApp atribuída e da janela de atendimento aberta.</p>
    <div className={s.actions}><button disabled={busy} onClick={() => void load()}>Consultar avaliações</button>{!disabled && <><button disabled={busy} onClick={() => void load(true)}>Obter link da avaliação</button><button className={s.primary} disabled={busy} onClick={() => void load(true, true)}>Enviar pelo WhatsApp</button></>}</div>
    {requests?.length === 0 && <p>Nenhuma avaliação solicitada para este atendimento.</p>}
    {requests?.map(row => <div className={s.reference} key={row.id}><strong>{row.propertyName}</strong>{row.submittedAt ? <><p>Visita: {row.visitScore === 0 ? 'Não realizada' : `${row.visitScore}/5`} · Imóvel: {row.propertyScore}/5 · Atende ao que procura: {row.interest}</p><p className={s.readOnly}>{row.comment || 'Sem comentário adicional.'}</p><small>Recebida em {new Date(row.submittedAt).toLocaleString('pt-BR')}</small></> : <><p>{row.deliveryStatus ? deliveryLabels[row.deliveryStatus] || row.deliveryStatus : 'Link criado; envio ainda não confirmado.'} · Validade: {new Date(row.expiresAt).toLocaleDateString('pt-BR')}</p>{row.url && <><label>Link individual<input readOnly value={row.url} onFocus={e => e.target.select()} /></label><div className={s.actions}><button onClick={async () => { try { await navigator.clipboard.writeText(row.url!); setMessage('Link copiado.'); } catch { setError('Selecione e copie o link no campo acima.'); } }}>Copiar link</button></div></>}</>}</div>)}
    {message && <p className={s.success} role="status">{message}</p>}{error && <p className={s.error} role="alert">{error}</p>}
  </section>;
}
