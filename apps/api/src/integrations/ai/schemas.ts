import { z } from 'zod';
import {
  LeadProfileSchema,
  leadIntents,
  propertyTypes,
  transactionTypes,
  type LeadProfile,
} from '../../domain/leads/lead-profile.js';
import { conversationStages } from './llm-provider.js';

export type JsonSchema = Readonly<Record<string, unknown>>;

export const leadProfileFieldNames = [
  'name',
  'city',
  'state',
  'neighborhoods',
  'transactionType',
  'propertyType',
  'minPrice',
  'maxPrice',
  'minBedrooms',
  'minBathrooms',
  'minParkingSpaces',
  'minAreaM2',
  'purpose',
  'paymentMethod',
  'financingPreApproved',
  'downPayment',
  'purchaseTimelineDays',
  'features',
  'notes',
  'interactedPropertyId',
  'requestedVisit',
  'requestedHuman',
] as const satisfies readonly (keyof LeadProfile)[];

export const LeadProfileExtractionSchema = z
  .object({
    intent: z.enum(leadIntents),
    extractedFields: LeadProfileSchema,
    missingFields: z.array(z.enum(leadProfileFieldNames)).max(leadProfileFieldNames.length),
    confidence: z.number().min(0).max(1),
    requestsHumanHandoff: z.boolean(),
  })
  .strict();

export const GeneratedReplySchema = z
  .object({
    message: z.string().trim().min(1).max(4_000),
    referencedPropertyIds: z.array(z.string().trim().min(1).max(120)).max(5),
    nextQuestion: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const ConversationSummarySchema = z
  .object({
    leadName: z.string().trim().min(1).max(120).nullable(),
    intent: z.enum(leadIntents),
    preferences: LeadProfileSchema,
    shownPropertyIds: z.array(z.string().trim().min(1).max(120)).max(50),
    questions: z.array(z.string().trim().min(1).max(500)).max(20),
    objections: z.array(z.string().trim().min(1).max(500)).max(20),
    stage: z.enum(conversationStages),
    nextStep: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

const nullableString = (maxLength: number): JsonSchema => ({
  anyOf: [{ type: 'string', minLength: 1, maxLength }, { type: 'null' }],
});

const nullableNumber = (options: Readonly<Record<string, number>> = {}): JsonSchema => ({
  anyOf: [{ type: 'number', ...options }, { type: 'null' }],
});

const nullableInteger = (options: Readonly<Record<string, number>> = {}): JsonSchema => ({
  anyOf: [{ type: 'integer', ...options }, { type: 'null' }],
});

const nullableBoolean: JsonSchema = { anyOf: [{ type: 'boolean' }, { type: 'null' }] };

const nullableEnum = (values: readonly string[]): JsonSchema => ({
  anyOf: [{ type: 'string', enum: values }, { type: 'null' }],
});

const stringArray = (maxItems: number, maxLength: number): JsonSchema => ({
  type: 'array',
  items: { type: 'string', minLength: 1, maxLength },
  maxItems,
});

export const leadProfileWireJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: nullableString(120),
    city: nullableString(120),
    state: nullableString(2),
    neighborhoods: stringArray(10, 120),
    transactionType: nullableEnum(transactionTypes),
    propertyType: nullableEnum(propertyTypes),
    minPrice: nullableNumber({ minimum: 0, maximum: 1_000_000_000 }),
    maxPrice: nullableNumber({ exclusiveMinimum: 0, maximum: 1_000_000_000 }),
    minBedrooms: nullableInteger({ minimum: 0, maximum: 30 }),
    minBathrooms: nullableInteger({ minimum: 0, maximum: 30 }),
    minParkingSpaces: nullableInteger({ minimum: 0, maximum: 30 }),
    minAreaM2: nullableNumber({ minimum: 0, maximum: 1_000_000 }),
    purpose: nullableEnum(['LIVE', 'INVEST']),
    paymentMethod: nullableEnum(['CASH', 'FINANCING', 'CONSORTIUM', 'OTHER']),
    financingPreApproved: nullableBoolean,
    downPayment: nullableNumber({ minimum: 0, maximum: 1_000_000_000 }),
    purchaseTimelineDays: nullableInteger({ minimum: 1, maximum: 3_650 }),
    features: stringArray(20, 80),
    notes: stringArray(20, 500),
    interactedPropertyId: nullableString(120),
    requestedVisit: nullableBoolean,
    requestedHuman: nullableBoolean,
  },
  required: [...leadProfileFieldNames],
};

const nullableLeadProfileWireSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    city: z.string().trim().min(1).max(120).nullable(),
    state: z.string().trim().length(2).toUpperCase().nullable(),
    neighborhoods: z.array(z.string().trim().min(1).max(120)).max(10),
    transactionType: z.enum(transactionTypes).nullable(),
    propertyType: z.enum(propertyTypes).nullable(),
    minPrice: z.number().nonnegative().max(1_000_000_000).nullable(),
    maxPrice: z.number().positive().max(1_000_000_000).nullable(),
    minBedrooms: z.number().int().nonnegative().max(30).nullable(),
    minBathrooms: z.number().int().nonnegative().max(30).nullable(),
    minParkingSpaces: z.number().int().nonnegative().max(30).nullable(),
    minAreaM2: z.number().nonnegative().max(1_000_000).nullable(),
    purpose: z.enum(['LIVE', 'INVEST']).nullable(),
    paymentMethod: z.enum(['CASH', 'FINANCING', 'CONSORTIUM', 'OTHER']).nullable(),
    financingPreApproved: z.boolean().nullable(),
    downPayment: z.number().nonnegative().max(1_000_000_000).nullable(),
    purchaseTimelineDays: z.number().int().positive().max(3_650).nullable(),
    features: z.array(z.string().trim().min(1).max(80)).max(20),
    notes: z.array(z.string().trim().min(1).max(500)).max(20),
    interactedPropertyId: z.string().trim().min(1).max(120).nullable(),
    requestedVisit: z.boolean().nullable(),
    requestedHuman: z.boolean().nullable(),
  })
  .strict();

