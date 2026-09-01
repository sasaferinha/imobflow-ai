import type { Appointment, PrismaClient } from '@prisma/client';
import { NotFoundError } from '../../domain/errors.js';
import type { AppointmentCreateInput } from './appointment-schemas.js';

export class AppointmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, input: AppointmentCreateInput, externalId?: string): Promise<Appointment> {
    const lead = await this.prisma.lead.findFirst({ where: { tenantId, id: input.leadId }, select: { id: true } });
    if (!lead) throw new NotFoundError('Lead');
    if (input.propertyId) {
      const property = await this.prisma.property.findFirst({ where: { tenantId, id: input.propertyId }, select: { id: true } });
      if (!property) throw new NotFoundError('Imóvel');
    }
    if (input.brokerId) {
      const broker = await this.prisma.broker.findFirst({ where: { tenantId, id: input.brokerId }, select: { id: true } });
      if (!broker) throw new NotFoundError('Corretor');
    }
    return this.prisma.appointment.create({
      data: {
        tenantId,
        leadId: input.leadId,
        scheduledAt: input.scheduledAt,
        duration: input.duration,
        ...(input.propertyId !== undefined ? { propertyId: input.propertyId } : {}),
        ...(input.brokerId !== undefined ? { brokerId: input.brokerId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(externalId ? { externalId } : {}),
      },
    });
  }

  async list(tenantId: string, from?: Date, to?: Date): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: {
        tenantId,
        ...(from || to ? { scheduledAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: 200,
    });
  }
}
