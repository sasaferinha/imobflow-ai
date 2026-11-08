'use client';
import { useEffect, useRef, useState } from 'react';
import s from './property-workflows.module.css';

type Feedback = { id: string; propertyName: string; visitId: string | null; visitEndedAt: string | null; brokerName: string | null; expiresAt: string; submittedAt: string | null; visitScore: number | null; propertyScore: number | null; interest: string | null; comment: string | null; deliveryStatus: string | null; url: string | null };
type VisitOption = { id: string; name: string; endedAt: string };
type Result = { requests: Feedback[]; visits?: VisitOption[]; reason?: string; error?: string };
const formatDate = (value: string) => new Date(value).toLocaleString('pt-BR');
export default function PropertyFeedbackPanel({ caseId, visitId, disabled = false, demonstration = false, autoLoad = true }: { caseId: string; visitId?: string; disabled?: boolean; demonstration?: boolean; autoLoad?: boolean }) {
  const [requests, setRequests] = useState<Feedback[] | null>(null);
  const [visits, setVisits] = useState<VisitOption[]>([]);
  const [selected, setSelected] = useState(visitId || '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const url = `/api/property-feedback?caseId=${encodeURIComponent(caseId)}${visitId ? `&visitId=${encodeURIComponent(visitId)}` : ''}`;
  useEffect(() => {
    if (!autoLoad || demonstration) return;
    const controller = new AbortController();
    fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const body = await response.json() as Result;
      if (!response.ok) throw new Error(body.error || 'Não foi possível consultar as avaliações.');
      if (!controller.signal.aborted) { setRequests(body.requests); setVisits(body.visits || []); }
    }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });
    return () => controller.abort();
  }, [url, autoLoad, demonstration]);
  async function load(create = false) {
    if (demonstration) { setMessage('Demonstração: nenhuma pesquisa ou mensagem é enviada. Na operação real, o link aparece ao encerrar a visita.'); return; }
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(create ? '/api/property-feedback' : url, create ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId, visitId: visitId || selected || undefined, send: false }) } : { cache: 'no-store' });
      const body = await response.json() as Result;
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar a avaliação.');
      setRequests(body.requests); if (body.visits) setVisits(body.visits); setMessage(body.reason || '');
    } catch (e) { setError((e as Error).message); } finally { inFlight.current = false; setBusy(false); }
  }
  return <section className={s.panel} aria-label="Avaliação do cliente"><h3>Avaliação do imóvel</h3><p>Copie o link e envie quando desejar. O cliente responde com estrelas e uma observação opcional.</p>
    {!visitId && visits.length > 0 && <label>Visita que será avaliada<select value={selected} disabled={busy || disabled} onChange={event => setSelected(event.target.value)}><option value="">Escolha a visita</option>{visits.map(visit => <option key={visit.id} value={visit.id}>{visit.name} · {formatDate(visit.endedAt)}</option>)}</select></label>}
    <div className={s.actions}><button disabled={busy} onClick={() => void load()}>Atualizar avaliações</button>{!disabled && <button className={s.primary} disabled={busy || !visitId && visits.length > 1 && !selected} onClick={() => void load(true)}>Obter link da avaliação</button>}</div>
    {requests?.length === 0 && <p>O link desta visita ainda não foi criado. Use “Obter link da avaliação”.</p>}
    {requests?.map(row => <div className={s.reference} key={row.id}><strong>{row.propertyName}</strong>{row.visitEndedAt && <p>Visita encerrada em {formatDate(row.visitEndedAt)}{row.brokerName ? ` · ${row.brokerName}` : ''}</p>}{row.submittedAt ? <><p aria-label={`Nota do imóvel: ${row.propertyScore} de 5`}>{'★'.repeat(row.propertyScore || 0)}{'☆'.repeat(5 - (row.propertyScore || 0))} · {row.propertyScore}/5</p>{row.interest && <p>Interesse informado: {row.interest}</p>}<p className={s.readOnly}>{row.comment || 'Sem observação adicional.'}</p><small>Avaliação recebida em {formatDate(row.submittedAt)}. A resposta registra uma opinião, não comprova presença física no imóvel.</small></> : <><p>Envie manualmente · Válido até {new Date(row.expiresAt).toLocaleDateString('pt-BR')}</p>{row.url && <><label>Link individual<input readOnly value={row.url} onFocus={e => e.target.select()} /></label><div className={s.actions}><button onClick={async () => { try { await navigator.clipboard.writeText(row.url!); setMessage('Link copiado. Cole na conversa do cliente para enviar.'); } catch { setError('Selecione e copie o link no campo acima.'); } }}>Copiar link</button></div></>}</>}</div>)}
    {message && <p className={s.success} role="status">{message}</p>}{error && <p className={s.error} role="alert">{error}</p>}
  </section>;
}
