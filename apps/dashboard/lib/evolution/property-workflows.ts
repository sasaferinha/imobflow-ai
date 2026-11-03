import type { CrmRecord, Value } from './model';
import type { Field } from './schema';

export const PROPERTY_WORKFLOW_FIELDS: Field[] = [
  { key: 'capturedAt', label: 'Data da captação', type: 'date' },
  { key: 'captureCondition', label: 'Estado de conservação', type: 'textarea' },
  { key: 'captureDocumentation', label: 'Documentos conferidos e pendências', type: 'textarea' },
  { key: 'captureReport', label: 'Relatório da captação', type: 'textarea' },
  { key: 'valuationComparables', label: 'Referências da avaliação', type: 'textarea' },
  { key: 'valuationAdjustment', label: 'Ajuste da avaliação (%)', type: 'number', min: -30 },
  { key: 'valuationNotes', label: 'Justificativa da avaliação', type: 'textarea' },
];
export const VISIT_WORKFLOW_FIELDS: Field[] = [
  { key: 'visitStartedAt', label: 'Visita iniciada em', type: 'datetime-local' },
  { key: 'visitEndedAt', label: 'Visita encerrada em', type: 'datetime-local' },
  { key: 'clientFeedback', label: 'Relato do cliente sobre a visita', type: 'textarea' },
];
// These fields have their own structured editor; visit times are server-generated.
export const workflowFieldKeys = new Set(['valuationComparables', 'visitStartedAt', 'visitEndedAt']);
export type Comparable = { source: string; area: number; price: number; observedOn: string };
export type VisitProgressCommand = { type: 'visit-progress'; id: string; action: 'start' | 'finish'; feedback?: string };

const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function parseComparables(value: unknown): Comparable[] {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' || value.length > 6000) throw new Error('Referências da avaliação inválidas.');
  let rows: unknown;
  try { rows = JSON.parse(value); } catch { throw new Error('Revise as referências da avaliação.'); }
  if (!Array.isArray(rows) || rows.length > 10) throw new Error('Use até 10 referências na avaliação.');
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some(key => !['source', 'area', 'price', 'observedOn'].includes(key))
      || typeof row.source !== 'string' || !row.source.trim() || row.source.trim().length > 300
      || typeof row.area !== 'number' || !Number.isFinite(row.area) || row.area <= 0 || row.area > 1e7
      || typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price <= 0 || row.price > 1e12
      || typeof row.observedOn !== 'string' || !validDay(row.observedOn)) throw new Error('Cada referência precisa de fonte, data, área e preço válidos.');
    return { source: row.source.trim(), area: row.area, price: row.price, observedOn: row.observedOn };
  });
}

export function valuation(record: CrmRecord) {
  const rows = parseComparables(record.data.valuationComparables);
  const area = Number(record.data.area), adjustment = Number(record.data.valuationAdjustment || 0);
  if (rows.length < 3 || !Number.isFinite(area) || area <= 0 || !Number.isFinite(adjustment) || Math.abs(adjustment) > 30) return null;
  const unitValues = rows.map(row => row.price / row.area).sort((a, b) => a - b);
  const middle = Math.floor(unitValues.length / 2);
  const median = unitValues.length % 2 ? unitValues[middle] : (unitValues[middle - 1] + unitValues[middle]) / 2;
  const factor = area * (1 + adjustment / 100);
  return { count: rows.length, perSquareMeter: median, estimate: Math.round(median * factor), low: Math.round(unitValues[0] * factor), high: Math.round(unitValues.at(-1)! * factor) };
}

export function propertyPriceReview(record: CrmRecord, now = new Date().toISOString()) {
  if (record.kind !== 'properties' || !['Disponível', 'Reservado'].includes(String(record.data.status))) return null;
  const start = Date.parse(String(record.data.capturedAt || record.createdAt));
  const days = Math.floor((Date.parse(now) - start) / 86400000);
  if (!Number.isFinite(days) || days < 365) return null;
  let estimate: ReturnType<typeof valuation> = null;
  try { estimate = valuation(record); } catch { /* An old malformed draft must not break the catalog. */ }
  const aboveComparison = Boolean(estimate && Number(record.data.price) > estimate.high);
  return { days, aboveComparison, message: aboveComparison
    ? 'Imóvel há mais de 1 ano na carteira e acima da faixa das referências informadas. Revise o preço com o proprietário.'
    : 'Imóvel há mais de 1 ano na carteira. Reavalie o preço e a estratégia de divulgação com o proprietário.' };
}

export function validatePropertyWorkflow(record: CrmRecord, previous?: CrmRecord): string | null {
  const d = record.data;
  if (record.kind === 'properties') {
    try { parseComparables(d.valuationComparables); } catch (error) { return (error as Error).message; }
    const adjustment = Number(d.valuationAdjustment || 0);
    if (!Number.isFinite(adjustment) || Math.abs(adjustment) > 30) return 'O ajuste da avaliação deve ficar entre -30% e 30%.';
    if (adjustment && !String(d.valuationNotes || '').trim()) return 'Justifique o ajuste da avaliação.';
    if (d.capturedAt && !validDay(String(d.capturedAt))) return 'Informe uma data de captação válida.';
  }
  if (record.kind === 'tasks') {
    for (const key of ['visitStartedAt', 'visitEndedAt']) {
      if ((d[key] || '') !== (previous?.data[key] || '')) return 'Use Iniciar visita ou Encerrar visita para registrar os horários.';
    }
    if (previous?.data.visitStartedAt && (d.type !== previous.data.type || d.propertyId !== previous.data.propertyId || d.caseId !== previous.data.caseId)) return 'O imóvel e o cliente de uma visita iniciada são preservados.';
    if (previous?.data.visitEndedAt && d.status !== 'Realizada') return 'Uma visita encerrada permanece realizada; registre correções no histórico.';
    if (previous?.data.visitStartedAt && !previous.data.visitEndedAt && d.status === 'Realizada') return 'Encerre a visita e registre o relato do cliente.';
  }
  return null;
}

/** The caller must authenticate, check write access, validate business rules and audit this data atomically. */
export function visitProgressData(record: CrmRecord, command: VisitProgressCommand, now: string): Record<string, Value> {
  if (Object.keys(command).some(key => !['type', 'id', 'action', 'feedback'].includes(key))
    || command.type !== 'visit-progress' || command.id !== record.id || !['start', 'finish'].includes(command.action)
    || !Number.isFinite(Date.parse(now))) throw new Error('Registro de visita inválido.');
  if (record.kind !== 'tasks' || record.data.type !== 'Visita' || !record.data.propertyId) throw new Error('Selecione uma visita vinculada a um imóvel.');
  if (record.data.visitEndedAt || !['Pendente', 'Confirmada'].includes(String(record.data.status))) throw new Error('Esta visita já foi encerrada ou cancelada.');
  if (command.action === 'start') {
    if (record.data.visitStartedAt) throw new Error('Esta visita já foi iniciada.');
    return { visitStartedAt: now, status: 'Confirmada' };
  }
  if (!record.data.visitStartedAt) throw new Error('Inicie a visita antes de encerrá-la.');
  if (Date.parse(now) < Date.parse(String(record.data.visitStartedAt))) throw new Error('O encerramento deve ser posterior ao início.');
  if (typeof command.feedback !== 'string' || !command.feedback.trim() || command.feedback.trim().length > 6000) throw new Error('Registre o que o cliente achou do imóvel (até 6.000 caracteres).');
  return { visitEndedAt: now, status: 'Realizada', clientFeedback: command.feedback.trim(), reason: command.feedback.trim().slice(0, 500) };
}