export const LeadProfileExtractionWireSchema = z
  .object({
    intent: z.enum(leadIntents),
    extractedFields: nullableLeadProfileWireSchema,
    missingFields: z.array(z.enum(leadProfileFieldNames)).max(leadProfileFieldNames.length),
    confidence: z.number().min(0).max(1),
    requestsHumanHandoff: z.boolean(),
  })
  .strict();

export const leadProfileExtractionJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: leadIntents },
    extractedFields: leadProfileWireJsonSchema,
    missingFields: {
      type: 'array',
      items: { type: 'string', enum: leadProfileFieldNames },
      maxItems: leadProfileFieldNames.length,
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    requestsHumanHandoff: { type: 'boolean' },
  },
  required: ['intent', 'extractedFields', 'missingFields', 'confidence', 'requestsHumanHandoff'],
};

export const generatedReplyJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 4_000 },
    referencedPropertyIds: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 120 },
      maxItems: 5,
    },
    nextQuestion: nullableString(500),
  },
  required: ['message', 'referencedPropertyIds', 'nextQuestion'],
};

export const conversationSummaryJsonSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leadName: nullableString(120),
    intent: { type: 'string', enum: leadIntents },
    preferences: leadProfileWireJsonSchema,
    shownPropertyIds: stringArray(50, 120),
    questions: stringArray(20, 500),
    objections: stringArray(20, 500),
    stage: { type: 'string', enum: conversationStages },
    nextStep: nullableString(500),
  },
  required: [
    'leadName',
    'intent',
    'preferences',
    'shownPropertyIds',
    'questions',
    'objections',
    'stage',
    'nextStep',
  ],
};

export const ConversationSummaryWireSchema = z
  .object({
    leadName: z.string().trim().min(1).max(120).nullable(),
    intent: z.enum(leadIntents),
    preferences: nullableLeadProfileWireSchema,
    shownPropertyIds: z.array(z.string().trim().min(1).max(120)).max(50),
    questions: z.array(z.string().trim().min(1).max(500)).max(20),
    objections: z.array(z.string().trim().min(1).max(500)).max(20),
    stage: z.enum(conversationStages),
    nextStep: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

type NullableLeadProfile = z.infer<typeof nullableLeadProfileWireSchema>;

export function compactLeadProfile(profile: NullableLeadProfile): LeadProfile {
  const entries = Object.entries(profile).filter(([, value]) => {
    if (value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });

  return LeadProfileSchema.parse(Object.fromEntries(entries));
}
