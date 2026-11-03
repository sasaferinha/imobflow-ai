'use client';
import { useEffect, useState } from 'react';
import s from './feedback.module.css';

export default function FeedbackForm({ token }: { token: string }) {
  const [info, setInfo] = useState<{ propertyName: string; submitted: boolean } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [visitScore, setVisitScore] = useState('');
  const [propertyScore, setPropertyScore] = useState('');
  const [interest, setInterest] = useState('');
  const [comment, setComment] = useState('');
  useEffect(() => {
    let current = true;
    fetch(`/api/property-feedback/${encodeURIComponent(token)}`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(async response => { const body = await response.json() as { propertyName: string; submitted: boolean; error?: string }; if (!response.ok) throw new Error(body.error || 'Link indisponível.'); return body; })
      .then(body => { if (current) setInfo(body); }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token]);
  return <main className={s.page}><article className={s.card}><span className={s.brand}>IMOBFLOW</span>
    {loading ? <p role="status">Carregando sua avaliação…</p> : info?.submitted ? <><h1>Obrigado pela sua opinião!</h1><p>Sua avaliação foi registrada e está disponível para a equipe responsável pelo atendimento.</p></> : <>
      <h1>Como foi sua experiência?</h1>{info && <><p>Sua opinião ajuda a equipe a melhorar o atendimento e encontrar o imóvel certo para você.</p><div className={s.property}>{info.propertyName}</div>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          const response = await fetch(`/api/property-feedback/${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, referrerPolicy: 'no-referrer', body: JSON.stringify({ visitScore: Number(visitScore), propertyScore: Number(propertyScore), interest, comment }) });
          const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || 'Não foi possível registrar.');
          setInfo({ ...info, submitted: true });
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>
        <label>Como você avalia a visita?<select required value={visitScore} disabled={busy} onChange={e => setVisitScore(e.target.value)}><option value="">Selecione uma nota</option><option value="0">Não realizei visita</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {['Muito ruim', 'Ruim', 'Regular', 'Boa', 'Excelente'][n - 1]}</option>)}</select></label>
        <label>Como você avalia o imóvel?<select required value={propertyScore} disabled={busy} onChange={e => setPropertyScore(e.target.value)}><option value="">Selecione uma nota</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Excelente'][n - 1]}</option>)}</select></label>
        <label>O imóvel atende ao que você procura?<select required value={interest} disabled={busy} onChange={e => setInterest(e.target.value)}><option value="">Selecione</option>{['Sim', 'Talvez', 'Não'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>O que gostou e o que poderia melhorar? <small>Opcional</small><textarea rows={4} maxLength={2000} disabled={busy} value={comment} onChange={e => setComment(e.target.value)} placeholder="Conte sobre a localização, o preço, o estado do imóvel ou o atendimento." /></label>
        <p className={s.notice}>Sua resposta será compartilhada com a equipe que realizou seu atendimento.</p>
        <button disabled={busy}>{busy ? 'Enviando…' : 'Enviar avaliação'}</button>
      </form></>}{error && <p role="alert" className={s.error}>{error}</p>}
    </>}
  </article></main>;
}
