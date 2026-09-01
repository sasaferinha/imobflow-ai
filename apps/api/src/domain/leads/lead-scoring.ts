import type { LeadProfile } from './lead-profile.js';

export const DEFAULT_LEAD_SCORE_RULES = {
  budgetDefined: 15,
  regionDefined: 10,
  propertyTypeDefined: 10,
  timelineUnderSixMonths: 15,
  timelineUnderThirtyDaysAdditional: 10,
  paymentMethodDefined: 10,
  financingPreApproved: 15,
  interactedWithProperty: 10,
  requestedVisit: 25,
} as const;

export type LeadScoreRules = { [Key in keyof typeof DEFAULT_LEAD_SCORE_RULES]: number };
export type LeadTemperature = 'COLD' | 'WARM' | 'HOT' | 'VERY_HOT';

export interface LeadScoreResult {
  score: number;
  temperature: LeadTemperature;
  appliedRules: Array<{ rule: keyof LeadScoreRules; points: number }>;
}

export function calculateLeadScore(
  profile: LeadProfile,
  rules: LeadScoreRules = DEFAULT_LEAD_SCORE_RULES,
): LeadScoreResult {
  const appliedRules: LeadScoreResult['appliedRules'] = [];
  const apply = (condition: boolean, rule: keyof LeadScoreRules): void => {
    if (condition) appliedRules.push({ rule, points: rules[rule] });
  };

  apply(profile.minPrice !== undefined || profile.maxPrice !== undefined, 'budgetDefined');
  apply(Boolean(profile.city || profile.neighborhoods?.length), 'regionDefined');
  apply(profile.propertyType !== undefined, 'propertyTypeDefined');
  apply(profile.purchaseTimelineDays !== undefined && profile.purchaseTimelineDays < 183, 'timelineUnderSixMonths');
  apply(profile.purchaseTimelineDays !== undefined && profile.purchaseTimelineDays < 30, 'timelineUnderThirtyDaysAdditional');
  apply(profile.paymentMethod !== undefined, 'paymentMethodDefined');
  apply(profile.financingPreApproved === true, 'financingPreApproved');
  apply(profile.interactedPropertyId !== undefined, 'interactedWithProperty');
  apply(profile.requestedVisit === true, 'requestedVisit');

  const score = Math.min(100, Math.max(0, appliedRules.reduce((total, item) => total + item.points, 0)));
  return { score, temperature: temperatureFor(score), appliedRules };
}

export function temperatureFor(score: number): LeadTemperature {
  if (score <= 30) return 'COLD';
  if (score <= 60) return 'WARM';
  if (score <= 80) return 'HOT';
  return 'VERY_HOT';
}
