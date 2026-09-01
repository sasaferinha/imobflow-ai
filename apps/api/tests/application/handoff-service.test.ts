import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { HandoffService } from '../../src/application/handoff/handoff-service.js';
import type { OutboxRepository } from '../../src/infrastructure/events/outbox-repository.js';
import type { ConversationRepository } from '../../src/modules/conversations/conversation-repository.js';
import type { LeadRecord, LeadRepository } from '../../src/modules/leads/lead-repository.js';

function lead(): LeadRecord {
  return {
    id: 'lead-1',
    tenantId: 'tenant-a',
    phone: '+5511999990000',
    name: 'Ana',
    email: null,
    intent: 'BUY_PROPERTY',
    profile: {
      transactionType: 'BUY',
      propertyType: 'APARTMENT',
      city: 'São Paulo',
      neighborhoods: ['Pinheiros'],
      maxPrice: 900_000,
      minBedrooms: 2,
      paymentMethod: 'FINANCING',
    },
    score: 75,
    temperature: 'HOT',
    status: 'ACTIVE',
    lastInteractionAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function logger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(),
    level: 'info',
  } as unknown as FastifyBaseLogger;
}

describe('HandoffService', () => {
  it('loads, updates, logs, and emits the handoff inside the requested tenant', async () => {
    const conversation = {
      id: 'conversation-1',
      leadId: 'lead-1',
      summary: { presentedPropertyIds: ['REF-1', 'REF-2'] },
    };
    const updatedConversation = { ...conversation, status: 'HUMAN_HANDOFF' };
    const conversations = {
      getById: vi.fn().mockResolvedValue(conversation),
      setStatus: vi.fn().mockResolvedValue(updatedConversation),
    };
    const leads = { getById: vi.fn().mockResolvedValue(lead()) };
    const outbox = { add: vi.fn().mockResolvedValue(undefined) };
    const testLogger = logger();
    const service = new HandoffService(
      conversations as unknown as ConversationRepository,
      leads as unknown as LeadRepository,
      outbox as unknown as OutboxRepository,
      testLogger,
    );

    const result = await service.request('tenant-a', 'conversation-1', 'correlation-1');

    expect(conversations.getById).toHaveBeenCalledWith('tenant-a', 'conversation-1');
    expect(leads.getById).toHaveBeenCalledWith('tenant-a', 'lead-1');
    expect(conversations.setStatus).toHaveBeenCalledWith(
      'tenant-a',
      'conversation-1',
      'HUMAN_HANDOFF',
    );
    expect(outbox.add).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      type: 'conversation.handoff_requested',
      aggregateType: 'Conversation',
      aggregateId: 'conversation-1',
      payload: {
        leadId: 'lead-1',
        brokerSummary: expect.stringContaining('Imóveis apresentados: REF-1, REF-2'),
        correlationId: 'correlation-1',
      },
    });
    expect(result.conversation).toBe(updatedConversation);
    expect(result.brokerSummary).toContain('Nome: Ana');
    expect(result.brokerSummary).toContain('Lead Score: 75/100');
    expect(testLogger.info).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-a',
        conversationId: 'conversation-1',
        leadId: 'lead-1',
        correlationId: 'correlation-1',
      },
      'human_handoff_requested_by_api',
    );
  });

  it('resumes AI only for the tenant-scoped conversation and emits a scoped event', async () => {
    const updatedConversation = { id: 'conversation-1', status: 'AI_ACTIVE' };
    const conversations = {
      setStatus: vi.fn().mockResolvedValue(updatedConversation),
    };
    const outbox = { add: vi.fn().mockResolvedValue(undefined) };
    const service = new HandoffService(
      conversations as unknown as ConversationRepository,
      {} as unknown as LeadRepository,
      outbox as unknown as OutboxRepository,
      logger(),
    );

    await expect(
      service.resumeAi('tenant-b', 'conversation-1', 'correlation-2'),
    ).resolves.toBe(updatedConversation);
    expect(conversations.setStatus).toHaveBeenCalledWith(
      'tenant-b',
      'conversation-1',
      'AI_ACTIVE',
    );
    expect(outbox.add).toHaveBeenCalledWith({
      tenantId: 'tenant-b',
      type: 'conversation.ai_resumed',
      aggregateType: 'Conversation',
      aggregateId: 'conversation-1',
      payload: { correlationId: 'correlation-2' },
    });
  });
});
