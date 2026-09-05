export type LeadLifecycleStatus = 'Novo' | 'Em atendimento' | 'Visita' | 'Proposta' | 'Convertido' | 'Perdido';
export type RecoveryPotential = 'Alto' | 'Médio' | 'Baixo';

export type LeadProfile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  goal: string;
  propertyType: string;
  region: string;
  budget: string;
  details: string | null;
  summary: string;
  score: number;
  temperature: string;
  source: string;
  assignedTo: string | null;
  lifecycleStatus: LeadLifecycleStatus;
  lastContactAt: string | null;
  inactivityDays: number | null;
  recoveryPotential: RecoveryPotential;
  scoreReasons: string[];
  recoverySelected: boolean;
  createdAt: string;
};

export type LeadInput = {
  name: string;
  phone: string;
  email: string | null;
  goal: string;
  propertyType: string;
  region: string;
  budget: string;
  details: string | null;
  source?: string;
  assignedTo?: string | null;
  lifecycleStatus?: LeadLifecycleStatus;
  lastContactAt?: string | null;
  recoverySelected?: boolean;
};

function isKnown(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== 'não informado' && normalized !== 'nao informado' && normalized !== '-');
}

export function explainProfile(input: LeadInput): string {
  const goal = isKnown(input.goal) ? input.goal.toLowerCase() : 'avaliar opções';
  const property = isKnown(input.propertyType) ? ` um ${input.propertyType.toLowerCase()}` : '';
  const region = isKnown(input.region) ? ` em ${input.region}` : '';
  const budget = isKnown(input.budget) ? `, com orçamento de ${input.budget}` : '';
  const detail = input.details ? ` Pontos importantes: ${input.details}.` : '';
  return `${input.name} deseja ${goal}${property}${region}${budget}.${detail}`;
}

export function daysSinceContact(lastContactAt: string | null | undefined, referenceDate = new Date()): number | null {
  if (!lastContactAt) return null;
  const date = new Date(lastContactAt);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((referenceDate.getTime() - date.getTime()) / 86_400_000));
}

export function analyzeLead(input: LeadInput, referenceDate = new Date()) {
  const reasons: string[] = [];
  let score = 15;

  if (input.phone) { score += 15; reasons.push('Telefone disponível'); }
  if (input.email) { score += 5; reasons.push('E-mail disponível'); }
  if (isKnown(input.goal)) { score += 12; reasons.push('Objetivo definido'); }
  if (isKnown(input.propertyType)) { score += 10; reasons.push('Tipo de imóvel definido'); }
  if (isKnown(input.region)) { score += 10; reasons.push('Região definida'); }
  if (isKnown(input.budget)) { score += 15; reasons.push('Faixa de investimento informada'); }
  if (input.details && input.details.trim().length >= 12) { score += 8; reasons.push('Preferências detalhadas'); }

  const inactivityDays = daysSinceContact(input.lastContactAt, referenceDate);
  if (inactivityDays === null) reasons.push('Sem histórico de contato');
  else if (inactivityDays <= 7) { score += 10; reasons.push('Contato nos últimos 7 dias'); }
  else if (inactivityDays <= 30) { score += 7; reasons.push('Contato recente'); }
  else if (inactivityDays <= 90) { score += 2; reasons.push(`Sem contato há ${inactivityDays} dias`); }
  else { score -= 5; reasons.push(`Inativo há ${inactivityDays} dias`); }

  if (input.lifecycleStatus === 'Visita') { score += 6; reasons.push('Visita em andamento'); }
  if (input.lifecycleStatus === 'Proposta') { score += 10; reasons.push('Proposta em andamento'); }
  if (input.lifecycleStatus === 'Perdido') { score -= 12; reasons.push('Marcado como perdido'); }

  const bounded = Math.max(10, Math.min(98, score));
  const inactive = inactivityDays === null || inactivityDays >= 30;
  const closed = input.lifecycleStatus === 'Convertido' || input.lifecycleStatus === 'Perdido';
  const recoveryPotential: RecoveryPotential = !closed && inactive && bounded >= 65
    ? 'Alto'
    : !closed && inactive && bounded >= 45 ? 'Médio' : 'Baixo';

  return {
    score: bounded,
    temperature: bounded >= 80 ? 'Muito quente' : bounded >= 65 ? 'Quente' : bounded >= 45 ? 'Morno' : 'Frio',
    inactivityDays,
    recoveryPotential,
    scoreReasons: reasons,
  };
}

export function scoreLead(input: LeadInput): { score: number; temperature: string } {
  const { score, temperature } = analyzeLead(input);
  return { score, temperature };
}
