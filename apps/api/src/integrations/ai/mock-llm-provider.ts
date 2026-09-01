import {
  LeadProfileSchema,
  mergeLeadProfiles,
  type LeadIntent,
  type LeadProfile,
  type PropertyType,
} from '../../domain/leads/lead-profile.js';
import type { PropertyRecord } from '../../domain/properties/property.js';
import {
  ConversationSummarySchema,
  GeneratedReplySchema,
  LeadProfileExtractionSchema,
} from './schemas.js';
import type {
  ConversationStage,
  ConversationSummary,
  ExtractLeadProfileInput,
  GeneratedReply,
  GenerateReplyInput,
  LeadProfileExtraction,
  LLMProvider,
  LLMResult,
  SummarizeConversationInput,
} from './llm-provider.js';

const MOCK_MODEL = 'deterministic-pt-br-v1';

const missingFieldQuestions: Partial<Record<keyof LeadProfile, string>> = {
  transactionType: 'Você procura um imóvel para comprar ou alugar?',
  city: 'Em qual cidade ou região você está procurando?',
  neighborhoods: 'Quais bairros ou regiões você prefere?',
  propertyType: 'Você prefere apartamento, casa, terreno ou imóvel comercial?',
  maxPrice: 'Qual é o valor máximo que você pretende investir?',
  minBedrooms: 'Quantos quartos você gostaria?',
  paymentMethod: 'Você pretende pagar à vista, financiar ou usar consórcio?',
  purchaseTimelineDays: 'Em quanto tempo pretende fechar o negócio?',
};

/**
 * Mock em português para demonstrações e testes locais. Ele usa somente regras
 * determinísticas e nunca cria imóveis: as opções são formatadas exclusivamente
 * a partir de `groundedProperties`.
 */
export class MockLLMProvider implements LLMProvider {
  readonly providerName = 'mock';

  async extractLeadProfile(input: ExtractLeadProfileInput): Promise<LLMResult<LeadProfileExtraction>> {
    const message = input.message.trim().slice(0, 4_000);
    const normalized = normalize(message);
    const intent = detectIntent(normalized);
    const extractedFields = extractProfile(message, normalized, intent);
    const missingFields = getMissingFields(intent, mergeLeadProfiles(input.currentProfile ?? {}, extractedFields));
    const explicitSignals = Object.keys(extractedFields).length;
    const confidence = Math.min(0.98, 0.48 + explicitSignals * 0.07 + (intent === 'UNKNOWN' ? 0 : 0.12));
    const requestsHumanHandoff = intent === 'HUMAN_REQUEST' || extractedFields.requestedHuman === true;

    const data = LeadProfileExtractionSchema.parse({
      intent,
      extractedFields,
      missingFields,
      confidence,
      requestsHumanHandoff,
    });

    return mockResult(data);
  }

  async generateReply(input: GenerateReplyInput): Promise<LLMResult<GeneratedReply>> {
    const properties = [...(input.groundedProperties ?? [])].slice(0, 5);
    const extraction = LeadProfileExtractionSchema.parse(input.extraction);
    const profile = mergeLeadProfiles(input.currentProfile ?? {}, extraction.extractedFields);
    const businessName = input.businessName?.trim() || 'nossa imobiliária';

    let data: GeneratedReply;
    if (extraction.requestsHumanHandoff || extraction.intent === 'HUMAN_REQUEST') {
      data = {
        message: `Claro. Vou encaminhar seu atendimento para um corretor da ${businessName}, que continuará a conversa por aqui.`,
        referencedPropertyIds: [],
        nextQuestion: null,
      };
    } else if (properties.length > 0) {
      data = buildGroundedPropertyReply(properties);
    } else if (input.propertySearchPerformed === true) {
      data = {
        message:
          'Não encontrei imóveis disponíveis com todos esses critérios agora. Posso ampliar um pouco a região ou a faixa de valor para buscar outras opções?',
        referencedPropertyIds: [],
        nextQuestion: 'Qual critério você prefere flexibilizar: região, valor ou características?',
      };
    } else if (extraction.intent === 'SCHEDULE_VISIT' || profile.requestedVisit === true) {
      data = {
        message: 'Ótimo, posso ajudar com a visita. Qual dia e período são melhores para você?',
        referencedPropertyIds: [],
        nextQuestion: 'Qual dia e período são melhores para a visita?',
      };
    } else {
      const firstMissing = extraction.missingFields[0];
      const question = firstMissing === undefined ? null : (missingFieldQuestions[firstMissing] ?? null);
      data = {
        message:
          question ??
          'Entendi. Conte um pouco mais sobre o imóvel que você procura para eu encontrar opções compatíveis.',
        referencedPropertyIds: [],
        nextQuestion: question,
      };
    }

    return mockResult(GeneratedReplySchema.parse(data));
  }

