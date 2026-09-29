import type { AILeadProfile, LeadProfileExtraction } from './provider';

export type InterestProfile = {
  purpose?: 'Venda' | 'Aluguel'; propertyType?: string; city?: string; regions?: string[];
  budgetMax?: number; bedrooms?: number; parkingSpaces?: number; features?: string[];
  financingIntent?: 'Sim' | 'Não' | 'Indeciso';
  intendedUse?: 'Morar' | 'Investir'; preferencesRecorded?: boolean; preferenceNotes?: string;
  summaryConfirmed?: boolean; correctionRequested?: boolean;
  correctionField?: 'purpose' | 'propertyType' | 'city' | 'regions' | 'budgetMax' | 'bedrooms' | 'parkingSpaces' | 'financingIntent' | null;
};
const propertyNames: Record<string, string> = { APARTMENT: 'Apartamento', HOUSE: 'Casa', LAND: 'Terreno', COMMERCIAL: 'Comercial' };

export function extractedPreferences(extraction: LeadProfileExtraction): InterestProfile {
  if (!Number.isFinite(extraction.confidence) || extraction.confidence < 0.85) return {};
  const p = extraction.extractedFields;
  return {
    ...(p.transactionType ? { purpose: p.transactionType === 'BUY' ? 'Venda' as const : 'Aluguel' as const } : {}),
    ...(p.propertyType && propertyNames[p.propertyType] ? { propertyType: propertyNames[p.propertyType] } : {}),
    ...(p.city?.trim() ? { city: p.city.trim() } : {}),
    ...(p.neighborhoods?.length ? { regions: p.neighborhoods } : {}),
    ...(p.maxPrice && p.maxPrice > 0 ? { budgetMax: p.maxPrice } : {}),
    ...(p.minBedrooms != null ? { bedrooms: p.minBedrooms } : {}),
    ...(p.minParkingSpaces != null ? { parkingSpaces: p.minParkingSpaces } : {}),
    ...(p.features?.length ? { features: p.features } : {}),
  };
}

export function toAIProfile(p: InterestProfile): AILeadProfile {
  return { ...(p.purpose ? { transactionType: p.purpose === 'Venda' ? 'BUY' as const : 'RENT' as const } : {}),
    ...(p.propertyType ? { propertyType: (Object.keys(propertyNames).find(key => propertyNames[key] === p.propertyType) || 'OTHER') as AILeadProfile['propertyType'] } : {}),
    ...(p.city ? { city: p.city } : {}), ...(p.regions?.length ? { neighborhoods: p.regions } : {}),
    ...(p.budgetMax ? { maxPrice: p.budgetMax } : {}), ...(p.bedrooms != null ? { minBedrooms: p.bedrooms } : {}),
    ...(p.parkingSpaces != null ? { minParkingSpaces: p.parkingSpaces } : {}), ...(p.features?.length ? { features: p.features } : {}) };
}

export const QUALIFICATION_COMPLETE_MESSAGE = 'Muito obrigado pelas informações! Estarei te encaminhando para um de nossos corretores.';
export const PURPOSE_QUESTION = 'Você procura algo para morar ou investir? Quer comprar ou alugar?';
export const FINANCING_QUESTION = 'Você pretende financiar ou comprar à vista? Se ainda não decidiu, pode me dizer.';
export const OPTIONAL_PREFERENCES_QUESTION = 'Tem algo indispensável para você? Por exemplo: quartos, garagem, quintal ou acessibilidade. Se não tiver ou ainda não souber, podemos seguir.';
export const FINANCING_SIMULATOR_URL = 'https://www.imobflow.net.br/simulador-financiamento';
export const CORRECTION_QUESTION = 'O que você deseja corrigir? Pode me dizer o campo e a nova informação, por exemplo: “bairro: Centro”.';

function correctionQuestion(p: InterestProfile) {
  switch (p.correctionField) {
    case 'purpose': return 'Você quer comprar ou alugar agora?';
    case 'propertyType': return 'Qual tipo de imóvel você prefere agora?';
    case 'city': return 'Qual é a cidade correta?';
    case 'regions': return 'Quais bairros ou regiões você prefere agora?';
    case 'budgetMax': return p.purpose === 'Aluguel' ? 'Qual é o novo limite mensal de aluguel?' : 'Qual é o novo limite do seu orçamento?';
    case 'bedrooms': return 'Quantos quartos você procura agora?';
    case 'parkingSpaces': return 'De quantas vagas de garagem você precisa agora?';
    case 'financingIntent': return FINANCING_QUESTION;
    default: return CORRECTION_QUESTION;
  }
}

export function qualificationQuestion(p: InterestProfile): string {
  if (p.correctionRequested) return correctionQuestion(p);
  if (!p.purpose) return PURPOSE_QUESTION;
  if (!p.propertyType) return 'Você procura casa, apartamento, terreno, galpão ou outro tipo de imóvel?';
  if (!p.city) return 'Em qual cidade você está procurando?';
  if (!p.regions?.length) return 'Em quais bairros ou regiões você procura? Pode me dizer mais de uma opção.';
  if (!p.budgetMax) return p.purpose === 'Aluguel' ? 'Qual valor mensal de aluguel você procura?' : 'Até quanto você pretende investir no imóvel?';
  if (p.purpose === 'Venda' && !['Sim','Não','Indeciso'].includes(p.financingIntent || '')) return FINANCING_QUESTION;
  if (!p.preferencesRecorded && p.bedrooms == null && p.parkingSpaces == null && !p.features?.length) return OPTIONAL_PREFERENCES_QUESTION;
  if (!p.summaryConfirmed) return qualificationSummary(p);
  return QUALIFICATION_COMPLETE_MESSAGE;
}

