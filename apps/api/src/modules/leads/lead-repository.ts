import { Prisma, type Lead, type PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../domain/errors.js';
import { LeadProfileSchema, type LeadIntent, type LeadProfile } from '../../domain/leads/lead-profile.js';
import type { LeadScoreResult } from '../../domain/leads/lead-scoring.js';

export interface LeadRecord extends Omit<Lead, 'profile'> {
  profile: LeadProfile;
}

export class LeadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(tenantId: string, phone: string): Promise<{ lead: LeadRecord; created: boolean }> {
    const existing = await this.prisma.lead.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    if (existing) return { lead: toLeadRecord(existing), created: false };
    try {
      const created = await this.prisma.lead.create({ data: { tenantId, phone, lastInteractionAt: new Date() } });
      return { lead: toLeadRecord(created), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.lead.findUniqueOrThrow({ where: { tenantId_phone: { tenantId, phone } } });
        return { lead: toLeadRecord(raced), created: false };
      }
      throw error;
    }
  }

  async getById(tenantId: string, id: string): Promise<LeadRecord> {
    const row = await this.prisma.lead.findFirst({ where: { tenantId, id } });
    if (!row) throw new NotFoundError('Lead');
    return toLeadRecord(row);
  }

  async list(tenantId: string, take = 50): Promise<LeadRecord[]> {
    const rows = await this.prisma.lead.findMany({ where: { tenantId }, take, orderBy: { updatedAt: 'desc' } });
    return rows.map(toLeadRecord);
  }

  async updateProfile(
    tenantId: string,
    id: string,
    profile: LeadProfile,
    intent: LeadIntent,
    score: LeadScoreResult,
  ): Promise<LeadRecord> {
    await this.getById(tenantId, id);
    const row = await this.prisma.lead.update({
      where: { id },
      data: {
        profile: profile as Prisma.InputJsonValue,
        intent,
        score: score.score,
        temperature: score.temperature,
        lastInteractionAt: new Date(),
        ...(profile.name ? { name: profile.name } : {}),
      },
    });
    return toLeadRecord(row);
  }

  async patch(tenantId: string, id: string, input: { name?: string; status?: string; profile?: LeadProfile }): Promise<LeadRecord> {
    await this.getById(tenantId, id);
    const row = await this.prisma.lead.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.profile !== undefined ? { profile: input.profile as Prisma.InputJsonValue } : {}),
      },
    });
    return toLeadRecord(row);
  }
}

function toLeadRecord(row: Lead): LeadRecord {
  return { ...row, profile: LeadProfileSchema.parse(row.profile) };
}
