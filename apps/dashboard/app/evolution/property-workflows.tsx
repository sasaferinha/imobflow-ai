'use client';

import { useState } from 'react';
import type { CrmCommand, CrmRecord, CrmState } from '@/lib/evolution/model';
import { parseComparables, propertyPriceReview, valuation, type Comparable } from '@/lib/evolution/property-workflows';
import s from './property-workflows.module.css';

type Props = { record: CrmRecord; state?: CrmState; canEdit: boolean; busy: boolean; execute: (command: CrmCommand) => Promise<boolean> };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const localDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Não registrada';
const captureKeys = ['capturedAt', 'captureCondition', 'captureDocumentation', 'captureReport'] as const;
const newReference = (): Comparable => ({ source: '', area: 0, price: 0, observedOn: localDay() });

export function PropertyPriceAlert({ record }: { record: CrmRecord }) {
  const review = propertyPriceReview(record);
  return review ? <div className={s.alert} role="status">{review.message}</div> : null;
}

export function PropertyWorkflowPanel({ record, canEdit, busy, execute }: Props) {
  const [capture, setCapture] = useState(() => Object.fromEntries(captureKeys.map(key => [key, String(record.data[key] || '')])));
  const [references, setReferences] = useState<Comparable[]>(() => { try { return parseComparables(record.data.valuationComparables); } catch { return []; } });
  const [adjustment, setAdjustment] = useState(String(record.data.valuationAdjustment || 0));
  const [notes, setNotes] = useState(String(record.data.valuationNotes || ''));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  if (record.kind !== 'properties') return null;
  const draft = { ...record, data: { ...record.data, valuationComparables: JSON.stringify(references), valuationAdjustment: adjustment, valuationNotes: notes } };
  let estimate: ReturnType<typeof valuation> = null;
  try { estimate = valuation(draft); } catch { /* Incomplete draft remains editable. */ }
  const updateReference = (index: number, patch: Partial<Comparable>) => { setSaved(''); setReferences(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); };
  return <>
    <PropertyPriceAlert record={record} />
    <section className={s.panel} aria-label="Ficha de captação">
      <h3>Ficha de captação</h3><p>Registre a vistoria, a condição do imóvel e o que ainda precisa ser conferido com o proprietário.</p>
      <form onSubmit={async event => { event.preventDefault(); setError(''); setSaved(''); if (await execute({ type: 'save', kind: 'properties', id: record.id, data: capture })) setSaved('Ficha de captação salva.'); }}>
        <div className={s.grid}>
          <label>Data da captação<input type="date" max={localDay()} disabled={!canEdit || busy} value={capture.capturedAt} onChange={e => { setSaved(''); setCapture({ ...capture, capturedAt: e.target.value }); }} /></label>
          <label>Estado de conservação<textarea rows={3} maxLength={6000} disabled={!canEdit || busy} value={capture.captureCondition} onChange={e => { setSaved(''); setCapture({ ...capture, captureCondition: e.target.value }); }} /></label>
          <label>Documentos conferidos e pendências<textarea rows={3} maxLength={6000} disabled={!canEdit || busy} value={capture.captureDocumentation} onChange={e => { setSaved(''); setCapture({ ...capture, captureDocumentation: e.target.value }); }} /></label>
          <label>Relatório do imóvel<textarea rows={3} maxLength={6000} disabled={!canEdit || busy} value={capture.captureReport} placeholder="Diferenciais, reparos, autorização de divulgação e próximos passos…" onChange={e => { setSaved(''); setCapture({ ...capture, captureReport: e.target.value }); }} /></label>
        </div>{canEdit && <div className={s.actions}><button className={s.primary} disabled={busy}>Salvar ficha de captação</button></div>}
      </form>
    </section>
    <section className={s.panel} aria-label="Avaliação comparativa do imóvel">
      <h3>Avaliação comparativa</h3><p>Informe ao menos 3 imóveis da mesma região, tipo e finalidade. A estimativa usa a mediana do preço por m² e a área deste imóvel ({Number(record.data.area) || 'não informada'} m²). Para aluguel, use os valores mensais. A faixa reflete apenas as referências informadas; não é um laudo de avaliação.</p>
      <form onSubmit={async event => {
        event.preventDefault(); setError(''); setSaved('');
        try { parseComparables(JSON.stringify(references)); } catch (e) { setError((e as Error).message); return; }
        if (await execute({ type: 'save', kind: 'properties', id: record.id, data: { valuationComparables: JSON.stringify(references), valuationAdjustment: Number(adjustment || 0), valuationNotes: notes } })) setSaved('Referências da avaliação salvas.');
      }}>
        {references.map((row, index) => <fieldset className={s.reference} key={index} disabled={!canEdit || busy}><legend>Referência {index + 1}</legend><div className={s.grid}>
          <label>Fonte ou link<input required maxLength={300} value={row.source} onChange={e => updateReference(index, { source: e.target.value })} /></label>
          <label>Data da pesquisa<input type="date" required value={row.observedOn} max={localDay()} onChange={e => updateReference(index, { observedOn: e.target.value })} /></label>
          <label>Área (m²)<input type="number" required min="0.01" max="10000000" step="0.01" value={row.area || ''} onChange={e => updateReference(index, { area: Number(e.target.value) })} /></label>
          <label>{record.data.purpose === 'Aluguel' ? 'Aluguel mensal (R$)' : 'Preço (R$)'}<input type="number" required min="0.01" max="1000000000000" step="0.01" value={row.price || ''} onChange={e => updateReference(index, { price: Number(e.target.value) })} /></label>
        </div>{canEdit && <div className={s.actions}><button type="button" onClick={() => { setSaved(''); setReferences(rows => rows.filter((_, i) => i !== index)); }}>Remover referência</button></div>}</fieldset>)}
        {canEdit && <div className={s.actions}><button type="button" disabled={busy || references.length >= 10} onClick={() => { setSaved(''); setReferences(rows => [...rows, newReference()]); }}>Adicionar referência</button></div>}
        <div className={s.grid} style={{ marginTop: 14 }}><label>Ajuste por conservação e diferenças (%)<input type="number" min="-30" max="30" step="0.1" disabled={!canEdit || busy} value={adjustment} onChange={e => { setSaved(''); setAdjustment(e.target.value); }} /></label><label>Justificativa e observações<textarea rows={2} maxLength={6000} required={Number(adjustment) !== 0} disabled={!canEdit || busy} value={notes} onChange={e => { setSaved(''); setNotes(e.target.value); }} /></label></div>
        {estimate ? <div className={s.estimate}><span>Estimativa {record.data.purpose === 'Aluguel' ? 'de aluguel mensal' : 'de venda'}</span><strong>{money.format(estimate.estimate)}</strong><small>Faixa das referências: {money.format(estimate.low)} a {money.format(estimate.high)} · {estimate.count} imóveis · {money.format(estimate.perSquareMeter)}/m² antes do ajuste.</small><small>Alterar as referências não modifica o preço anunciado.</small></div> : <p>Adicione 3 referências completas e informe a área na ficha do imóvel para calcular a estimativa.</p>}
        {canEdit && <div className={s.actions}><button className={s.primary} disabled={busy}>Salvar avaliação</button></div>}
      </form>{error && <div className={s.error} role="alert">{error}</div>}{saved && <div className={s.success} role="status">{saved}</div>}
    </section>
  </>;
}