export function qualificationSummary(p: InterestProfile) {
  const budget = p.budgetMax && p.budgetMax > 0 ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(p.budgetMax) : null;
  // Notes retain details the parser cannot structure (e.g. accessibility).
  // When counts are corrected later, present the current counts instead of
  // letting the original free-text note contradict the saved preferences.
  const notes = p.preferenceNotes?.replace(/\b(?:\d{1,2}|zero|um|uma|dois|duas|três|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(quartos?|dormitórios?|dormitorios?|vagas?(?: de garagem)?)(?![\p{L}\p{M}])/giu, (original, unit: string, offset: number, text: string) => {
    const prefix = text.slice(0, offset).split(/[,;.!]|\bmas\b/iu).at(-1) || '';
    if (/\b(?:não|nao|sem|nem)\b/iu.test(prefix)) return original;
    const parking = /^vaga/iu.test(unit);
    const value = parking ? p.parkingSpaces : p.bedrooms;
    if (value == null) return original;
    return value === 0 ? parking ? 'sem necessidade de garagem' : 'sem preferência de quartos' : `${value} ${parking ? value === 1 ? 'vaga' : 'vagas' : value === 1 ? 'quarto' : 'quartos'}`;
  }).replace(/\bsem (?:vaga(?:s)?(?: de garagem)?|garagem)\b/giu, (original) => p.parkingSpaces != null && p.parkingSpaces > 0 ? `${p.parkingSpaces} ${p.parkingSpaces === 1 ? 'vaga' : 'vagas'}` : original);
  const extras = notes || [p.bedrooms != null ? p.bedrooms === 0 ? 'sem preferência de quartos' : `${p.bedrooms} ${p.bedrooms === 1 ? 'quarto' : 'quartos'}` : '', p.parkingSpaces != null ? p.parkingSpaces === 0 ? 'sem necessidade de garagem' : `${p.parkingSpaces} ${p.parkingSpaces === 1 ? 'vaga' : 'vagas'}` : '', ...(p.features || [])].filter(Boolean).join(', ');
  const lines: string[] = [];
  const add = (label: string, value: string | undefined | null) => {
    if (value?.trim()) lines.push(`• ${label}: ${value.replace(/\s+/g, ' ').trim()}`);
  };
  add('Objetivo', p.purpose === 'Aluguel' ? 'alugar' : p.purpose === 'Venda' ? p.intendedUse === 'Investir' ? 'comprar como investimento' : p.intendedUse === 'Morar' ? 'comprar para morar' : 'comprar' : undefined);
  add('Imóvel', p.propertyType?.toLocaleLowerCase('pt-BR'));
  add('Cidade', p.city);
  add('Bairros ou regiões', p.regions?.join(', '));
  add('Orçamento', budget ? `até ${budget}${p.purpose === 'Aluguel' ? ' por mês' : ''}` : undefined);
  if (p.purpose === 'Venda') add('Pagamento', p.financingIntent === 'Sim' ? 'financiamento' : p.financingIntent === 'Não' ? 'à vista' : p.financingIntent === 'Indeciso' ? 'a definir' : undefined);
  add('Preferências', extras?.replace(/[.!]+$/, ''));
  return `Só para confirmar:\n\n${lines.join('\n')}\n\nEstá certo?`;
}

export function financingAnswer(message: string, profile: InterestProfile): InterestProfile['financingIntent'] {
  if(profile.purpose === 'Aluguel') return undefined;
  const text=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[.!]+$/,'');
  if(text.includes('?') || /\b(ignore|instrucao|instrucoes|sistema)\b/.test(text))return undefined;
  const explicitChoice=/^(?:financiar|financiamento|compra financiada|comprar financiado)(?: por favor)?$/.test(text)
    || /\b(?:quero|vou|pretendo|preciso|desejo|prefiro|gostaria de|tenho interesse em) (?:financiar|fazer (?:um )?financiamento)\b|\bpreciso de financiamento\b/.test(text);
  // Financing is a purchase choice; an isolated "sim" is not a choice here.
  if(!profile.purpose) return explicitChoice && !/\b(nao|talvez|se|ou)\b/.test(text) ? 'Sim' : undefined;
  const waiting=qualificationQuestion(profile)===FINANCING_QUESTION;
  if(waiting && /^(ainda )?(nao sei|nao decidi|estou pensando|talvez)$/.test(text))return 'Indeciso';
  if(/^(?:(?:vou|quero|pretendo) pagar |vou |quero |pretendo |pagarei |pagar |pagamento )?a vista$|^sem financiamento$/.test(text) || /\bnao (?:quero|vou|pretendo|preciso(?: de)?) (?:financiar|financiamento|fazer (?:um )?financiamento)\b/.test(text))return 'Não';
  if(/\b(nao|talvez|se|ou)\b/.test(text))return waiting && /^(nao|nao obrigado|nao obrigada)$/.test(text) ? 'Não' : undefined;
  if(explicitChoice)return 'Sim';
  if(waiting && /^(sim|sim por favor|quero|financiar|financiamento)$/.test(text))return 'Sim';
  return undefined;
}

export function isSimpleGreeting(message: string) {
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|obrigad[oa]|ok|👍)[!.\s]*$/i.test(message.trim());
}
