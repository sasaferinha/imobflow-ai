import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { LeadProfileSchema, leadIntents } from '../../domain/leads/lead-profile.js';
import { calculateLeadScore } from '../../domain/leads/lead-scoring.js';
import { PropertySearchFiltersSchema } from '../../domain/properties/property.js';
import { OutboxRepository } from '../../infrastructure/events/outbox-repository.js';
import { AppointmentRepository } from '../../modules/appointments/appointment-repository.js';
import { AppointmentCreateSchema } from '../../modules/appointments/appointment-schemas.js';
import { ConversationRepository } from '../../modules/conversations/conversation-repository.js';
import { LeadRepository } from '../../modules/leads/lead-repository.js';
import { PropertyInterestRepository } from '../../modules/properties/property-interest-repository.js';
import { PropertyRepository } from '../../modules/properties/property-repository.js';

export const toolNames = [
  'searchProperties',
  'getPropertyDetails',
  'updateLeadProfile',
  'requestHumanHandoff',
  'requestAppointment',
  'getConversationContext',
] as const;
export type ToolName = (typeof toolNames)[number];

export interface ToolContext {
  tenantId: string;
  leadId: string;
  conversationId: string;
  correlationId: string;
}

const schemas = {
  searchProperties: PropertySearchFiltersSchema,
  getPropertyDetails: z.object({ propertyId: z.string().min(1) }).strict(),
  updateLeadProfile: z.object({ profile: LeadProfileSchema, intent: z.enum(leadIntents) }).strict(),
  requestHumanHandoff: z.object({ brokerSummary: z.string().min(1).max(10_000) }).strict(),
  requestAppointment: AppointmentCreateSchema.omit({ leadId: true }),
  getConversationContext: z.object({}).strict(),
} as const;

export class ToolRegistry {
  constructor(
    private readonly properties: PropertyRepository,
    private readonly interests: PropertyInterestRepository,
    private readonly leads: LeadRepository,
    private readonly conversations: ConversationRepository,
    private readonly appointments: AppointmentRepository,
    private readonly outbox: OutboxRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async execute(name: ToolName, untrustedArguments: unknown, context: ToolContext): Promise<unknown> {
    const startedAt = performance.now();
    this.logger.info({ tool: name, ...context }, 'tool_call_started');
    try {
      const result = await this.dispatch(name, untrustedArguments, context);
      this.logger.info({ tool: name, durationMs: Math.round(performance.now() - startedAt), ...context }, 'tool_call_completed');
      return result;
    } catch (error) {
      this.logger.error({ tool: name, durationMs: Math.round(performance.now() - startedAt), err: error, ...context }, 'tool_call_failed');
      throw error;
    }
  }

  private async dispatch(name: ToolName, input: unknown, context: ToolContext): Promise<unknown> {
    switch (name) {
      case 'searchProperties': {
        const filters = schemas.searchProperties.parse(input);
        const matches = await this.properties.search(context.tenantId, filters);
        await this.interests.recordMany(context.tenantId, context.leadId, matches.map((match) => match.property.id));
        await this.outbox.add({
          tenantId: context.tenantId,
          type: 'property.matched',
          aggregateType: 'Lead',
          aggregateId: context.leadId,
          payload: { conversationId: context.conversationId, propertyIds: matches.map((match) => match.property.id), filters },
        });
        return matches;
      }
      case 'getPropertyDetails': {
        const { propertyId } = schemas.getPropertyDetails.parse(input);
        return this.properties.getByReference(context.tenantId, propertyId);
      }
      case 'updateLeadProfile': {
        const args = schemas.updateLeadProfile.parse(input);
        const score = calculateLeadScore(args.profile);
        const lead = await this.leads.updateProfile(context.tenantId, context.leadId, args.profile, args.intent, score);
        await this.outbox.add({
          tenantId: context.tenantId,
          type: 'lead.updated',
          aggregateType: 'Lead',
          aggregateId: context.leadId,
          payload: { conversationId: context.conversationId, score: score.score, temperature: score.temperature, intent: args.intent },
        });
        return lead;
      }
      case 'requestHumanHandoff': {
        const { brokerSummary } = schemas.requestHumanHandoff.parse(input);
        const conversation = await this.conversations.setStatus(context.tenantId, context.conversationId, 'HUMAN_HANDOFF');
        await this.outbox.add({
          tenantId: context.tenantId,
          type: 'conversation.handoff_requested',
          aggregateType: 'Conversation',
          aggregateId: context.conversationId,
          payload: { leadId: context.leadId, brokerSummary },
        });
        return conversation;
      }
      case 'requestAppointment': {
        const args = schemas.requestAppointment.parse(input);
        const appointment = await this.appointments.create(context.tenantId, { ...args, leadId: context.leadId });
        await this.outbox.add({
          tenantId: context.tenantId,
          type: 'appointment.created',
          aggregateType: 'Appointment',
          aggregateId: appointment.id,
          payload: { leadId: context.leadId, conversationId: context.conversationId, scheduledAt: appointment.scheduledAt.toISOString() },
        });
        return appointment;
      }
      case 'getConversationContext':
        schemas.getConversationContext.parse(input);
        return this.conversations.getById(context.tenantId, context.conversationId);
    }
  }
}