export function VisitWorkflowPanel({ record, canEdit, busy, execute }: Props) {
  const [feedback, setFeedback] = useState(String(record.data.clientFeedback || ''));
  if (record.kind !== 'tasks' || record.data.type !== 'Visita') return null;
  const started = Boolean(record.data.visitStartedAt), finished = Boolean(record.data.visitEndedAt);
  const active = ['Pendente', 'Confirmada'].includes(String(record.data.status));
  return <section className={s.panel} aria-label="Registro da visita"><h3>Registro da visita</h3><p>Os horários são registrados no momento da ação e ficam no histórico do atendimento. Registre abaixo o relato do cliente sobre o imóvel.</p>
    <div className={s.times}><span>Início<strong>{dateTime(record.data.visitStartedAt)}</strong></span><span>Encerramento<strong>{dateTime(record.data.visitEndedAt)}</strong></span></div>
    {canEdit && active && !started && <button className={s.primary} disabled={busy} onClick={() => void execute({ type: 'visit-progress', id: record.id, action: 'start' })}>Iniciar visita</button>}
    {canEdit && active && started && !finished ? <form onSubmit={async event => { event.preventDefault(); await execute({ type: 'visit-progress', id: record.id, action: 'finish', feedback }); }}><label>O que o cliente achou do imóvel?<textarea required rows={4} maxLength={6000} value={feedback} disabled={busy} onChange={e => setFeedback(e.target.value)} placeholder="O que gostou, objeções ao preço, condições do imóvel e próximo passo…" /></label><div className={s.actions}><button className={s.primary} disabled={busy || !feedback.trim()}>Encerrar visita e salvar relato</button></div></form> : record.data.clientFeedback ? <p className={s.readOnly}>{String(record.data.clientFeedback)}</p> : !active && <p>Visita {String(record.data.status).toLocaleLowerCase('pt-BR')}. Os registros anteriores foram preservados.</p>}
  </section>;
}
