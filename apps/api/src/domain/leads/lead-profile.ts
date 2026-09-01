import { z } from 'zod';

export const leadIntents = [
  'BUY_PROPERTY',
  'RENT_PROPERTY',
  'SELL_PROPERTY',
  'PROPERTY_INFO',
  'SCHEDULE_VISIT',
  'FINANCING_QUESTION',
  'HUMAN_REQUEST',
  'GENERAL_QUESTION',
  'UNKNOWN',
] as const;

export const propertyTypes = ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL', 'OTHER'] as const;
export const transactionTypes = ['BUY', 'RENT'] as const;

export const LeadProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state: z.string().trim().length(2).toUpperCase().optional(),
    neighborhoods: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    transactionType: z.enum(transactionTypes).optional(),
    propertyType: z.enum(propertyTypes).optional(),
    minPrice: z.number().nonnegative().max(1_000_000_000).optional(),
    maxPrice: z.number().positive().max(1_000_000_000).optional(),
    minBedrooms: z.number().int().nonnegative().max(30).optional(),
    minBathrooms: z.number().int().nonnegative().max(30).optional(),
    minParkingSpaces: z.number().int().nonnegative().max(30).optional(),
    minAreaM2: z.number().nonnegative().max(1_000_000).optional(),
    purpose: z.enum(['LIVE', 'INVEST']).optional(),
    paymentMethod: z.enum(['CASH', 'FINANCING', 'CONSORTIUM', 'OTHER']).optional(),
    financingPreApproved: z.boolean().optional(),
    downPayment: z.number().nonnegative().max(1_000_000_000).optional(),
    purchaseTimelineDays: z.number().int().positive().max(3_650).optional(),
    features: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    notes: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    interactedPropertyId: z.string().trim().min(1).max(120).optional(),
    requestedVisit: z.boolean().optional(),
    requestedHuman: z.boolean().optional(),
  })
  .strict();

export type LeadProfile = z.infer<typeof LeadProfileSchema>;
export type LeadIntent = (typeof leadIntents)[number];
export type PropertyType = (typeof propertyTypes)[number];
export type TransactionType = (typeof transactionTypes)[number];

export function mergeLeadProfiles(current: LeadProfile, extracted: LeadProfile): LeadProfile {
  const merged: LeadProfile = { ...current, ...extracted };
  if (current.neighborhoods || extracted.neighborhoods) {
    merged.neighborhoods = unique([...(current.neighborhoods ?? []), ...(extracted.neighborhoods ?? [])]);
  }
  if (current.features || extracted.features) {
    merged.features = unique([...(current.features ?? []), ...(extracted.features ?? [])]);
  }
  if (current.notes || extracted.notes) {
    merged.notes = unique([...(current.notes ?? []), ...(extracted.notes ?? [])]).slice(-20);
  }
  return LeadProfileSchema.parse(merged);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