  async summarizeConversation(input: SummarizeConversationInput): Promise<LLMResult<ConversationSummary>> {
    const profile = LeadProfileSchema.parse(input.profile);
    const previous = input.previousSummary;
    const userMessages = input.recentMessages
      .filter((message) => message.role === 'user')
      .map((message) => message.content.trim())
      .filter(Boolean);
    const questions = unique([
      ...(previous?.questions ?? []),
      ...userMessages.filter((message) => message.includes('?')),
    ]).slice(-20);
    const objections = unique([
      ...(previous?.objections ?? []),
      ...userMessages.filter((message) => /\b(caro|car[oa] demais|nao gostei|longe|sem entrada|vou pensar)\b/i.test(normalize(message))),
    ]).slice(-20);
    const shownPropertyIds = unique([
      ...(previous?.shownPropertyIds ?? []),
      ...(input.shownPropertyIds ?? []),
    ]).slice(-50);
    const stage = inferStage(input.stage, profile, shownPropertyIds, input.intent);

    const data = ConversationSummarySchema.parse({
      leadName: profile.name ?? previous?.leadName ?? null,
      intent: input.intent,
      preferences: profile,
      shownPropertyIds,
      questions,
      objections,
      stage,
      nextStep: inferNextStep(stage, profile),
    });

    return mockResult(data);
  }
}

