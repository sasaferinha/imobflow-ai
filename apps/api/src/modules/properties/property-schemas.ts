import { z } from 'zod';
import { propertyTypes, transactionTypes } from '../../domain/leads/lead-profile.js';

export const PropertyCreateSchema = z
  .object({
    externalId: z.string().trim().min(1).max(120),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(5_000),
    transactionType: z.enum(transactionTypes),
    propertyType: z.enum(propertyTypes),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SOLD', 'RENTED']).default('ACTIVE'),
    price: z.number().positive().max(1_000_000_000),
    condoFee: z.number().nonnegative().nullable().optional(),
    propertyTax: z.number().nonnegative().nullable().optional(),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().length(2).toUpperCase(),
    neighborhood: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    bedrooms: z.number().int().nonnegative().max(100).default(0),
    bathrooms: z.number().int().nonnegative().max(100).default(0),
    parkingSpaces: z.number().int().nonnegative().max(100).default(0),
    areaM2: z.number().positive().max(1_000_000),
    furnished: z.boolean().default(false),
    acceptsFinancing: z.boolean().default(true),
    features: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    imageUrls: z.array(z.string().url()).max(30).default([]),
    propertyUrl: z.string().url().nullable().optional(),
    brokerId: z.string().nullable().optional(),
    available: z.boolean().default(true),
  })
  .strict();

export const PropertyPatchSchema = PropertyCreateSchema.partial().omit({ externalId: true });
export type PropertyCreateInput = z.infer<typeof PropertyCreateSchema>;
export type PropertyPatchInput = z.infer<typeof PropertyPatchSchema>;
