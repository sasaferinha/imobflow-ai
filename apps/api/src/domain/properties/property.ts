import { z } from 'zod';
import { propertyTypes, transactionTypes } from '../leads/lead-profile.js';

export const PropertySearchFiltersSchema = z
  .object({
    transactionType: z.enum(transactionTypes).optional(),
    propertyType: z.enum(propertyTypes).optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state: z.string().trim().length(2).toUpperCase().optional(),
    neighborhoods: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().positive().optional(),
    minBedrooms: z.coerce.number().int().nonnegative().optional(),
    minBathrooms: z.coerce.number().int().nonnegative().optional(),
    minParkingSpaces: z.coerce.number().int().nonnegative().optional(),
    minAreaM2: z.coerce.number().nonnegative().optional(),
    furnished: z.coerce.boolean().optional(),
    acceptsFinancing: z.coerce.boolean().optional(),
    features: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict()
  .refine((value) => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice, {
    message: 'minPrice não pode ser maior que maxPrice',
    path: ['minPrice'],
  });

export type PropertySearchFilters = z.infer<typeof PropertySearchFiltersSchema>;

export interface PropertyRecord {
  id: string;
  externalId: string;
  title: string;
  description: string;
  transactionType: 'BUY' | 'RENT';
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'OTHER';
  status: 'ACTIVE' | 'INACTIVE' | 'SOLD' | 'RENTED';
  price: number;
  condoFee: number | null;
  propertyTax: number | null;
  city: string;
  state: string;
  neighborhood: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  bedrooms: number;
  bathrooms: number;
  parkingSpaces: number;
  areaM2: number;
  furnished: boolean;
  acceptsFinancing: boolean;
  features: string[];
  imageUrls: string[];
  propertyUrl: string | null;
  brokerId: string | null;
  available: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RankedProperty {
  property: PropertyRecord;
  score: number;
  reasons: string[];
}
