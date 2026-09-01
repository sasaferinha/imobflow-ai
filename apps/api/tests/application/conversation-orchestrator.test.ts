import type { Message } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ConversationOrchestrator } from '../../src/application/orchestrator/conversation-orchestrator.js';
import type { ToolRegistry } from '../../src/application/tools/tool-registry.js';
import type { OutboxRepository } from '../../src/infrastructure/events/outbox-repository.js';
import { LLMProviderError } from '../../src/integrations/ai/errors.js';
import type { LLMProvider } from '../../src/integrations/ai/llm-provider.js';
import { MockLLMProvider } from '../../src/integrations/ai/mock-llm-provider.js';
import type { ConversationRepository } from '../../src/modules/conversations/conversation-repository.js';
import type { LeadRecord, LeadRepository } from '../../src/modules/leads/lead-repository.js';

const now = new Date('2026-01-01T00:00:00.000Z');

function lead(): LeadRecord {
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
    createdAt: now,
    updatedAt: now,
  };
}

function inboundMessage(): Message {
  return {
    id: 'message-1',
    tenantId: 'tenant-a',
    conversationId: 'conversation-1',
    direction: 'INBOUND',
    sender: '+5511999990000',
    content: 'Olá, bom dia!',
    timestamp: now,
    whatsappMessageId: 'wamid-1',
    messageType: 'TEXT',
    metadata: {},
    processingStatus: 'RECEIVED',
    createdAt: now,
  };
}

describe('ConversationOrchestrator LLM fallback', () => {
  it('falls back to deterministic extraction and then to a safe reply when the primary output is invalid', async () => {
    const invalidOutput = new LLMProviderError('invalid structured output', {
      code: 'INVALID_STRUCTURED_OUTPUT',
      retryable: false,
    });
    const primary: LLMProvider = {
      providerName: 'openai',
      extractLeadProfile: vi.fn().mockRejectedValue(invalidOutput),
      generateReply: vi.fn().mockRejectedValue(invalidOutput),
      summarizeConversation: vi.fn().mockRejectedValue(invalidOutput),
    };
    const fallback = new MockLLMProvider();
    const fallbackExtraction = vi.spyOn(fallback, 'extractLeadProfile');
    const currentLead = lead();
    const leads = { getById: vi.fn().mockResolvedValue(currentLead) };
    const conversation = {
      id: 'conversation-1',
      tenantId: 'tenant-a',
      leadId: 'lead-1',
      status: 'AI_ACTIVE',
      messages: [inboundMessage()],
      summary: null,
    };
    const conversations = {
      getById: vi.fn().mockResolvedValue(conversation),
      upsertSummary: vi.fn().mockResolvedValue(undefined),
    };
    const tools = {
      execute: vi.fn().mockImplementation(async (name: string) => {
        if (name === 'updateLeadProfile') return currentLead;
        throw new Error(`Unexpected tool: ${name}`);
      }),
    };
    const outbox = { add: vi.fn().mockResolvedValue(undefined) };
    const testLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as FastifyBaseLogger;
    const orchestrator = new ConversationOrchestrator(
      primary,
      fallback,
      leads as unknown as LeadRepository,
      conversations as unknown as ConversationRepository,
      tools as unknown as ToolRegistry,
      outbox as unknown as OutboxRepository,
      testLogger,
      { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
    );

    const result = await orchestrator.process({
      tenantId: 'tenant-a',
      leadId: 'lead-1',
      conversationId: 'conversation-1',
      message: inboundMessage(),
      correlationId: 'correlation-1',
    });

    expect(primary.extractLeadProfile).toHaveBeenCalledOnce();
    expect(fallbackExtraction).toHaveBeenCalledOnce();
    expect(primary.generateReply).toHaveBeenCalledOnce();
    expect(result).toEqual({
      reply: 'Posso ajudar você a comprar, alugar ou saber mais sobre um imóvel. O que você procura?',
      handoff: false,
      lead: currentLead,
      matchedProperties: [],
      llmProvider: 'mock',
    });
    expect(tools.execute).toHaveBeenCalledWith(
      'updateLeadProfile',
      { profile: {}, intent: 'GENERAL_QUESTION' },
      {
        tenantId: 'tenant-a',
        leadId: 'lead-1',
        conversationId: 'conversation-1',
        correlationId: 'correlation-1',
      },
    );
    expect(conversations.upsertSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        conversationId: 'conversation-1',
        intent: 'GENERAL_QUESTION',
        messageCount: 1,
      }),
    );
    expect(testLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: invalidOutput, tenantId: 'tenant-a' }),
      'llm_extraction_failed_using_fallback',
    );
    expect(testLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: invalidOutput, tenantId: 'tenant-a' }),
      'llm_reply_failed_using_safe_message',
    );
  });
});
