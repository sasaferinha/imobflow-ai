import type { MessageType, Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { DuplicateMessageError, ProviderError } from '../../domain/errors.js';
import { OutboxRepository } from '../../infrastructure/events/outbox-repository.js';
import { ConversationRepository } from '../../modules/conversations/conversation-repository.js';
import { FollowUpService } from '../../modules/followups/follow-up-service.js';
import { LeadRepository } from '../../modules/leads/lead-repository.js';
import { ConversationOrchestrator, type OrchestratorResult } from '../orchestrator/conversation-orchestrator.js';

export interface InboundMessage {
  tenantId: string;
  phone: string;
  content: string;
  externalMessageId: string;
  messageType: MessageType;
  timestamp?: Date;
  metadata?: Prisma.InputJsonObject;
  correlationId: string;
}

export interface OutboundMessagePort {
  sendText(input: {
    to: string;
    text: string;
    correlationId: string;
  }): Promise<{ externalMessageId?: string }>;
}

export type IngestionResult =
  | { duplicate: true; externalMessageId: string }
  | {
      duplicate: false;
      leadId: string;
      conversationId: string;
      inboundMessageId: string;
      reply: string | null;
      handoff: boolean;
      matchedPropertyIds: string[];
      score: number;
      temperature: string;
    };

export class MessageIngestionService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly conversations: ConversationRepository,
    private readonly orchestrator: ConversationOrchestrator,
    private readonly sender: OutboundMessagePort,
    private readonly outbox: OutboxRepository,
    private readonly followUps: FollowUpService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async ingest(input: InboundMessage): Promise<IngestionResult> {
    const startedAt = performance.now();
    const { lead, created: leadCreated } = await this.leads.getOrCreate(input.tenantId, normalizePhone(input.phone));
    if (leadCreated) {
      await this.outbox.add({
        tenantId: input.tenantId,
        type: 'lead.created',
        aggregateType: 'Lead',
        aggregateId: lead.id,
        payload: { source: 'WHATSAPP', correlationId: input.correlationId },
      });
    }
    const { conversation, created: conversationCreated } = await this.conversations.getOrCreateActive(input.tenantId, lead.id);
    if (conversationCreated) {
      await this.outbox.add({
        tenantId: input.tenantId,
        type: 'conversation.started',
        aggregateType: 'Conversation',
        aggregateId: conversation.id,
        payload: { leadId: lead.id, channel: 'WHATSAPP', correlationId: input.correlationId },
      });
    }

    let message;
    try {
      message = await this.conversations.createInbound({
        tenantId: input.tenantId,
        conversationId: conversation.id,
        sender: normalizePhone(input.phone),
        content: input.content,
        externalMessageId: input.externalMessageId,
        messageType: input.messageType,
        ...(input.timestamp ? { timestamp: input.timestamp } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
    } catch (error) {
      if (error instanceof DuplicateMessageError) {
        this.logger.info({ tenantId: input.tenantId, externalMessageId: input.externalMessageId, correlationId: input.correlationId }, 'duplicate_message_ignored');
        return { duplicate: true, externalMessageId: input.externalMessageId };
      }
      throw error;
    }

    this.logger.info(
      { tenantId: input.tenantId, leadId: lead.id, conversationId: conversation.id, messageId: message.id, messageType: input.messageType, correlationId: input.correlationId },
      'message_received',
    );
    await this.followUps.cancelPendingForLead(input.tenantId, lead.id);

    try {
      const result = await this.orchestrator.process({
        tenantId: input.tenantId,
        leadId: lead.id,
        conversationId: conversation.id,
        message,
        correlationId: input.correlationId,
      });
      if (result.reply) await this.deliverReply(input, conversation.id, result);
      if (result.matchedProperties.length > 0 && !result.handoff) {
        await this.followUps.schedule({
          tenantId: input.tenantId,
          leadId: lead.id,
          runAt: new Date(Date.now() + 48 * 60 * 60 * 1_000),
          reason: 'PROPERTY_RECOMMENDATION_NO_REPLY',
          payload: { conversationId: conversation.id, propertyIds: result.matchedProperties.map((property) => property.id) },
        });
      }
      await this.conversations.setMessageStatus(input.tenantId, message.id, 'PROCESSED');
      this.logger.info(
        { tenantId: input.tenantId, conversationId: conversation.id, messageId: message.id, durationMs: Math.round(performance.now() - startedAt), correlationId: input.correlationId },
        'message_pipeline_completed',
      );
      return {
        duplicate: false,
        leadId: lead.id,
        conversationId: conversation.id,
        inboundMessageId: message.id,
        reply: result.reply,
        handoff: result.handoff,
        matchedPropertyIds: result.matchedProperties.map((property) => property.id),
        score: result.lead.score,
        temperature: result.lead.temperature,
      };
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Erro desconhecido';
      await this.conversations.setMessageStatus(input.tenantId, message.id, 'FAILED', details);
      this.logger.error({ err: error, tenantId: input.tenantId, conversationId: conversation.id, messageId: message.id, correlationId: input.correlationId }, 'message_pipeline_failed');
      throw error;
    }
  }

  private async deliverReply(input: InboundMessage, conversationId: string, result: OrchestratorResult): Promise<void> {
    try {
      const sent = await this.sender.sendText({
        to: normalizePhone(input.phone),
        text: result.reply!,
        correlationId: input.correlationId,
      });
      await this.conversations.createOutbound({
        tenantId: input.tenantId,
        conversationId,
        recipient: normalizePhone(input.phone),
        content: result.reply!,
        ...(sent.externalMessageId ? { externalMessageId: sent.externalMessageId } : {}),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Falha desconhecida';
      await this.conversations.createOutbound({
        tenantId: input.tenantId,
        conversationId,
        recipient: normalizePhone(input.phone),
        content: result.reply!,
        processingStatus: 'FAILED',
        metadata: { deliveryError: reason.slice(0, 500) },
      });
      await this.outbox.add({
        tenantId: input.tenantId,
        type: 'whatsapp.send_failed',
        aggregateType: 'Conversation',
        aggregateId: conversationId,
        payload: { correlationId: input.correlationId, reason: reason.slice(0, 500) },
      });
      throw new ProviderError('WhatsApp', 'Não foi possível enviar a resposta', { cause: reason });
    }
  }
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw new Error('Telefone inválido');
  return `+${digits}`;
}
