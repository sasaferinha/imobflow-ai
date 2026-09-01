import type { PrismaClient, PropertyInterestKind } from '@prisma/client';

export class PropertyInterestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async recordMany(tenantId: string, leadId: string, propertyIds: string[], kind: PropertyInterestKind = 'PRESENTED'): Promise<void> {
    if (propertyIds.length === 0) return;
    await this.prisma.propertyInterest.createMany({
      data: propertyIds.map((propertyId) => ({ tenantId, leadId, propertyId, kind })),
      skipDuplicates: true,
    });
  }

  async listForLead(tenantId: string, leadId: string) {
    return this.prisma.propertyInterest.findMany({
      where: { tenantId, leadId },
      include: { property: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
