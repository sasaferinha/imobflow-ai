import { Prisma, type PrismaClient } from '@prisma/client';

export interface DomainEventInput {
  tenantId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
}

export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(event: DomainEventInput): Promise<void> {
    await this.prisma.outboxEvent.create({
      data: {
        tenantId: event.tenantId,
        type: event.type,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        ...(event.availableAt ? { availableAt: event.availableAt } : {}),
      },
    });
  }
}
