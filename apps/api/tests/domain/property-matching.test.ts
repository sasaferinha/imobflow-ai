import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_WEIGHTS,
  profileToPropertyFilters,
  propertyMatchesFilters,
  rankProperties,
  scoreProperty,
} from '../../src/domain/properties/property-matching.js';
import type {
  PropertyRecord,
  PropertySearchFilters,
} from '../../src/domain/properties/property.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function property(overrides: Partial<PropertyRecord> = {}): PropertyRecord {
  return {
    id: 'property-1',
    externalId: 'REF-1',
    title: 'Apartamento nos Jardins',
    description: 'Imóvel de teste',
    transactionType: 'BUY',
    propertyType: 'APARTMENT',
    status: 'ACTIVE',
    price: 800_000,
    condoFee: 900,
    propertyTax: 300,
    city: 'São Paulo',
    state: 'SP',
    neighborhood: 'Jardins',
    address: null,
    latitude: null,
    longitude: null,
    bedrooms: 3,
    bathrooms: 2,
    parkingSpaces: 2,
    areaM2: 110,
    furnished: false,
    acceptsFinancing: true,
    features: ['Área gourmet', 'Piscina aquecida', 'Varanda'],
    imageUrls: [],
    propertyUrl: null,
    brokerId: null,
    available: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('profileToPropertyFilters', () => {
  it('maps only search-relevant profile fields and forces financing when requested', () => {
    expect(
      profileToPropertyFilters(
        {
          name: 'Ana',
          transactionType: 'BUY',
          propertyType: 'APARTMENT',
          city: 'São Paulo',
          state: 'SP',
          neighborhoods: ['Jardins'],
          minPrice: 500_000,
          maxPrice: 1_000_000,
          minBedrooms: 2,
          minBathrooms: 2,
          minParkingSpaces: 1,
          minAreaM2: 80,
          paymentMethod: 'FINANCING',
          features: ['varanda'],
          requestedVisit: true,
        },
        7,
      ),
    ).toEqual({
      transactionType: 'BUY',
      propertyType: 'APARTMENT',
      city: 'São Paulo',
      state: 'SP',
      neighborhoods: ['Jardins'],
      minPrice: 500_000,
      maxPrice: 1_000_000,
      minBedrooms: 2,
      minBathrooms: 2,
      minParkingSpaces: 1,
      minAreaM2: 80,
      acceptsFinancing: true,
      features: ['varanda'],
      limit: 7,
    });
  });

  it('does not require financing for non-financing payment methods', () => {
    expect(profileToPropertyFilters({ paymentMethod: 'CASH' })).toEqual({ limit: 5 });
  });
});

describe('propertyMatchesFilters', () => {
  it('matches text accent- and case-insensitively and accepts a partial feature name', () => {
    expect(
      propertyMatchesFilters(property(), {
        city: 'sao paulo',
        state: 'sp',
        neighborhoods: ['JARDÍNS'],
        features: ['area gourmet'],
        minPrice: 800_000,
        maxPrice: 800_000,
        limit: 5,
      }),
    ).toBe(true);
  });

  const rejectionCases: Array<[
    string,
    Partial<PropertyRecord>,
    Omit<Partial<PropertySearchFilters>, 'limit'>,
  ]> = [
    ['unavailable', { available: false }, {}],
    ['inactive', { status: 'INACTIVE' }, {}],
    ['wrong transaction', { transactionType: 'RENT' }, { transactionType: 'BUY' }],
    ['above budget', { price: 800_001 }, { maxPrice: 800_000 }],
    ['too few bedrooms', { bedrooms: 1 }, { minBedrooms: 2 }],
    ['does not accept financing', { acceptsFinancing: false }, { acceptsFinancing: true }],
    ['missing requested features', { features: ['elevador'] }, { features: ['piscina'] }],
  ];

  it.each(rejectionCases)('rejects an %s property', (_label, propertyOverrides, filterOverrides) => {
    expect(
      propertyMatchesFilters(property(propertyOverrides), {
        limit: 5,
        ...filterOverrides,
      }),
    ).toBe(false);
  });
});

describe('property ranking', () => {
  const filters = {
    neighborhoods: ['Jardins'],
    minPrice: 500_000,
    maxPrice: 1_000_000,
    minBedrooms: 2,
    propertyType: 'APARTMENT' as const,
    features: ['varanda', 'piscina'],
    limit: 2,
  };

  it('scores every matching dimension and explains the score', () => {
    expect(scoreProperty(property(), filters, DEFAULT_MATCH_WEIGHTS)).toEqual({
      property: property(),
      score: 100,
      reasons: [
        'bairro compatível',
        'dentro do orçamento',
        'quantidade de quartos',
        'tipo de imóvel',
        'características desejadas',
      ],
    });
  });

  it('orders by descending score, uses price as the tie-breaker, and applies the limit', () => {
    const perfect = property({ id: 'perfect', price: 900_000 });
    const expensiveTie = property({
      id: 'expensive-tie',
      price: 850_000,
      neighborhood: 'Centro',
      features: ['varanda'],
    });
    const cheapTie = property({
      id: 'cheap-tie',
      price: 700_000,
      neighborhood: 'Centro',
      features: ['varanda'],
    });

    const ranked = rankProperties([expensiveTie, perfect, cheapTie], filters);

    expect(ranked.map(({ property: item }) => item.id)).toEqual(['perfect', 'cheap-tie']);
    expect(ranked.map(({ score }) => score)).toEqual([100, 65]);
  });
});
