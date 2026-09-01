import type { Conversation, Message, MessageType } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError } from '../../domain/errors.js';
import { LeadProfileSchema, mergeLeadProfiles, type LeadIntent, type LeadProfile } from '../../domain/leads/lead-profile.js';
import { profileToPropertyFilters } from '../../domain/properties/property-matching.js';
import type { PropertyRecord, RankedProperty } from '../../domain/properties/property.js';
import { OutboxRepository } from '../../infrastructure/events/outbox-repository.js';
import type {
  ConversationStage,
  ConversationSummary,
  LLMConversationMessage,
  LLMProvider,
  LLMResult,
} from '../../integrations/ai/llm-provider.js';
import { ConversationRepository } from '../../modules/conversations/conversation-repository.js';
import type { LeadRecord } from '../../modules/leads/lead-repository.js';
import { LeadRepository } from '../../modules/leads/lead-repository.js';
import { formatBrokerSummary } from '../responses/broker-summary.js';
import { formatPropertyRecommendations, nextQualificationQuestion } from '../responses/property-response.js';
import { ToolRegistry, type ToolContext } from '../tools/tool-registry.js';

export interface OrchestratorInput {
  tenantId: string;
  leadId: string;
  conversationId: string;
  message: Message;
  correlationId: string;
}

export interface OrchestratorResult {
  reply: string | null;
  handoff: boolean;
  lead: LeadRecord;
  matchedProperties: PropertyRecord[];
  llmProvider: string | null;
}

export class ConversationOrchestrator {
  constructor(
    private readonly llm: LLMProvider,
    private readonly fallbackLlm: LLMProvider,
    private readonly leads: LeadRepository,
    private readonly conversations: ConversationRepository,
    private readonly tools: ToolRegistry,
    private readonly outbox: OutboxRepository,
    private readonly logger: FastifyBaseLogger,
    private readonly costs: { inputUsdPerMillion: number; outputUsdPerMillion: number },
  ) {}

