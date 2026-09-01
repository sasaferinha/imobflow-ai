import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/domain/errors.js';
import { ConversationRepository } from '../../src/modules/conversations/conversation-repository.js';
import { FollowUpService } from '../../src/modules/followups/follow-up-service.js';
import { LeadRepository } from '../../src/modules/leads/lead-repository.js';
import { PropertyRepository } from '../../src/modules/properties/property-repository.js';

describe('repository tenant isolation', () => {
  it('scopes lead reads by both tenant and resource id', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new LeadRepository({ lead: { findFirst } } as unknown as PrismaClient);

    await expect(repository.getById('tenant-a', 'lead-1')).rejects.toBeInstanceOf(NotFoundError);
    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', id: 'lead-1' } });
  });

  it('scopes conversation detail reads by tenant and conversation id', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new ConversationRepository({
      conversation: { findFirst },
    } as unknown as PrismaClient);

    await expect(repository.getById('tenant-b', 'conversation-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-b', id: 'conversation-1' },
      include: {
        lead: true,
        summary: true,
        messages: { orderBy: { timestamp: 'asc' }, take: 100 },
      },
    });
  });

  it('scopes message reads and status writes by tenant', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = new ConversationRepository({
      message: { findMany, updateMany },
    } as unknown as PrismaClient);

    await expect(repository.recentMessages('tenant-c', 'conversation-2', 8)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-c', conversationId: 'conversation-2' },
      orderBy: { timestamp: 'desc' },
      take: 8,
    });

    await repository.setMessageStatus('tenant-c', 'message-1', 'PROCESSED');
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-c', id: 'message-1' },
      data: { processingStatus: 'PROCESSED' },
    });
  });

  it('scopes property references by tenant even when accepting either internal or external ids', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PropertyRepository({
      property: { findFirst },
    } as unknown as PrismaClient);

    await expect(repository.getByReference('tenant-d', 'REF-9')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-d',
        OR: [{ id: 'REF-9' }, { externalId: 'REF-9' }],
      },
    });
  });

  it('scopes cancellation of pending follow-ups by tenant and lead', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new FollowUpService(
      { followUpJob: { updateMany } } as unknown as PrismaClient,
      { add: vi.fn() } as never,
    );

    await service.cancelPendingForLead('tenant-e', 'lead-5');

    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-e', leadId: 'lead-5', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  });
});
