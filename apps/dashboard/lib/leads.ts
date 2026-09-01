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
  createdAt: string;
};

export type LeadInput = Omit<LeadProfile, 'id' | 'summary' | 'score' | 'temperature' | 'createdAt'>;

export function explainProfile(input: LeadInput): string {
  const detail = input.details ? ` Pontos importantes informados: ${input.details}.` : '';
  return `${input.name} deseja ${input.goal.toLowerCase()} um ${input.propertyType.toLowerCase()} em ${input.region}, com orçamento de ${input.budget}.${detail}`;
}

export function scoreLead(input: LeadInput): { score: number; temperature: string } {
  let score = 42;
  if (input.phone) score += 12;
  if (input.email) score += 6;
  if (input.region) score += 10;
  if (input.budget) score += 12;
  if (input.details) score += Math.min(12, Math.ceil(input.details.length / 20));
  const bounded = Math.min(96, score);
  return { score: bounded, temperature: bounded >= 80 ? 'Muito quente' : bounded >= 60 ? 'Quente' : 'Morno' };
}
