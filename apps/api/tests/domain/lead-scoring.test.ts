import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAD_SCORE_RULES,
  calculateLeadScore,
  temperatureFor,
} from '../../src/domain/leads/lead-scoring.js';

describe('calculateLeadScore', () => {
  it('returns a cold zero score when the profile has no qualifying signals', () => {
    expect(calculateLeadScore({})).toEqual({
      score: 0,
      temperature: 'COLD',
      appliedRules: [],
    });
  });

  it('applies every explicit signal and caps the total score at 100', () => {
    const result = calculateLeadScore({
      city: 'São Paulo',
      propertyType: 'APARTMENT',
      maxPrice: 1_000_000,
      purchaseTimelineDays: 29,
      paymentMethod: 'FINANCING',
      financingPreApproved: true,
      interactedPropertyId: 'property-1',
      requestedVisit: true,
    });

    expect(result.score).toBe(100);
    expect(result.temperature).toBe('VERY_HOT');
    expect(result.appliedRules).toEqual(
      Object.entries(DEFAULT_LEAD_SCORE_RULES).map(([rule, points]) => ({ rule, points })),
    );
  });

  it.each([
    { days: 183, expectedRules: [] },
    { days: 30, expectedRules: ['timelineUnderSixMonths'] },
    {
      days: 29,
      expectedRules: ['timelineUnderSixMonths', 'timelineUnderThirtyDaysAdditional'],
    },
  ] as const)('uses strict timeline boundaries for $days days', ({ days, expectedRules }) => {
    const result = calculateLeadScore({ purchaseTimelineDays: days });

    expect(result.appliedRules.map(({ rule }) => rule)).toEqual(expectedRules);
  });

  it('treats zero as a defined minimum budget and clamps custom negative totals', () => {
    const rules = Object.fromEntries(
      Object.keys(DEFAULT_LEAD_SCORE_RULES).map((rule) => [rule, -10]),
    ) as unknown as typeof DEFAULT_LEAD_SCORE_RULES;

    expect(calculateLeadScore({ minPrice: 0 }, rules)).toMatchObject({
      score: 0,
      temperature: 'COLD',
      appliedRules: [{ rule: 'budgetDefined', points: -10 }],
    });
  });
});

describe('temperatureFor', () => {
  it.each([
    [0, 'COLD'],
    [30, 'COLD'],
    [31, 'WARM'],
    [60, 'WARM'],
    [61, 'HOT'],
    [80, 'HOT'],
    [81, 'VERY_HOT'],
    [100, 'VERY_HOT'],
  ] as const)('maps score %i to %s', (score, expected) => {
    expect(temperatureFor(score)).toBe(expected);
  });
});
