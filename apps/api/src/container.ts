import type { FastifyBaseLogger } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { AppEnv } from './config/env.js';
import { createPrismaClient } from './infrastructure/database/prisma.js';
import { OutboxRepository } from './infrastructure/events/outbox-repository.js';
import { OutboxWorker } from './infrastructure/events/outbox-worker.js';
import { MockLLMProvider, OpenAILLMProvider, type LLMProvider } from './integrations/ai/index.js';
import {
  MetaWhatsAppProvider,
  MockWhatsAppProvider,
  WhatsAppOutboundMessageAdapter,
  type WhatsAppProvider,
} from './integrations/whatsapp/index.js';
import { AppointmentRepository } from './modules/appointments/appointment-repository.js';
import { ConversationRepository } from './modules/conversations/conversation-repository.js';
import { FollowUpService } from './modules/followups/follow-up-service.js';
import { LeadRepository } from './modules/leads/lead-repository.js';
import { PropertyInterestRepository } from './modules/properties/property-interest-repository.js';
import { PropertyRepository } from './modules/properties/property-repository.js';
import { HandoffService } from './application/handoff/handoff-service.js';
import { MessageIngestionService } from './application/ingestion/message-ingestion-service.js';
import { ConversationOrchestrator } from './application/orchestrator/conversation-orchestrator.js';
import { ToolRegistry } from './application/tools/tool-registry.js';
import { AppointmentService } from './application/appointments/appointment-service.js';
import { MockCalendarProvider, type CalendarProvider } from './integrations/calendar/index.js';
import { LocalCRMProvider, type CRMProvider } from './integrations/crm/index.js';

export interface AppContainer {
  env: AppEnv;
  prisma: PrismaClient;
  llm: LLMProvider;
  fallbackLlm: LLMProvider;
  whatsapp: WhatsAppProvider;
  calendar: CalendarProvider;
  crm: CRMProvider;
  properties: PropertyRepository;
  interests: PropertyInterestRepository;
  leads: LeadRepository;
  conversations: ConversationRepository;
  appointments: AppointmentRepository;
  appointmentService: AppointmentService;
  followUps: FollowUpService;
  outbox: OutboxRepository;
  outboxWorker: OutboxWorker;
  tools: ToolRegistry;
  orchestrator: ConversationOrchestrator;
  ingestion: MessageIngestionService;
  handoff: HandoffService;
}

export function createContainer(env: AppEnv, logger: FastifyBaseLogger, prisma = createPrismaClient()): AppContainer {
  const fallbackLlm = new MockLLMProvider();
  const llm: LLMProvider = env.LLM_PROVIDER === 'openai'
    ? new OpenAILLMProvider({
        apiKey: env.OPENAI_API_KEY!,
        model: env.OPENAI_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
        maxRetries: env.LLM_MAX_RETRIES,
      })
    : fallbackLlm;
  const whatsapp: WhatsAppProvider = env.WHATSAPP_PROVIDER === 'meta'
    ? new MetaWhatsAppProvider({
        accessToken: env.WHATSAPP_ACCESS_TOKEN!,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
        appSecret: env.WHATSAPP_APP_SECRET!,
        apiVersion: env.WHATSAPP_API_VERSION,
      })
    : new MockWhatsAppProvider(env.WHATSAPP_APP_SECRET ? { appSecret: env.WHATSAPP_APP_SECRET } : {});
  const calendar = new MockCalendarProvider();

  const properties = new PropertyRepository(prisma);
  const interests = new PropertyInterestRepository(prisma);
  const leads = new LeadRepository(prisma);
  const conversations = new ConversationRepository(prisma);
  const appointments = new AppointmentRepository(prisma);
  const outbox = new OutboxRepository(prisma);
  const followUps = new FollowUpService(prisma, outbox);
  const tools = new ToolRegistry(properties, interests, leads, conversations, appointments, outbox, logger);
  const orchestrator = new ConversationOrchestrator(
    llm,
    fallbackLlm,
    leads,
    conversations,
    tools,
    outbox,
    logger,
    { inputUsdPerMillion: env.LLM_INPUT_USD_PER_MILLION, outputUsdPerMillion: env.LLM_OUTPUT_USD_PER_MILLION },
  );
  const outboundMessages = new WhatsAppOutboundMessageAdapter(whatsapp);
  const ingestion = new MessageIngestionService(leads, conversations, orchestrator, outboundMessages, outbox, followUps, logger);
  const handoff = new HandoffService(conversations, leads, outbox, logger);
  const appointmentService = new AppointmentService(appointments, calendar, outbox);
  const crm = new LocalCRMProvider(leads);
  const outboxWorker = new OutboxWorker(prisma, env, logger);

  return {
    env,
    prisma,
    llm,
    fallbackLlm,
    whatsapp,
    calendar,
    crm,
    properties,
    interests,
    leads,
    conversations,
    appointments,
    appointmentService,
    followUps,
    outbox,
    outboxWorker,
    tools,
    orchestrator,
    ingestion,
    handoff,
  };
}
