'use client';

import { useRef, useState } from 'react';
import { canAccess, type Actor, type CrmCommand, type CrmRecord, type CrmState } from '@/lib/evolution/model';
import { parseComparables, propertyPriceReview, valuation, type Comparable } from '@/lib/evolution/property-workflows';
import PropertyFeedbackPanel from './property-feedback-panel';
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

export function PropertyVisitStartPanel({ record, state, actor, busy, execute, onSelect, demonstration = false }: { record: CrmRecord; state: CrmState; actor: Actor; busy: boolean; execute: Props['execute']; onSelect?: (id: string) => void; demonstration?: boolean }) {
  const [caseId, setCaseId] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const request = useRef<{ caseId: string; propertyId: string; id: string } | null>(null);
  if (record.kind !== 'properties') return null;
  const cases = state.records.filter(item => item.kind === 'cases' && item.data.status === 'Aberto' && item.data.journey !== 'Captação' && item.data.purpose === record.data.purpose && canAccess(state, actor, item, 'write'));
  const available = ['Disponível', 'Reservado'].includes(String(record.data.status));
  const visits = state.records.filter(item => item.kind === 'tasks' && item.data.type === 'Visita' && item.data.propertyId === record.id && item.data.visitStartedAt && !item.data.visitEndedAt && ['Confirmada', 'Pendente'].includes(String(item.data.status)) && canAccess(state, actor, item, 'write'));
  return <section className={s.panel} aria-label="Visitar este imóvel"><h3>Visitar este imóvel</h3><p>Escolha um cliente que já está no seu atendimento e registre o início da visita.</p>
    {visits.map(visit => <div className={s.reference} key={visit.id}><strong>{String(visit.data.name)}</strong><p>Em andamento desde {dateTime(visit.data.visitStartedAt)}</p><VisitWorkflowPanel record={visit} state={state} canEdit busy={busy} execute={execute} demonstration={demonstration} /></div>)}
    {available ? <form onSubmit={async event => {
      event.preventDefault(); if (!caseId || busy || inFlight.current) return;
      inFlight.current = true; setError('');
      if (!request.current || request.current.caseId !== caseId || request.current.propertyId !== record.id) request.current = { caseId, propertyId: record.id, id: crypto.randomUUID() };
      try { if (await execute({ type: 'visit-start', caseId, propertyId: record.id, requestId: request.current.id })) { const id = record.legacy ? `appointment:${request.current.id}` : request.current.id; request.current = null; setCaseId(''); onSelect?.(id); } }
      catch { setError('Não foi possível confirmar o início. Atualize antes de tentar novamente.'); }
      finally { inFlight.current = false; }
    }}><label>Cliente / atendimento<select required disabled={busy || cases.length === 0} value={caseId} onChange={event => setCaseId(event.target.value)}><option value="">Escolha um atendimento existente</option>{cases.map(item => <option key={item.id} value={item.id}>{String(state.records.find(person => person.id === item.data.personId)?.data.name || item.data.name)} · {String(item.data.name)}</option>)}</select></label><div className={s.actions}><button className={s.primary} disabled={busy || !caseId}>Iniciar visita</button></div>{!cases.length && <p>Você ainda não possui atendimento aberto compatível com este imóvel.</p>}</form> : <p>Este imóvel não está disponível para novas visitas.</p>}
    {error && <p role="alert" className={s.error}>{error}</p>}
  </section>;
}

export function VisitWorkflowPanel({ record, canEdit, busy, execute, demonstration = false }: Props & { demonstration?: boolean }) {
  const [feedback, setFeedback] = useState(String(record.data.clientFeedback || ''));
  const inFlight = useRef(false);
  if (record.kind !== 'tasks' || record.data.type !== 'Visita') return null;
  const started = Boolean(record.data.visitStartedAt), finished = Boolean(record.data.visitEndedAt);
  const active = ['Pendente', 'Confirmada'].includes(String(record.data.status));
  async function progress(action: 'start' | 'finish') {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    try { await execute({ type: 'visit-progress', id: record.id, action, ...(action === 'finish' ? { feedback } : {}) }); }
    finally { inFlight.current = false; }
  }
  return <section className={s.panel} aria-label="Registro da visita"><h3>Registro da visita</h3><p>Início e encerramento ficam no histórico. Ao encerrar, você recebe o link para enviar a avaliação ao cliente.</p>
    <div className={s.times}><span>Início<strong>{dateTime(record.data.visitStartedAt)}</strong></span><span>Encerramento<strong>{dateTime(record.data.visitEndedAt)}</strong></span></div>
    {canEdit && active && !started && <button className={s.primary} disabled={busy} onClick={() => void progress('start')}>Iniciar visita</button>}
    {canEdit && active && started && !finished ? <form onSubmit={async event => { event.preventDefault(); await progress('finish'); }}><details><summary>Adicionar observação (opcional)</summary><label>Observação da visita<textarea rows={2} maxLength={6000} value={feedback} disabled={busy} onChange={e => setFeedback(e.target.value)} placeholder="Algo que deseja guardar sobre esta visita…" /></label></details><div className={s.actions}><button className={s.primary} disabled={busy}>Encerrar visita</button></div></form> : record.data.clientFeedback ? <p className={s.readOnly}>{String(record.data.clientFeedback)}</p> : !active && <p>Visita {String(record.data.status).toLocaleLowerCase('pt-BR')}. Os registros anteriores foram preservados.</p>}
    {finished && Boolean(record.data.caseId) && <PropertyFeedbackPanel key={record.id} caseId={String(record.data.caseId)} visitId={record.id} disabled={!canEdit || busy} demonstration={demonstration} />}
  </section>;
}
