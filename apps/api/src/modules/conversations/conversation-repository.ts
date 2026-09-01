import {
  Prisma,
  type Conversation,
  type ConversationStatus,
  type LeadIntent,
  type Message,
  type MessageType,
  type PrismaClient,
  type ProcessingStatus,
} from '@prisma/client';
import { DuplicateMessageError, NotFoundError } from '../../domain/errors.js';
import type { LeadProfile } from '../../domain/leads/lead-profile.js';

export class ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreateActive(tenantId: string, leadId: string): Promise<{ conversation: Conversation; created: boolean }> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, leadId, status: { in: ['AI_ACTIVE', 'HUMAN_HANDOFF'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { conversation: existing, created: false };
    const conversation = await this.prisma.conversation.create({ data: { tenantId, leadId } });
    return { conversation, created: true };
  }

  async getById(tenantId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, id },
      include: { lead: true, summary: true, messages: { orderBy: { timestamp: 'asc' }, take: 100 } },
    });
    if (!conversation) throw new NotFoundError('Conversa');
    return conversation;
  }

  async createInbound(input: {
    tenantId: string;
    conversationId: string;
    sender: string;
    content: string;
    externalMessageId: string;
    messageType: MessageType;
    metadata?: Prisma.InputJsonValue;
    timestamp?: Date;
  }): Promise<Message> {
    try {
      const message = await this.prisma.message.create({
        data: {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          direction: 'INBOUND',
          sender: input.sender,
          content: input.content,
          whatsappMessageId: input.externalMessageId,
          messageType: input.messageType,
          metadata: input.metadata ?? {},
          timestamp: input.timestamp ?? new Date(),
        },
      });
      await this.prisma.conversation.update({ where: { id: input.conversationId }, data: { lastMessageAt: message.timestamp } });
      return message;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateMessageError(input.externalMessageId);
      }
      throw error;
    }
  }

  async createOutbound(input: {
    tenantId: string;
    conversationId: string;
    recipient: string;
    content: string;
    externalMessageId?: string;
    messageType?: MessageType;
    metadata?: Prisma.InputJsonValue;
    processingStatus?: ProcessingStatus;
  }): Promise<Message> {
    return this.prisma.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: 'OUTBOUND',
        sender: 'AI_AGENT',
        content: input.content,
        messageType: input.messageType ?? 'TEXT',
        processingStatus: input.processingStatus ?? 'PROCESSED',
        ...(input.externalMessageId ? { whatsappMessageId: input.externalMessageId } : {}),
        metadata: input.metadata ?? { recipient: input.recipient },
      },
    });
  }

  async recentMessages(tenantId: string, conversationId: string, limit = 12): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({ where: { tenantId, conversationId }, orderBy: { timestamp: 'desc' }, take: limit });
    return rows.reverse();
  }

  async setMessageStatus(tenantId: string, messageId: string, status: ProcessingStatus, error?: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { tenantId, id: messageId },
      data: { processingStatus: status, ...(error ? { metadata: { error: error.slice(0, 500) } } : {}) },
    });
  }

  async setStatus(tenantId: string, id: string, status: ConversationStatus): Promise<Conversation> {
    await this.getById(tenantId, id);
    return this.prisma.conversation.update({ where: { id }, data: { status } });
  }

  async upsertSummary(input: {
    tenantId: string;
    conversationId: string;
    leadName?: string;
    intent: LeadIntent;
    preferences: LeadProfile;
    presentedPropertyIds?: string[];
    questions?: string[];
    objections?: string[];
    stage: string;
    nextStep?: string;
    messageCount: number;
  }) {
    const existing = await this.prisma.conversationSummary.findUnique({ where: { conversationId: input.conversationId } });
    const propertyIds = [...new Set([...(existing?.presentedPropertyIds ?? []), ...(input.presentedPropertyIds ?? [])])];
    return this.prisma.conversationSummary.upsert({
      where: { conversationId: input.conversationId },
      create: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        intent: input.intent,
        preferences: input.preferences as Prisma.InputJsonValue,
        presentedPropertyIds: propertyIds,
        stage: input.stage,
        messageCount: input.messageCount,
        ...(input.leadName ? { leadName: input.leadName } : {}),
        ...(input.questions ? { questions: input.questions } : {}),
        ...(input.objections ? { objections: input.objections } : {}),
        ...(input.nextStep ? { nextStep: input.nextStep } : {}),
      },
      update: {
        intent: input.intent,
        preferences: input.preferences as Prisma.InputJsonValue,
        presentedPropertyIds: propertyIds,
        stage: input.stage,
        messageCount: input.messageCount,
        ...(input.leadName ? { leadName: input.leadName } : {}),
        ...(input.questions ? { questions: input.questions } : {}),
        ...(input.objections ? { objections: input.objections } : {}),
        ...(input.nextStep ? { nextStep: input.nextStep } : {}),
      },
    });
  }
}
