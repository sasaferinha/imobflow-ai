'use client';
/* eslint-disable @next/next/no-img-element -- the company logo may use its own public HTTPS host */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import s from './feedback.module.css';

type FeedbackInfo = { propertyName: string; submitted: boolean; brandName: string; logoUrl: string; primaryColor: string; visitEndedAt: string | null };
const ratings = ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'];
export default function FeedbackForm({ token }: { token: string }) {
  const [info, setInfo] = useState<FeedbackInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [propertyScore, setPropertyScore] = useState(0);
  const [comment, setComment] = useState('');
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/property-feedback/${encodeURIComponent(token)}`, { cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
      .then(async response => { const body = await response.json() as FeedbackInfo & { error?: string }; if (!response.ok) throw new Error(body.error || 'Link indisponível.'); return body; })
      .then(body => { if (!controller.signal.aborted) setInfo(body); }).catch(e => { if (!controller.signal.aborted) setError((e as Error).message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token]);
  return <main className={s.page} style={{ '--feedback-brand': info?.primaryColor || '#147bb6' } as CSSProperties}><article className={s.card}>
    <div className={s.brand}>{info?.logoUrl && <img src={info.logoUrl} alt="" referrerPolicy="no-referrer" width={48} height={48} />}<span>{info?.brandName || 'Avaliação do imóvel'}</span></div>
    {loading ? <p role="status">Carregando sua avaliação…</p> : info?.submitted ? <div role="status"><span className={s.check} aria-hidden="true">✓</span><h1>Obrigado pela sua opinião!</h1><p>A equipe recebeu sua avaliação e poderá usar seu retorno no atendimento.</p></div> : <>
      <h1>O que achou do imóvel?</h1>{info && <><p>É rápido: escolha uma nota e, se quiser, conte um pouco mais.</p><div className={s.property}>{info.propertyName}{info.visitEndedAt && <small>Visita registrada em {new Date(info.visitEndedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</small>}</div>
      <form onSubmit={async event => {
        event.preventDefault(); if (inFlight.current || !propertyScore) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
          const response = await fetch(`/api/property-feedback/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, referrerPolicy: 'no-referrer', body: JSON.stringify({ propertyScore, comment }) });
          const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || 'Não foi possível registrar.');
          setInfo({ ...info, submitted: true });
        } catch (e) { setError((e as Error).message); } finally { inFlight.current = false; setBusy(false); }
      }}>
        <fieldset className={s.rating} disabled={busy}><legend>Sua nota para o imóvel</legend><div className={s.stars}>{[1, 2, 3, 4, 5].map(n => <label key={n} className={n <= propertyScore ? s.selectedStar : ''}><input type="radio" name="property-rating" required value={n} checked={propertyScore === n} onChange={() => setPropertyScore(n)} aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'} — ${ratings[n - 1]}`} /><span aria-hidden="true">★</span></label>)}</div><p className={s.ratingHint} aria-live="polite">{propertyScore ? `${propertyScore}/5 · ${ratings[propertyScore - 1]}` : 'Toque nas estrelas para avaliar'}</p></fieldset>
        <label>Observação <small>Opcional</small><textarea rows={3} maxLength={2000} disabled={busy} value={comment} onChange={e => setComment(e.target.value)} placeholder="O que gostou? O que poderia melhorar?" /></label>
        <p className={s.notice}>Sua opinião será compartilhada com a equipe responsável pelo atendimento.</p>
        <button disabled={busy || !propertyScore}>{busy ? 'Enviando…' : 'Enviar avaliação'}</button>
      </form></>}{error && <p role="alert" className={s.error}>{error}</p>}
    </>}
    <footer className={s.footer}>Atendimento com ImobFlow</footer>
  </article></main>;
}
