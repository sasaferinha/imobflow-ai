import { analyzeLead, type LeadProfile } from './leads';
import type { PropertyRecord } from './operations';
import { newPropertyCandidates } from './property-matching';

export const automationFlows = [
  { id: 'followup', name: 'Lembrete após 48 horas', detail: 'Cria uma tarefa interna após 48 horas sem contato registrado. Não envia mensagens.' },
  { id: 'priority', name: 'Aviso de lead prioritário', detail: 'Cria um alerta interno para leads com pontuação a partir de 80.' },
  { id: 'new-property', name: 'Novo imóvel compatível', detail: 'Cruza novos imóveis com o perfil dos leads e prepara uma mensagem personalizada para cada oportunidade.' },
] as const;
export type FlowId = typeof automationFlows[number]['id'];
export const isFlowId = (value: unknown): value is FlowId => automationFlows.some((flow) => flow.id === value);
export type AutomationCandidate = { leadId: string; version: string; summary: string; detail: Record<string, unknown> };

export function evaluateAutomation(flow: FlowId, lead: LeadProfile, properties: PropertyRecord[], now = new Date()): AutomationCandidate | null {
  if (!isFlowId(flow)) return null;
  if (flow === 'new-property') return newPropertyCandidates(lead, properties, now)[0] || null;
  if (lead.scoreDefined === false) return null;
  const analysis = analyzeLead(lead, now);
  if (lead.lifecycleStatus === 'Convertido' || lead.lifecycleStatus === 'Perdido') return null;
  if (flow === 'priority') {
    if (analysis.score < 80) return null;
    return { leadId: lead.id, version: JSON.stringify({ score: analysis.score, contact: lead.lastContactAt, owner: lead.assignedTo, stage: lead.lifecycleStatus }), summary: `${lead.name}: prioridade ${analysis.score}/100`, detail: { assignedTo: lead.assignedTo, reasons: analysis.scoreReasons } };
  }
  if (flow === 'followup') {
    const base = lead.lastContactAt || lead.createdAt;
    const due = new Date(base).getTime() + 48 * 60 * 60 * 1000;
    if (!Number.isFinite(due) || now.getTime() < due || !['Novo', 'Em atendimento'].includes(lead.lifecycleStatus)) return null;
    return { leadId: lead.id, version: base, summary: `${lead.name}: revisar contato pendente`, detail: { dueAt: new Date(due).toISOString(), contactVersion: base, assignedTo: lead.assignedTo, note: 'Confira se houve resposta em outros canais antes de contatar. Nenhuma mensagem enviada.' } };
  }
  return null;
}