function detectIntent(text: string): LeadIntent {
  if (/\b(falar|conversar)\s+com\s+(um\s+)?(corretor|atendente|humano|alguem)\b|\bme\s+(passa|transfere|encaminha)\b/.test(text)) {
    return 'HUMAN_REQUEST';
  }
  if (/\b(agendar|marcar|visitar|visita|conhecer o imovel)\b/.test(text)) return 'SCHEDULE_VISIT';
  if (/\b(financiamento|financiar|credito imobiliario|juros|entrada)\b/.test(text)) return 'FINANCING_QUESTION';
  if (/\b(vender|vendo|minha (casa|propriedade|apartamento|imovel)|avaliar meu imovel)\b/.test(text)) return 'SELL_PROPERTY';
  if (/\b(alugar|aluguel|locacao|locar)\b/.test(text)) return 'RENT_PROPERTY';
  if (/\b(comprar|compra|adquirir|investir|procuro|procurando|quero (um|uma))\b/.test(text)) return 'BUY_PROPERTY';
  if (/\b(imovel|apartamento|casa|terreno)\s*(#|numero|n\.?\s*)?\d+\b|\bmais (informacoes|detalhes)\b/.test(text)) {
    return 'PROPERTY_INFO';
  }
  if (/\b(oi|ola|bom dia|boa tarde|boa noite|tudo bem)\b/.test(text)) return 'GENERAL_QUESTION';
  return 'UNKNOWN';
}

function extractProfile(original: string, text: string, intent: LeadIntent): LeadProfile {
  const candidate: Record<string, unknown> = {};

  const name = capture(original, /\b(?:me chamo|meu nome (?:e|é)|pode me chamar de)\s+([\p{L}][\p{L}' -]{1,80})/iu);
  if (name) candidate.name = cleanPhrase(name);

  if (intent === 'BUY_PROPERTY') candidate.transactionType = 'BUY';
  if (intent === 'RENT_PROPERTY') candidate.transactionType = 'RENT';
  if (intent === 'HUMAN_REQUEST') candidate.requestedHuman = true;
  if (intent === 'SCHEDULE_VISIT') candidate.requestedVisit = true;

  const propertyType = detectPropertyType(text);
  if (propertyType) candidate.propertyType = propertyType;

  const city = capture(original, /\b(?:na|em)\s+cidade\s+de\s+([\p{L}][\p{L}' -]{1,80})/iu);
  if (city) candidate.city = cleanPhrase(city);

  const state = capture(original, /\b(?:estado\s+de\s+|em\s+)([A-Z]{2})\b/u);
  if (state) candidate.state = state.toUpperCase();

  const neighborhoods = extractNeighborhoods(original);
  if (neighborhoods.length > 0) candidate.neighborhoods = neighborhoods;

  const priceRange = extractPriceRange(text);
  if (priceRange.min !== undefined) candidate.minPrice = priceRange.min;
  if (priceRange.max !== undefined) candidate.maxPrice = priceRange.max;

  const bedrooms = extractInteger(text, /\b(\d{1,2})\s*(?:quartos?|dormitorios?)\b/);
  if (bedrooms !== undefined) candidate.minBedrooms = bedrooms;
  const bathrooms = extractInteger(text, /\b(\d{1,2})\s*(?:banheiros?|wcs?)\b/);
  if (bathrooms !== undefined) candidate.minBathrooms = bathrooms;
  const parkingSpaces = extractInteger(text, /\b(\d{1,2})\s*(?:vagas?|garagens?)\b/);
  if (parkingSpaces !== undefined) candidate.minParkingSpaces = parkingSpaces;
  const area = extractDecimal(text, /\b(\d+(?:[.,]\d+)?)\s*m(?:2|²)\b/);
  if (area !== undefined) candidate.minAreaM2 = area;

  if (/\b(morar|moradia|residir)\b/.test(text)) candidate.purpose = 'LIVE';
  if (/\b(investir|investimento|renda)\b/.test(text)) candidate.purpose = 'INVEST';
  if (/\b(a vista|pagamento a vista)\b/.test(text)) candidate.paymentMethod = 'CASH';
  if (/\b(financiar|financiamento)\b/.test(text)) candidate.paymentMethod = 'FINANCING';
  if (/\b(consorcio)\b/.test(text)) candidate.paymentMethod = 'CONSORTIUM';
  if (/\b(pre[- ]?aprovad[oa]|credito aprovado)\b/.test(text)) candidate.financingPreApproved = true;

  const downPayment = capture(text, /\bentrada\s+(?:de\s+)?(?:r\$\s*)?([\d.,]+)\s*(milhoes?|milhao|mil|k)?\b/);
  if (downPayment) {
    const suffix = capture(text, /\bentrada\s+(?:de\s+)?(?:r\$\s*)?[\d.,]+\s*(milhoes?|milhao|mil|k)?\b/, 1);
    const parsed = parseMoney(downPayment, suffix);
    if (parsed !== undefined) candidate.downPayment = parsed;
  }

  const timeline = extractTimelineDays(text);
  if (timeline !== undefined) candidate.purchaseTimelineDays = timeline;

  const features = extractFeatures(text);
  if (features.length > 0) candidate.features = features;

  const propertyId = capture(original, /(?:im[oó]vel\s*(?:#|n[uú]mero|n\.?\s*)?|#)([A-Za-z0-9_-]{1,120})/iu);
  if (propertyId) candidate.interactedPropertyId = propertyId;

  return LeadProfileSchema.parse(candidate);
}

function detectPropertyType(text: string): PropertyType | undefined {
  if (/\b(apartamento|apto)\b/.test(text)) return 'APARTMENT';
  if (/\b(casa|sobrado)\b/.test(text)) return 'HOUSE';
  if (/\b(terreno|lote)\b/.test(text)) return 'LAND';
  if (/\b(comercial|sala|loja|galpao)\b/.test(text)) return 'COMMERCIAL';
  if (/\b(imovel)\b/.test(text)) return 'OTHER';
  return undefined;
}

function extractNeighborhoods(original: string): string[] {
  const match = /\b(?:bairros?|regi(?:a|ã)o|regi(?:o|õ)es|em|no|na|nos|nas)\s+([^,.!?]+?)(?=\s+(?:ate|até|com|de\s+\d|por\s+(?:r\$|\d)|para\s+(?:comprar|alugar)|e\s+(?:quero|preciso|gostaria))|[,.!?]|$)/iu.exec(original);
  const value = match?.[1]?.trim();
  if (!value || /^(?:maximo|máximo|ate|até|torno de)\b/i.test(value)) return [];

  return unique(
    value
      .split(/\s*(?:\/|,|\bou\b|\be\b)\s*/iu)
      .map(cleanPhrase)
      .filter((part) => part.length >= 2 && part.length <= 120),
  ).slice(0, 10);
}

function extractPriceRange(text: string): { min?: number; max?: number } {
  const between = /\bentre\s+(?:r\$\s*)?([\d.,]+)\s*(milhoes?|milhao|mil|k)?\s+e\s+(?:r\$\s*)?([\d.,]+)\s*(milhoes?|milhao|mil|k)?\b/.exec(text);
  if (between) {
    const firstSuffix = between[2] || between[4];
    const min = parseMoney(between[1], firstSuffix);
    const max = parseMoney(between[3], between[4]);
    return buildRange(min, max);
  }

  const maximum = /\b(?:ate|no maximo|maximo|teto de|por ate)\s+(?:r\$\s*)?([\d.,]+)\s*(milhoes?|milhao|mil|k)?\b/.exec(text);
  if (maximum) return buildRange(undefined, parseMoney(maximum[1], maximum[2]));

  const minimum = /\b(?:a partir de|pelo menos|minimo de)\s+(?:r\$\s*)?([\d.,]+)\s*(milhoes?|milhao|mil|k)?\b/.exec(text);
  if (minimum) return buildRange(parseMoney(minimum[1], minimum[2]), undefined);

  const explicitCurrency = /\br\$\s*([\d.,]+)\s*(milhoes?|milhao|mil|k)?\b/.exec(text);
  if (explicitCurrency) return buildRange(undefined, parseMoney(explicitCurrency[1], explicitCurrency[2]));

  return {};
}

function buildRange(min: number | undefined, max: number | undefined): { min?: number; max?: number } {
  const result: { min?: number; max?: number } = {};
  if (min !== undefined) result.min = min;
  if (max !== undefined) result.max = max;
  return result;
}

function parseMoney(rawValue: string | undefined, rawSuffix: string | undefined): number | undefined {
  if (!rawValue) return undefined;
  const suffix = rawSuffix ?? '';
  let numericText = rawValue;
  if (numericText.includes('.') && numericText.includes(',')) {
    numericText = numericText.replace(/\./g, '').replace(',', '.');
  } else if (numericText.includes(',')) {
    numericText = numericText.replace(',', '.');
  } else if (/\.\d{3}$/.test(numericText) && suffix === '') {
    numericText = numericText.replace(/\./g, '');
  }

  const base = Number(numericText);
  if (!Number.isFinite(base) || base < 0) return undefined;
  const multiplier = /milhao|milhoes/.test(suffix) ? 1_000_000 : /mil|k/.test(suffix) ? 1_000 : 1;
  const amount = Math.round(base * multiplier);
  return amount <= 1_000_000_000 ? amount : undefined;
}

function extractTimelineDays(text: string): number | undefined {
  if (/\b(urgente|o quanto antes|este mes|nos proximos dias)\b/.test(text)) return 30;
  const days = extractInteger(text, /\b(?:em|dentro de|ate)\s+(\d{1,4})\s+dias?\b/);
  if (days !== undefined && days > 0) return Math.min(days, 3_650);
  const months = extractInteger(text, /\b(?:em|dentro de|ate)\s+(\d{1,3})\s+mes(?:es)?\b/);
  if (months !== undefined && months > 0) return Math.min(months * 30, 3_650);
  const years = extractInteger(text, /\b(?:em|dentro de|ate)\s+(\d{1,2})\s+anos?\b/);
  if (years !== undefined && years > 0) return Math.min(years * 365, 3_650);
  return undefined;
}

function extractFeatures(text: string): string[] {
  const dictionary: ReadonlyArray<readonly [RegExp, string]> = [
    [/\b(varanda|sacada)\b/, 'varanda'],
    [/\b(piscina)\b/, 'piscina'],
    [/\b(elevador)\b/, 'elevador'],
    [/\b(portaria)\b/, 'portaria'],
    [/\b(quintal)\b/, 'quintal'],
    [/\b(academia)\b/, 'academia'],
    [/\b(churrasqueira)\b/, 'churrasqueira'],
    [/\b(mobiliad[oa])\b/, 'mobiliado'],
    [/\b(pet friendly|aceita pets?)\b/, 'aceita pets'],
  ];
  return dictionary.filter(([pattern]) => pattern.test(text)).map(([, feature]) => feature);
}

function getMissingFields(intent: LeadIntent, profile: LeadProfile): Array<keyof LeadProfile> {
  if (intent !== 'BUY_PROPERTY' && intent !== 'RENT_PROPERTY') return [];
  const missing: Array<keyof LeadProfile> = [];
  if (!profile.transactionType) missing.push('transactionType');
  if (!profile.city && (!profile.neighborhoods || profile.neighborhoods.length === 0)) missing.push('neighborhoods');
  if (!profile.propertyType) missing.push('propertyType');
  if (profile.maxPrice === undefined) missing.push('maxPrice');
  if (profile.minBedrooms === undefined) missing.push('minBedrooms');
  return missing;
}

function buildGroundedPropertyReply(properties: readonly PropertyRecord[]): GeneratedReply {
  const cards = properties.map((property, index) => {
    const bedrooms = property.bedrooms === 1 ? '1 quarto' : `${property.bedrooms} quartos`;
    return `${index + 1}. ${property.title}\n${property.neighborhood}, ${property.city} — ${bedrooms} — ${formatCurrency(property.price)}\nCódigo: ${property.externalId}`;
  });
  const message = `Encontrei ${properties.length === 1 ? 'uma opção' : `${properties.length} opções`} compatível${properties.length === 1 ? '' : 'is'} com o que você procura:\n\n${cards.join('\n\n')}\n\nQuer ver mais detalhes de alguma delas?`;
  return {
    message,
    referencedPropertyIds: properties.map((property) => property.id),
    nextQuestion: 'Quer ver mais detalhes de alguma dessas opções?',
  };
}

function inferStage(
  requestedStage: ConversationStage | undefined,
  profile: LeadProfile,
  shownPropertyIds: readonly string[],
  intent: LeadIntent,
): ConversationStage {
  if (requestedStage) return requestedStage;
  if (profile.requestedHuman === true || intent === 'HUMAN_REQUEST') return 'HUMAN_HANDOFF';
  if (profile.requestedVisit === true || intent === 'SCHEDULE_VISIT') return 'APPOINTMENT';
  if (shownPropertyIds.length > 0) return 'PRESENTING_PROPERTIES';
  if (profile.transactionType && (profile.city || profile.neighborhoods?.length)) return 'MATCHING';
  return Object.keys(profile).length > 0 ? 'QUALIFYING' : 'NEW';
}

function inferNextStep(stage: ConversationStage, profile: LeadProfile): string | null {
  if (stage === 'HUMAN_HANDOFF') return 'Corretor deve assumir o atendimento.';
  if (stage === 'APPOINTMENT') return 'Confirmar data, horário e imóvel da visita.';
  if (stage === 'PRESENTING_PROPERTIES') return 'Identificar interesse e oferecer visita.';
  if (stage === 'MATCHING') return 'Buscar e ranquear imóveis disponíveis.';
  const missing = getMissingFields(profile.transactionType === 'RENT' ? 'RENT_PROPERTY' : 'BUY_PROPERTY', profile);
  const field = missing[0];
  return field ? (missingFieldQuestions[field] ?? 'Continuar a qualificação do lead.') : null;
}

function extractInteger(text: string, pattern: RegExp): number | undefined {
  const raw = pattern.exec(text)?.[1];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function extractDecimal(text: string, pattern: RegExp): number | undefined {
  const raw = pattern.exec(text)?.[1];
  if (!raw) return undefined;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

function capture(text: string, pattern: RegExp, group = 1): string | undefined {
  return pattern.exec(text)?.[group]?.trim();
}

function cleanPhrase(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\b(?:por favor|obrigad[oa])\b.*$/iu, '').trim();
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function mockResult<T>(data: T): LLMResult<T> {
  return {
    data,
    provider: 'mock',
    model: MOCK_MODEL,
    responseId: null,
    attempts: 1,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}
