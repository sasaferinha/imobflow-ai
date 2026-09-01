import type { FastifyBaseLogger } from 'fastify';
import { OutboxRepository } from '../../infrastructure/events/outbox-repository.js';
import { ConversationRepository } from '../../modules/conversations/conversation-repository.js';
import { LeadRepository } from '../../modules/leads/lead-repository.js';
import { formatBrokerSummary } from '../responses/broker-summary.js';

export class HandoffService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly leads: LeadRepository,
    private readonly outbox: OutboxRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async request(tenantId: string, conversationId: string, correlationId: string) {
    const conversation = await this.conversations.getById(tenantId, conversationId);
    const lead = await this.leads.getById(tenantId, conversation.leadId);
    const summary = formatBrokerSummary({
      lead,
      conversationId,
      presentedPropertyIds: conversation.summary?.presentedPropertyIds ?? [],
      nextStep: 'Atendimento transferido manualmente para corretor',
    });
    const updated = await this.conversations.setStatus(tenantId, conversationId, 'HUMAN_HANDOFF');
    await this.outbox.add({
      tenantId,
      type: 'conversation.handoff_requested',
      aggregateType: 'Conversation',
      aggregateId: conversationId,
      payload: { leadId: lead.id, brokerSummary: summary, correlationId },
    });
    this.logger.info({ tenantId, conversationId, leadId: lead.id, correlationId }, 'human_handoff_requested_by_api');
    return { conversation: updated, brokerSummary: summary };
  }

  async resumeAi(tenantId: string, conversationId: string, correlationId: string) {
    const updated = await this.conversations.setStatus(tenantId, conversationId, 'AI_ACTIVE');
    await this.outbox.add({
      tenantId,
      type: 'conversation.ai_resumed',
      aggregateType: 'Conversation',
      aggregateId: conversationId,
      payload: { correlationId },
    });
    this.logger.info({ tenantId, conversationId, correlationId }, 'conversation_ai_resumed');
    return updated;
  }
}
