import { describe, expect, it, vi } from 'vitest';
import type { PropertyRecord } from '../../src/domain/properties/property.js';
import { OpenAILLMProvider } from '../../src/integrations/ai/openai-llm-provider.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function apiResponse(outputText: string): Response {
  return new Response(
    JSON.stringify({
      id: 'resp-test',
      model: 'test-model',
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: outputText }],
        },
      ],
      usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function groundedProperty(): PropertyRecord {
  return {
    id: 'allowed-property',
    externalId: 'REF-1',
    title: 'Apartamento permitido',
    description: 'Descrição',
    transactionType: 'BUY',
    propertyType: 'APARTMENT',
    status: 'ACTIVE',
    price: 800_000,
    condoFee: null,
    propertyTax: null,
    city: 'São Paulo',
    state: 'SP',
    neighborhood: 'Centro',
    address: null,
    latitude: null,
    longitude: null,
    bedrooms: 2,
    bathrooms: 2,
    parkingSpaces: 1,
    areaM2: 80,
    furnished: false,
    acceptsFinancing: true,
    features: [],
    imageUrls: [],
    propertyUrl: null,
    brokerId: null,
    available: true,
    createdAt: now,
    updatedAt: now,
  };
}

const emptyWireProfile = {
  name: null,
  city: null,
  state: null,
  neighborhoods: [],
  transactionType: null,
  propertyType: null,
  minPrice: null,
  maxPrice: null,
  minBedrooms: null,
  minBathrooms: null,
  minParkingSpaces: null,
  minAreaM2: null,
  purpose: null,
  paymentMethod: null,
  financingPreApproved: null,
  downPayment: null,
  purchaseTimelineDays: null,
  features: [],
  notes: [],
  interactedPropertyId: null,
  requestedVisit: null,
  requestedHuman: null,
} as const;

describe('OpenAILLMProvider structured-output safeguards', () => {
  it('retries malformed model JSON without making a real network request', async () => {
    const fetchMock = vi.fn(async () => apiResponse('{not-json'));
    const provider = new OpenAILLMProvider({
      apiKey: 'test-key',
      model: 'test-model',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      timeoutMs: 1_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(provider.extractLeadProfile({ message: 'Olá' })).rejects.toMatchObject({
      name: 'LLMProviderError',
      code: 'INVALID_STRUCTURED_OUTPUT',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers on a later attempt and compacts nullable wire fields', async () => {
    const validExtraction = JSON.stringify({
      intent: 'GENERAL_QUESTION',
      extractedFields: emptyWireProfile,
      missingFields: [],
      confidence: 0.75,
      requestsHumanHandoff: false,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(apiResponse('{invalid-json'))
      .mockResolvedValueOnce(apiResponse(validExtraction));
    const provider = new OpenAILLMProvider({
      apiKey: 'test-key',
      model: 'test-model',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      timeoutMs: 1_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.extractLeadProfile({ message: 'Olá' });

    expect(result).toMatchObject({
      provider: 'openai',
      model: 'test-model',
      responseId: 'resp-test',
      attempts: 2,
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      data: {
        intent: 'GENERAL_QUESTION',
        extractedFields: {},
        missingFields: [],
        confidence: 0.75,
        requestsHumanHandoff: false,
      },
    });
  });

  it('rejects a reply that references a property outside the backend grounding set', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      apiResponse(
        JSON.stringify({
          message: 'Tenho uma opção para você.',
          referencedPropertyIds: ['invented-property'],
          nextQuestion: null,
        }),
      ),
    );
    const provider = new OpenAILLMProvider({
      apiKey: 'test-key',
      model: 'test-model',
      maxRetries: 0,
      timeoutMs: 1_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(
      provider.generateReply({
        extraction: {
          intent: 'BUY_PROPERTY',
          extractedFields: {},
          missingFields: [],
          confidence: 0.9,
          requestsHumanHandoff: false,
        },
        groundedProperties: [groundedProperty()],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_STRUCTURED_OUTPUT',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends only bounded structured input and disables provider-side storage', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      apiResponse(
        JSON.stringify({
          message: 'Como posso ajudar?',
          referencedPropertyIds: [],
          nextQuestion: 'O que você procura?',
        }),
      ),
    );
    const provider = new OpenAILLMProvider({
      apiKey: 'test-key',
      maxRetries: 0,
      timeoutMs: 1_000,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await provider.generateReply({
      extraction: {
        intent: 'GENERAL_QUESTION',
        extractedFields: {},
        missingFields: [],
        confidence: 0.7,
        requestsHumanHandoff: false,
      },
      recentMessages: [{ role: 'user', content: `  ${'x'.repeat(3_000)}  ` }],
      businessName: `  ${'N'.repeat(200)}  `,
    });

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    const body = JSON.parse(String(request?.body)) as {
      store: boolean;
      input: Array<{ content: string }>;
      text: { format: { type: string; strict: boolean } };
    };
    const safeInput = JSON.parse(body.input[0]?.content ?? '{}') as {
      recentMessages: Array<{ content: string }>;
      businessName: string;
    };

    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(safeInput.recentMessages[0]?.content).toHaveLength(2_000);
    expect(safeInput.businessName).toHaveLength(120);
  });
});
