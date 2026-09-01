import type { LeadProfile } from '../leads/lead-profile.js';
import type { PropertyRecord, PropertySearchFilters, RankedProperty } from './property.js';

export const DEFAULT_MATCH_WEIGHTS = {
  exactNeighborhood: 30,
  withinBudget: 25,
  bedrooms: 20,
  propertyType: 15,
  features: 10,
} as const;

export type MatchWeights = { [Key in keyof typeof DEFAULT_MATCH_WEIGHTS]: number };

export function profileToPropertyFilters(profile: LeadProfile, limit = 5): PropertySearchFilters {
  return {
    ...(profile.transactionType ? { transactionType: profile.transactionType } : {}),
    ...(profile.propertyType ? { propertyType: profile.propertyType } : {}),
    ...(profile.city ? { city: profile.city } : {}),
    ...(profile.state ? { state: profile.state } : {}),
    ...(profile.neighborhoods?.length ? { neighborhoods: profile.neighborhoods } : {}),
    ...(profile.minPrice !== undefined ? { minPrice: profile.minPrice } : {}),
    ...(profile.maxPrice !== undefined ? { maxPrice: profile.maxPrice } : {}),
    ...(profile.minBedrooms !== undefined ? { minBedrooms: profile.minBedrooms } : {}),
    ...(profile.minBathrooms !== undefined ? { minBathrooms: profile.minBathrooms } : {}),
    ...(profile.minParkingSpaces !== undefined ? { minParkingSpaces: profile.minParkingSpaces } : {}),
    ...(profile.minAreaM2 !== undefined ? { minAreaM2: profile.minAreaM2 } : {}),
    ...(profile.paymentMethod === 'FINANCING' ? { acceptsFinancing: true } : {}),
    ...(profile.features?.length ? { features: profile.features } : {}),
    limit,
  };
}

export function propertyMatchesFilters(property: PropertyRecord, filters: PropertySearchFilters): boolean {
  if (!property.available || property.status !== 'ACTIVE') return false;
  if (filters.transactionType && property.transactionType !== filters.transactionType) return false;
  if (filters.propertyType && property.propertyType !== filters.propertyType) return false;
  if (filters.city && normalize(property.city) !== normalize(filters.city)) return false;
  if (filters.state && property.state.toUpperCase() !== filters.state.toUpperCase()) return false;
  if (filters.neighborhoods?.length && !filters.neighborhoods.some((item) => normalize(item) === normalize(property.neighborhood))) return false;
  if (filters.minPrice !== undefined && property.price < filters.minPrice) return false;
  if (filters.maxPrice !== undefined && property.price > filters.maxPrice) return false;
  if (filters.minBedrooms !== undefined && property.bedrooms < filters.minBedrooms) return false;
  if (filters.minBathrooms !== undefined && property.bathrooms < filters.minBathrooms) return false;
  if (filters.minParkingSpaces !== undefined && property.parkingSpaces < filters.minParkingSpaces) return false;
  if (filters.minAreaM2 !== undefined && property.areaM2 < filters.minAreaM2) return false;
  if (filters.furnished !== undefined && property.furnished !== filters.furnished) return false;
  if (filters.acceptsFinancing !== undefined && property.acceptsFinancing !== filters.acceptsFinancing) return false;
  if (filters.features?.length && !filters.features.some((feature) => includesNormalized(property.features, feature))) return false;
  return true;
}

export function rankProperties(
  properties: PropertyRecord[],
  filters: PropertySearchFilters,
  weights: MatchWeights = DEFAULT_MATCH_WEIGHTS,
): RankedProperty[] {
  return properties
    .map((property) => scoreProperty(property, filters, weights))
    .sort((left, right) => right.score - left.score || left.property.price - right.property.price)
    .slice(0, filters.limit);
}

export function scoreProperty(property: PropertyRecord, filters: PropertySearchFilters, weights: MatchWeights): RankedProperty {
  let score = 0;
  const reasons: string[] = [];
  if (filters.neighborhoods?.some((item) => normalize(item) === normalize(property.neighborhood))) {
    score += weights.exactNeighborhood;
    reasons.push('bairro compatível');
  }
  if ((filters.minPrice === undefined || property.price >= filters.minPrice) && (filters.maxPrice === undefined || property.price <= filters.maxPrice)) {
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      score += weights.withinBudget;
      reasons.push('dentro do orçamento');
    }
  }
  if (filters.minBedrooms !== undefined && property.bedrooms >= filters.minBedrooms) {
    score += weights.bedrooms;
    reasons.push('quantidade de quartos');
  }
  if (filters.propertyType && property.propertyType === filters.propertyType) {
    score += weights.propertyType;
    reasons.push('tipo de imóvel');
  }
  if (filters.features?.length) {
    const matched = filters.features.filter((feature) => includesNormalized(property.features, feature)).length;
    if (matched > 0) {
      score += Math.round(weights.features * (matched / filters.features.length));
      reasons.push('características desejadas');
    }
  }
  return { property, score: Math.min(100, score), reasons };
}

function includesNormalized(values: string[], expected: string): boolean {
  const needle = normalize(expected);
  return values.some((value) => normalize(value).includes(needle) || needle.includes(normalize(value)));
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
