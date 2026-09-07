import { analyzeLead, explainProfile, type LeadProfile } from './leads';
import type { PropertyRecord } from './operations';

export const automationFlows = [
  { id: 'qualification', name: 'Qualificação automática', detail: 'Atualiza o resumo, a pontuação e os motivos de prioridade dos leads.' },
  { id: 'recommendations', name: 'Recomendação de imóveis', detail: 'Separa imóveis por finalidade e região para revisão do corretor.' },
  { id: 'followup', name: 'Lembrete após 48 horas', detail: 'Cria uma tarefa interna após 48 horas sem contato registrado. Não envia mensagens.' },
  { id: 'priority', name: 'Aviso de lead prioritário', detail: 'Cria um alerta interno para leads com pontuação a partir de 80.' },
] as const;
export type FlowId = typeof automationFlows[number]['id'];
export const isFlowId = (value: unknown): value is FlowId => automationFlows.some((flow) => flow.id === value);
export type AutomationCandidate = { leadId: string; version: string; summary: string; detail: Record<string, unknown> };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function evaluateAutomation(flow: FlowId, lead: LeadProfile, properties: PropertyRecord[], now = new Date()): AutomationCandidate | null {
  const analysis = analyzeLead(lead, now);
  const source = { goal: lead.goal, propertyType: lead.propertyType, region: lead.region, budget: lead.budget, details: lead.details, lastContactAt: lead.lastContactAt, lifecycleStatus: lead.lifecycleStatus, assignedTo: lead.assignedTo };
  if (flow === 'qualification') {
    return { leadId: lead.id, version: JSON.stringify({ source, analysis, name: lead.name }), summary: `${lead.name}: ${analysis.score}/100 — ${analysis.temperature}`, detail: { ...analysis, summary: explainProfile(lead) } };
  }
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
  const goal = normalize(lead.goal);
  const purpose = /alug|loca/.test(goal) ? 'Aluguel' : /compr/.test(goal) ? 'Venda' : null;
  const regions = normalize(lead.region).split(/[,;/]/).map((part) => part.trim()).filter((part) => part.length > 2 && part !== 'nao informado');
  if (!purpose || !regions.length) return null;
  const matches = properties.filter((property) => property.purpose === purpose && regions.some((region) => normalize(property.district) === region))
    .slice(0, 5).map((property) => ({ id: property.id, title: property.title, price: property.price, district: property.district, purpose: property.purpose }));
  if (!matches.length) return null;
  return { leadId: lead.id, version: JSON.stringify({ source, matches }), summary: `${lead.name}: ${matches.length} imóvel(is) na região desejada`, detail: { matches, budget: lead.budget, propertyType: lead.propertyType, note: 'Pré-seleção por região e finalidade. Validar preço, tipo e disponibilidade com o corretor antes de apresentar.' } };
}
