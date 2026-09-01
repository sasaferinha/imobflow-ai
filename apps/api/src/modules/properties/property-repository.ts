import { Prisma, type PrismaClient, type Property } from '@prisma/client';
import { NotFoundError } from '../../domain/errors.js';
import { propertyMatchesFilters, rankProperties } from '../../domain/properties/property-matching.js';
import type { PropertyRecord, PropertySearchFilters, RankedProperty } from '../../domain/properties/property.js';
import type { PropertyCreateInput, PropertyPatchInput } from './property-schemas.js';

export class PropertyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async search(tenantId: string, filters: PropertySearchFilters): Promise<RankedProperty[]> {
    const where: Prisma.PropertyWhereInput = {
      tenantId,
      available: true,
      status: 'ACTIVE',
      ...(filters.transactionType ? { transactionType: filters.transactionType } : {}),
      ...(filters.propertyType ? { propertyType: filters.propertyType } : {}),
      ...(filters.city ? { city: { equals: filters.city, mode: 'insensitive' } } : {}),
      ...(filters.state ? { state: filters.state.toUpperCase() } : {}),
      ...(filters.minPrice !== undefined || filters.maxPrice !== undefined
        ? { price: { ...(filters.minPrice !== undefined ? { gte: filters.minPrice } : {}), ...(filters.maxPrice !== undefined ? { lte: filters.maxPrice } : {}) } }
        : {}),
      ...(filters.minBedrooms !== undefined ? { bedrooms: { gte: filters.minBedrooms } } : {}),
      ...(filters.minBathrooms !== undefined ? { bathrooms: { gte: filters.minBathrooms } } : {}),
      ...(filters.minParkingSpaces !== undefined ? { parkingSpaces: { gte: filters.minParkingSpaces } } : {}),
      ...(filters.minAreaM2 !== undefined ? { areaM2: { gte: filters.minAreaM2 } } : {}),
      ...(filters.furnished !== undefined ? { furnished: filters.furnished } : {}),
      ...(filters.acceptsFinancing !== undefined ? { acceptsFinancing: filters.acceptsFinancing } : {}),
    };
    const rows = await this.prisma.property.findMany({ where, take: 100, orderBy: [{ updatedAt: 'desc' }] });
    const matching = rows.map(toPropertyRecord).filter((property) => propertyMatchesFilters(property, filters));
    return rankProperties(matching, filters);
  }

  async list(tenantId: string, filters: PropertySearchFilters): Promise<RankedProperty[]> {
    return this.search(tenantId, filters);
  }

  async getById(tenantId: string, id: string): Promise<PropertyRecord> {
    const row = await this.prisma.property.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('Imóvel');
    return toPropertyRecord(row);
  }

  async getByReference(tenantId: string, reference: string): Promise<PropertyRecord> {
    const row = await this.prisma.property.findFirst({ where: { tenantId, OR: [{ id: reference }, { externalId: reference }] } });
    if (!row) throw new NotFoundError('Imóvel');
    return toPropertyRecord(row);
  }

  async create(tenantId: string, input: PropertyCreateInput): Promise<PropertyRecord> {
    const row = await this.prisma.property.create({
      data: {
        tenantId,
        externalId: input.externalId,
        title: input.title,
        description: input.description,
        transactionType: input.transactionType,
        propertyType: input.propertyType,
        status: input.status,
        price: input.price,
        city: input.city,
        state: input.state,
        neighborhood: input.neighborhood,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        parkingSpaces: input.parkingSpaces,
        areaM2: input.areaM2,
        furnished: input.furnished,
        acceptsFinancing: input.acceptsFinancing,
        features: input.features,
        imageUrls: input.imageUrls,
        available: input.available,
        ...(input.condoFee !== undefined ? { condoFee: input.condoFee } : {}),
        ...(input.propertyTax !== undefined ? { propertyTax: input.propertyTax } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
        ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
        ...(input.propertyUrl !== undefined ? { propertyUrl: input.propertyUrl } : {}),
        ...(input.brokerId !== undefined ? { brokerId: input.brokerId } : {}),
      },
    });
    return toPropertyRecord(row);
  }

  async update(tenantId: string, id: string, input: PropertyPatchInput): Promise<PropertyRecord> {
    await this.getById(tenantId, id);
    const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Prisma.PropertyUncheckedUpdateInput;
    const row = await this.prisma.property.update({ where: { id }, data });
    return toPropertyRecord(row);
  }
}

export function toPropertyRecord(row: Property): PropertyRecord {
  return {
    id: row.id,
    externalId: row.externalId,
    title: row.title,
    description: row.description,
    transactionType: row.transactionType,
    propertyType: row.propertyType,
    status: row.status,
    price: row.price.toNumber(),
    condoFee: row.condoFee?.toNumber() ?? null,
    propertyTax: row.propertyTax?.toNumber() ?? null,
    city: row.city,
    state: row.state,
    neighborhood: row.neighborhood,
    address: row.address,
    latitude: row.latitude?.toNumber() ?? null,
    longitude: row.longitude?.toNumber() ?? null,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    parkingSpaces: row.parkingSpaces,
    areaM2: row.areaM2.toNumber(),
    furnished: row.furnished,
    acceptsFinancing: row.acceptsFinancing,
    features: row.features,
    imageUrls: row.imageUrls,
    propertyUrl: row.propertyUrl,
    brokerId: row.brokerId,
    available: row.available,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
