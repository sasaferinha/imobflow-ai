import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  MessageIngestionService,
  normalizePhone,
  type OutboundMessagePort,
} from '../../src/application/ingestion/message-ingestion-service.js';
import type { ConversationOrchestrator } from '../../src/application/orchestrator/conversation-orchestrator.js';
import { DuplicateMessageError } from '../../src/domain/errors.js';
import type { PropertyRecord } from '../../src/domain/properties/property.js';
import type { OutboxRepository } from '../../src/infrastructure/events/outbox-repository.js';
import type { ConversationRepository } from '../../src/modules/conversations/conversation-repository.js';
import type { FollowUpService } from '../../src/modules/followups/follow-up-service.js';
import type { LeadRecord, LeadRepository } from '../../src/modules/leads/lead-repository.js';

function lead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: 'lead-1',
    tenantId: 'tenant-a',
    phone: '+5511999990000',
    name: null,
    email: null,
    intent: 'UNKNOWN',
    profile: {},
    score: 0,
    temperature: 'COLD',
    status: 'ACTIVE',
    lastInteractionAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function logger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function input() {
  return {
    tenantId: 'tenant-a',
    phone: '+55 (11) 99999-0000',
    content: 'Quero comprar um apartamento',
    externalMessageId: 'wamid-1',
    messageType: 'TEXT' as const,
    correlationId: 'correlation-1',
  };
}

describe('MessageIngestionService idempotency', () => {
  it('short-circuits a duplicate external message before orchestration or delivery', async () => {
    const leads = {
      getOrCreate: vi.fn().mockResolvedValue({ lead: lead(), created: false }),
    };
    const conversations = {
      getOrCreateActive: vi.fn().mockResolvedValue({
        conversation: { id: 'conversation-1' },
        created: false,
      }),
      createInbound: vi.fn().mockRejectedValue(new DuplicateMessageError('wamid-1')),
      setMessageStatus: vi.fn(),
    };
    const orchestrator = { process: vi.fn() };
    const sender = { sendText: vi.fn() };
    const outbox = { add: vi.fn() };
    const followUps = { cancelPendingForLead: vi.fn(), schedule: vi.fn() };
    const service = new MessageIngestionService(
      leads as unknown as LeadRepository,
      conversations as unknown as ConversationRepository,
      orchestrator as unknown as ConversationOrchestrator,
      sender as OutboundMessagePort,
      outbox as unknown as OutboxRepository,
      followUps as unknown as FollowUpService,
      logger(),
    );

    await expect(service.ingest(input())).resolves.toEqual({
      duplicate: true,
      externalMessageId: 'wamid-1',
    });
    expect(leads.getOrCreate).toHaveBeenCalledWith('tenant-a', '+5511999990000');
    expect(conversations.getOrCreateActive).toHaveBeenCalledWith('tenant-a', 'lead-1');
    expect(conversations.createInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        conversationId: 'conversation-1',
        externalMessageId: 'wamid-1',
      }),
    );
    expect(orchestrator.process).not.toHaveBeenCalled();
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(followUps.cancelPendingForLead).not.toHaveBeenCalled();
    expect(conversations.setMessageStatus).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });
});

describe('MessageIngestionService tenant propagation', () => {
  it('keeps every side effect scoped to the inbound tenant', async () => {
    const createdLead = lead({ score: 72, temperature: 'HOT' });
    const inboundMessage = { id: 'message-1', messageType: 'TEXT', content: input().content };
    const matchedProperty = { id: 'property-1' } as PropertyRecord;
    const leads = {
      getOrCreate: vi.fn().mockResolvedValue({ lead: createdLead, created: true }),
    };
    const conversations = {
      getOrCreateActive: vi.fn().mockResolvedValue({
        conversation: { id: 'conversation-1' },
        created: true,
      }),
      createInbound: vi.fn().mockResolvedValue(inboundMessage),
      createOutbound: vi.fn().mockResolvedValue({ id: 'message-2' }),
      setMessageStatus: vi.fn().mockResolvedValue(undefined),
    };
    const orchestrator = {
      process: vi.fn().mockResolvedValue({
        reply: 'Encontrei uma opção.',
        handoff: false,
        lead: createdLead,
        matchedProperties: [matchedProperty],
        llmProvider: 'mock',
      }),
    };
    const sender = {
      sendText: vi.fn().mockResolvedValue({ externalMessageId: 'wamid-out-1' }),
    };
    const outbox = { add: vi.fn().mockResolvedValue(undefined) };
    const followUps = {
      cancelPendingForLead: vi.fn().mockResolvedValue(undefined),
      schedule: vi.fn().mockResolvedValue('followup-1'),
    };
    const service = new MessageIngestionService(
      leads as unknown as LeadRepository,
      conversations as unknown as ConversationRepository,
      orchestrator as unknown as ConversationOrchestrator,
      sender as OutboundMessagePort,
      outbox as unknown as OutboxRepository,
      followUps as unknown as FollowUpService,
      logger(),
    );

    const result = await service.ingest(input());

    expect(result).toEqual({
      duplicate: false,
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      inboundMessageId: 'message-1',
      reply: 'Encontrei uma opção.',
      handoff: false,
      matchedPropertyIds: ['property-1'],
      score: 72,
      temperature: 'HOT',
    });
    expect(outbox.add).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId: 'tenant-a', type: 'lead.created' }),
    );
    expect(outbox.add).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: 'tenant-a', type: 'conversation.started' }),
    );
    expect(followUps.cancelPendingForLead).toHaveBeenCalledWith('tenant-a', 'lead-1');
    expect(orchestrator.process).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      message: inboundMessage,
      correlationId: 'correlation-1',
    });
    expect(sender.sendText).toHaveBeenCalledWith({
      to: '+5511999990000',
      text: 'Encontrei uma opção.',
      correlationId: 'correlation-1',
    });
    expect(conversations.createOutbound).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      conversationId: 'conversation-1',
      recipient: '+5511999990000',
      content: 'Encontrei uma opção.',
      externalMessageId: 'wamid-out-1',
    });
    expect(followUps.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        leadId: 'lead-1',
        reason: 'PROPERTY_RECOMMENDATION_NO_REPLY',
        payload: { conversationId: 'conversation-1', propertyIds: ['property-1'] },
      }),
    );
    expect(conversations.setMessageStatus).toHaveBeenCalledWith(
      'tenant-a',
      'message-1',
      'PROCESSED',
    );
  });
});

describe('normalizePhone', () => {
  it('normalizes common punctuation and rejects implausible lengths', () => {
    expect(normalizePhone('+55 (11) 99999-0000')).toBe('+5511999990000');
    expect(() => normalizePhone('123')).toThrow('Telefone inválido');
    expect(() => normalizePhone('1'.repeat(16))).toThrow('Telefone inválido');
  });
});