  async process(input: OrchestratorInput): Promise<OrchestratorResult> {
    const startedAt = performance.now();
    const context: ToolContext = {
      tenantId: input.tenantId,
      leadId: input.leadId,
      conversationId: input.conversationId,
      correlationId: input.correlationId,
    };
    const currentLead = await this.leads.getById(input.tenantId, input.leadId);

    if (input.message.messageType !== 'TEXT') {
      const reply = fallbackForUnsupportedType(input.message.messageType);
      await this.updateSummary({ context, lead: currentLead, intent: currentLead.intent, profile: currentLead.profile, presentedIds: [], stage: 'QUALIFYING' });
      return { reply, handoff: false, lead: currentLead, matchedProperties: [], llmProvider: null };
    }

    const conversation = await this.conversations.getById(input.tenantId, input.conversationId);
    if (conversation.status === 'HUMAN_HANDOFF') {
      return { reply: null, handoff: true, lead: currentLead, matchedProperties: [], llmProvider: null };
    }

    const recentMessages = toLlmMessages(conversation.messages);
    const previousSummary = toLlmSummary(conversation.summary, currentLead.profile, currentLead.intent);
    const extractionResult = await this.extractSafely(input.message.content, currentLead.profile, recentMessages, previousSummary, context);
    const extraction = extractionResult.data;
    const profile = mergeLeadProfiles(currentLead.profile, extraction.extractedFields);
    const intent = chooseIntent(extraction.intent, currentLead.intent);
    const updatedLead = (await this.tools.execute('updateLeadProfile', { profile, intent }, context)) as LeadRecord;

    await this.emitLeadMilestones(currentLead, updatedLead, profile, context);

    let matches: RankedProperty[] = [];
    if (profile.interactedPropertyId) {
      try {
        const property = (await this.tools.execute('getPropertyDetails', { propertyId: profile.interactedPropertyId }, context)) as PropertyRecord;
        matches = [{ property, score: 100, reasons: ['imóvel solicitado pelo lead'] }];
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    } else if (shouldSearch(profile) && shouldRunNewSearch(extraction.extractedFields, previousSummary)) {
      matches = (await this.tools.execute('searchProperties', profileToPropertyFilters(profile), context)) as RankedProperty[];
      this.logger.info(
        { ...context, resultCount: matches.length, propertyIds: matches.map((match) => match.property.id) },
        'property_search_completed',
      );
    }

    const presentedIds = matches.map((match) => match.property.externalId);
    const humanRequested = extraction.requestsHumanHandoff || profile.requestedHuman === true || intent === 'HUMAN_REQUEST';
    let reply: string;
    let stage: ConversationStage = matches.length ? 'PRESENTING_PROPERTIES' : 'QUALIFYING';
    let nextStep: string | undefined;

    if (humanRequested) {
      stage = 'HUMAN_HANDOFF';
      nextStep = 'Corretor deve assumir o atendimento';
      const brokerSummary = formatBrokerSummary({
        lead: updatedLead,
        conversationId: input.conversationId,
        presentedPropertyIds: [...(previousSummary?.shownPropertyIds ?? []), ...presentedIds],
        nextStep,
      });
      await this.tools.execute('requestHumanHandoff', { brokerSummary }, context);
      reply = 'Claro. Vou transferir seu atendimento para um corretor. Ele continuará a conversa por aqui assim que possível.';
      this.logger.info(context, 'human_handoff_requested');
    } else if (profile.requestedVisit) {
      stage = 'APPOINTMENT';
      nextStep = 'Coletar data e horário exatos para a visita';
      await this.outbox.add({
        tenantId: input.tenantId,
        type: 'appointment.requested',
        aggregateType: 'Lead',
        aggregateId: input.leadId,
        payload: { conversationId: input.conversationId, propertyReference: profile.interactedPropertyId ?? null },
      });
      reply = 'Ótimo, posso registrar o pedido de visita. Qual data e horário você prefere? Um corretor confirmará a disponibilidade.';
    } else if (matches.length > 0 || shouldSearch(profile)) {
      reply = formatPropertyRecommendations(matches);
      nextStep = matches.length ? 'Escolher um imóvel ou solicitar visita' : 'Ajustar filtros da busca';
    } else if (isPropertyJourney(intent, profile)) {
      reply = nextQualificationQuestion(profile);
      nextStep = reply;
    } else {
      reply = await this.generateSafeReply(extractionResult, profile, recentMessages, previousSummary, context);
      nextStep = 'Continuar qualificação';
    }

    await this.updateSummary({
      context,
      lead: updatedLead,
      intent,
      profile,
      presentedIds,
      stage,
      ...(nextStep ? { nextStep } : {}),
    });

    this.logger.info(
      { ...context, intent, confidence: extraction.confidence, durationMs: Math.round(performance.now() - startedAt), llmProvider: extractionResult.provider },
      'message_processed',
    );
    return {
      reply,
      handoff: humanRequested,
      lead: updatedLead,
      matchedProperties: matches.map((match) => match.property),
      llmProvider: extractionResult.provider,
    };
  }

  private async extractSafely(
    message: string,
    profile: LeadProfile,
    recentMessages: LLMConversationMessage[],
    summary: ConversationSummary | undefined,
    context: ToolContext,
  ) {
    try {
      const result = await this.llm.extractLeadProfile({
        message,
        currentProfile: profile,
        recentMessages,
        ...(summary ? { conversationSummary: summary } : {}),
      });
      this.logUsage(result, context, 'extract');
      return result;
    } catch (error) {
      this.logger.error({ ...context, err: error }, 'llm_extraction_failed_using_fallback');
      const fallback = await this.fallbackLlm.extractLeadProfile({ message, currentProfile: profile, recentMessages, ...(summary ? { conversationSummary: summary } : {}) });
      this.logUsage(fallback, context, 'extract_fallback');
      return fallback;
    }
  }

  private async generateSafeReply(
    extraction: Awaited<ReturnType<LLMProvider['extractLeadProfile']>>,
    profile: LeadProfile,
    recentMessages: LLMConversationMessage[],
    summary: ConversationSummary | undefined,
    context: ToolContext,
  ): Promise<string> {
    try {
      const result = await this.llm.generateReply({
        extraction: extraction.data,
        currentProfile: profile,
        recentMessages,
        ...(summary ? { conversationSummary: summary } : {}),
        groundedProperties: [],
        propertySearchPerformed: false,
      });
      this.logUsage(result, context, 'reply');
      return result.data.message;
    } catch (error) {
      this.logger.error({ ...context, err: error }, 'llm_reply_failed_using_safe_message');
      return 'Posso ajudar você a comprar, alugar ou saber mais sobre um imóvel. O que você procura?';
    }
  }

  private async updateSummary(input: {
    context: ToolContext;
    lead: LeadRecord;
    intent: LeadIntent;
    profile: LeadProfile;
    presentedIds: string[];
    stage: ConversationStage;
    nextStep?: string;
  }): Promise<void> {
    const conversation = await this.conversations.getById(input.context.tenantId, input.context.conversationId);
    const count = (conversation.summary?.messageCount ?? 0) + 1;
    let questions = conversation.summary?.questions ?? [];
    let objections = conversation.summary?.objections ?? [];
    let nextStep = input.nextStep;

    if (count % 6 === 0) {
      try {
        const result = await this.llm.summarizeConversation({
          intent: input.intent,
          profile: input.profile,
          recentMessages: toLlmMessages(conversation.messages),
          ...(toLlmSummary(conversation.summary, input.profile, input.intent)
            ? { previousSummary: toLlmSummary(conversation.summary, input.profile, input.intent)! }
            : {}),
          shownPropertyIds: input.presentedIds,
          stage: input.stage,
        });
        questions = result.data.questions;
        objections = result.data.objections;
        nextStep = result.data.nextStep ?? nextStep;
        this.logUsage(result, input.context, 'summary');
      } catch (error) {
        this.logger.warn({ ...input.context, err: error }, 'llm_summary_failed');
      }
    }

    const leadName = input.lead.name ?? input.profile.name;
    await this.conversations.upsertSummary({
      tenantId: input.context.tenantId,
      conversationId: input.context.conversationId,
      ...(leadName ? { leadName } : {}),
      intent: input.intent,
      preferences: input.profile,
      presentedPropertyIds: input.presentedIds,
      questions,
      objections,
      stage: input.stage,
      ...(nextStep ? { nextStep } : {}),
      messageCount: count,
    });
  }

  private async emitLeadMilestones(previous: LeadRecord, updated: LeadRecord, profile: LeadProfile, context: ToolContext): Promise<void> {
    if (!isQualified(previous.profile) && isQualified(profile)) {
      await this.outbox.add({
        tenantId: context.tenantId,
        type: 'lead.qualified',
        aggregateType: 'Lead',
        aggregateId: context.leadId,
        payload: { conversationId: context.conversationId, score: updated.score, temperature: updated.temperature },
      });
    }
    const hot = updated.temperature === 'HOT' || updated.temperature === 'VERY_HOT';
    const wasHot = previous.temperature === 'HOT' || previous.temperature === 'VERY_HOT';
    if (hot && !wasHot) {
      await this.outbox.add({
        tenantId: context.tenantId,
        type: 'lead.hot',
        aggregateType: 'Lead',
        aggregateId: context.leadId,
        payload: { conversationId: context.conversationId, score: updated.score, temperature: updated.temperature },
      });
    }
  }

  private logUsage(result: LLMResult<unknown>, context: ToolContext, operation: string): void {
    const estimatedCostUsd =
      (result.usage.inputTokens * this.costs.inputUsdPerMillion + result.usage.outputTokens * this.costs.outputUsdPerMillion) / 1_000_000;
    this.logger.info(
      { ...context, operation, provider: result.provider, model: result.model, usage: result.usage, estimatedCostUsd },
      'llm_usage',
    );
  }
}

function toLlmMessages(messages: Message[]): LLMConversationMessage[] {
  return messages.slice(-12).map((message) => ({ role: message.direction === 'INBOUND' ? 'user' : 'assistant', content: message.content }));
}

function toLlmSummary(
  summary: { leadName: string | null; intent: LeadIntent; preferences: unknown; presentedPropertyIds: string[]; questions: string[]; objections: string[]; stage: string; nextStep: string | null } | null,
  fallbackProfile: LeadProfile,
  fallbackIntent: LeadIntent,
): ConversationSummary | undefined {
  if (!summary) return undefined;
  const validStages: ConversationStage[] = ['NEW', 'QUALIFYING', 'MATCHING', 'PRESENTING_PROPERTIES', 'APPOINTMENT', 'HUMAN_HANDOFF', 'CLOSED'];
  const stage = validStages.includes(summary.stage as ConversationStage) ? (summary.stage as ConversationStage) : 'QUALIFYING';
  const preferences = LeadProfileSchema.safeParse(summary.preferences);
  return {
    leadName: summary.leadName,
    intent: summary.intent ?? fallbackIntent,
    preferences: preferences.success ? preferences.data : fallbackProfile,
    shownPropertyIds: summary.presentedPropertyIds,
    questions: summary.questions,
    objections: summary.objections,
    stage,
    nextStep: summary.nextStep,
  };
}

function chooseIntent(extracted: LeadIntent, current: LeadIntent): LeadIntent {
  return extracted === 'UNKNOWN' && current !== 'UNKNOWN' ? current : extracted;
}

function isPropertyJourney(intent: LeadIntent, profile: LeadProfile): boolean {
  return ['BUY_PROPERTY', 'RENT_PROPERTY', 'SELL_PROPERTY', 'PROPERTY_INFO'].includes(intent) || profile.transactionType !== undefined;
}

function isQualified(profile: LeadProfile): boolean {
  return Boolean(
    profile.transactionType &&
      (profile.city || profile.neighborhoods?.length) &&
      profile.maxPrice !== undefined &&
      profile.propertyType &&
      (profile.propertyType === 'LAND' || profile.minBedrooms !== undefined),
  );
}

function shouldSearch(profile: LeadProfile): boolean {
  return Boolean(profile.transactionType && (profile.city || profile.neighborhoods?.length) && profile.maxPrice !== undefined);
}

function shouldRunNewSearch(extracted: LeadProfile, summary: ConversationSummary | undefined): boolean {
  const searchFields: Array<keyof LeadProfile> = [
    'transactionType',
    'propertyType',
    'city',
    'state',
    'neighborhoods',
    'minPrice',
    'maxPrice',
    'minBedrooms',
    'minBathrooms',
    'minParkingSpaces',
    'minAreaM2',
    'features',
  ];
  return !summary?.shownPropertyIds.length || searchFields.some((field) => extracted[field] !== undefined);
}

function fallbackForUnsupportedType(type: MessageType): string {
  if (type === 'AUDIO') return 'Ainda não consigo ouvir áudios. Pode enviar sua mensagem em texto, por favor?';
  if (type === 'IMAGE') return 'Recebi a imagem, mas ainda não consigo analisá-la. Pode me contar em texto o que você procura?';
  return 'Recebi sua mensagem, mas neste momento consigo atender melhor por texto. Pode escrever o que você procura?';
}
