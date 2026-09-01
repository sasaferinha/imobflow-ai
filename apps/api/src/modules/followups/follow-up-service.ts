import { Prisma, type PrismaClient } from '@prisma/client';
import { OutboxRepository } from '../../infrastructure/events/outbox-repository.js';

export class FollowUpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly outbox: OutboxRepository,
  ) {}

  async schedule(input: {
    tenantId: string;
    leadId: string;
    runAt: Date;
    reason: string;
    payload?: Prisma.InputJsonValue;
  }): Promise<string> {
    const job = await this.prisma.followUpJob.create({
      data: {
        tenantId: input.tenantId,
        leadId: input.leadId,
        runAt: input.runAt,
        reason: input.reason,
        payload: input.payload ?? {},
      },
    });
    await this.outbox.add({
      tenantId: input.tenantId,
      type: 'followup.requested',
      aggregateType: 'FollowUpJob',
      aggregateId: job.id,
      availableAt: input.runAt,
      payload: { followUpJobId: job.id, leadId: input.leadId, reason: input.reason, runAt: input.runAt.toISOString() },
    });
    return job.id;
  }

  async cancelPendingForLead(tenantId: string, leadId: string): Promise<void> {
    await this.prisma.followUpJob.updateMany({ where: { tenantId, leadId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  }
}
