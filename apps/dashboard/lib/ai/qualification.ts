import type { AILeadProfile, LeadProfileExtraction } from './provider';

export type InterestProfile = {
  purpose?: 'Venda' | 'Aluguel'; propertyType?: string; city?: string; regions?: string[];
  budgetMax?: number; bedrooms?: number; parkingSpaces?: number; features?: string[];
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

export function qualificationQuestion(p: InterestProfile): string {
  if (!p.purpose) return 'Você está procurando um imóvel para comprar ou alugar?';
  if (!p.propertyType) return 'Qual tipo de imóvel você procura: apartamento, casa ou outro?';
  if (!p.city) return 'Em qual cidade você está procurando?';
  if (!p.regions?.length) return 'Quais bairros ou regiões você prefere?';
  if (!p.budgetMax) return 'Qual é o valor máximo que pretende investir?';
  if (p.bedrooms == null) return 'De quantos quartos você precisa?';
  if (p.parkingSpaces == null) return 'Quantas vagas de garagem você precisa?';
  return 'Obrigado! Suas preferências foram registradas para o corretor avaliar as opções com você.';
}

export function isSimpleGreeting(message: string) {
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|obrigad[oa]|ok|👍)[!.\s]*$/i.test(message.trim());
}
