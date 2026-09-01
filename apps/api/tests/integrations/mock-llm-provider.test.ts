import { describe, expect, it } from 'vitest';
import type { PropertyRecord } from '../../src/domain/properties/property.js';
import { MockLLMProvider } from '../../src/integrations/ai/mock-llm-provider.js';
import type { LeadProfileExtraction } from '../../src/integrations/ai/llm-provider.js';

const provider = new MockLLMProvider();
const now = new Date('2026-01-01T00:00:00.000Z');

function property(index: number): PropertyRecord {
  return {
    id: `property-${index}`,
    externalId: `REF-${index}`,
    title: `Imóvel ${index}`,
    description: 'Imóvel usado exclusivamente como grounding do teste',
    transactionType: 'BUY',
    propertyType: 'APARTMENT',
    status: 'ACTIVE',
    price: 700_000 + index * 10_000,
    condoFee: null,
    propertyTax: null,
    city: 'São Paulo',
    state: 'SP',
    neighborhood: 'Pinheiros',
    address: null,
    latitude: null,
    longitude: null,
    bedrooms: 3,
    bathrooms: 2,
    parkingSpaces: 1,
    areaM2: 90,
    furnished: false,
    acceptsFinancing: true,
    features: ['varanda'],
    imageUrls: [],
    propertyUrl: null,
    brokerId: null,
    available: true,
    createdAt: now,
    updatedAt: now,
  };
}

function extraction(overrides: Partial<LeadProfileExtraction> = {}): LeadProfileExtraction {
  return {
    intent: 'GENERAL_QUESTION',
    extractedFields: {},
    missingFields: [],
    confidence: 0.8,
    requestsHumanHandoff: false,
    ...overrides,
  };
}

describe('MockLLMProvider.extractLeadProfile', () => {
  it('extracts a detailed Brazilian Portuguese buying request deterministically', async () => {
    const input = {
      message:
        'Quero comprar apartamento em Pinheiros, com 3 quartos e 2 banheiros, até R$ 900 mil, com varanda e piscina, dentro de 2 meses, pagamento à vista.',
    } as const;

    const first = await provider.extractLeadProfile(input);
    const second = await provider.extractLeadProfile(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      provider: 'mock',
      model: 'deterministic-pt-br-v1',
      responseId: null,
      attempts: 1,
      data: {
        intent: 'BUY_PROPERTY',
        extractedFields: {
          transactionType: 'BUY',
          propertyType: 'APARTMENT',
          neighborhoods: ['Pinheiros'],
          maxPrice: 900_000,
          minBedrooms: 3,
          minBathrooms: 2,
          purchaseTimelineDays: 60,
          paymentMethod: 'CASH',
          features: ['varanda', 'piscina'],
        },
        missingFields: [],
        requestsHumanHandoff: false,
      },
    });
    expect(first.data.confidence).toBeGreaterThan(0.9);
  });

  it('uses the current profile when calculating fields still missing', async () => {
    const result = await provider.extractLeadProfile({
      message: 'Quero comprar uma casa com 3 quartos',
      currentProfile: { city: 'Curitiba', maxPrice: 750_000 },
    });

    expect(result.data).toMatchObject({
      intent: 'BUY_PROPERTY',
      extractedFields: {
        transactionType: 'BUY',
        propertyType: 'HOUSE',
        minBedrooms: 3,
      },
      missingFields: [],
    });
  });

  it('recognizes an explicit human request and marks the profile for handoff', async () => {
    const result = await provider.extractLeadProfile({
      message: 'Quero falar com um corretor, por favor.',
    });

    expect(result.data).toMatchObject({
      intent: 'HUMAN_REQUEST',
      extractedFields: { requestedHuman: true },
      requestsHumanHandoff: true,
      missingFields: [],
    });
  });

  it.each([
    ['Preciso de ajuda com financiamento e entrada', 'FINANCING_QUESTION'],
    ['Quero alugar uma casa', 'RENT_PROPERTY'],
    ['Gostaria de marcar uma visita', 'SCHEDULE_VISIT'],
    ['Olá, bom dia!', 'GENERAL_QUESTION'],
    ['Mensagem sem qualquer sinal conhecido', 'UNKNOWN'],
  ] as const)('classifies "%s" as %s', async (message, intent) => {
    expect((await provider.extractLeadProfile({ message })).data.intent).toBe(intent);
  });
});

describe('MockLLMProvider.generateReply', () => {
  it('references only supplied grounded properties and caps the answer at five', async () => {
    const groundedProperties = Array.from({ length: 6 }, (_, index) => property(index + 1));

    const result = await provider.generateReply({
      extraction: extraction({ intent: 'BUY_PROPERTY' }),
      groundedProperties,
    });

    expect(result.data.referencedPropertyIds).toEqual([
      'property-1',
      'property-2',
      'property-3',
      'property-4',
      'property-5',
    ]);
    expect(result.data.message).toContain('Imóvel 1');
    expect(result.data.message).toContain('REF-5');
    expect(result.data.message).not.toContain('Imóvel 6');
    expect(result.data.message).not.toContain('REF-6');
  });

  it('returns a safe broadening question after an empty property search', async () => {
    const result = await provider.generateReply({
      extraction: extraction({ intent: 'BUY_PROPERTY' }),
      groundedProperties: [],
      propertySearchPerformed: true,
    });

    expect(result.data.referencedPropertyIds).toEqual([]);
    expect(result.data.message).toContain('Não encontrei imóveis disponíveis');
    expect(result.data.nextQuestion).toContain('critério');
  });

  it('prioritizes handoff and includes the supplied business name', async () => {
    const result = await provider.generateReply({
      extraction: extraction({
        intent: 'HUMAN_REQUEST',
        requestsHumanHandoff: true,
        extractedFields: { requestedHuman: true },
      }),
      groundedProperties: [property(1)],
      businessName: 'Imobiliária Horizonte',
    });

    expect(result.data).toMatchObject({
      referencedPropertyIds: [],
      nextQuestion: null,
    });
    expect(result.data.message).toContain('Imobiliária Horizonte');
    expect(result.data.message).toContain('corretor');
  });
});

describe('MockLLMProvider.summarizeConversation', () => {
  it('deduplicates shown properties and carries questions and objections into the summary', async () => {
    const result = await provider.summarizeConversation({
      intent: 'BUY_PROPERTY',
      profile: { name: 'Ana', transactionType: 'BUY', city: 'Recife' },
      recentMessages: [
        { role: 'assistant', content: 'Veja esta opção.' },
        { role: 'user', content: 'Esse imóvel está caro demais, tem outro?' },
      ],
      previousSummary: {
        leadName: 'Ana',
        intent: 'BUY_PROPERTY',
        preferences: { transactionType: 'BUY' },
        shownPropertyIds: ['REF-1'],
        questions: [],
        objections: [],
        stage: 'QUALIFYING',
        nextStep: null,
      },
      shownPropertyIds: ['REF-1', 'REF-2'],
    });

    expect(result.data.shownPropertyIds).toEqual(['REF-1', 'REF-2']);
    expect(result.data.questions).toEqual(['Esse imóvel está caro demais, tem outro?']);
    expect(result.data.objections).toEqual(['Esse imóvel está caro demais, tem outro?']);
    expect(result.data.stage).toBe('PRESENTING_PROPERTIES');
  });
});
