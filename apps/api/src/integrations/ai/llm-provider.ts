import type { LeadIntent, LeadProfile } from '../../domain/leads/lead-profile.js';
import type { PropertyRecord } from '../../domain/properties/property.js';

export const conversationStages = [
  'NEW',
  'QUALIFYING',
  'MATCHING',
  'PRESENTING_PROPERTIES',
  'APPOINTMENT',
  'HUMAN_HANDOFF',
  'CLOSED',
] as const;

export type ConversationStage = (typeof conversationStages)[number];

export interface LLMConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationSummary {
  leadName: string | null;
  intent: LeadIntent;
  preferences: LeadProfile;
  shownPropertyIds: string[];
  questions: string[];
  objections: string[];
  stage: ConversationStage;
  nextStep: string | null;
}

export interface LeadProfileExtraction {
  intent: LeadIntent;
  extractedFields: LeadProfile;
  missingFields: Array<keyof LeadProfile>;
  confidence: number;
  requestsHumanHandoff: boolean;
}

export interface ExtractLeadProfileInput {
  message: string;
  currentProfile?: LeadProfile;
  recentMessages?: readonly LLMConversationMessage[];
  conversationSummary?: ConversationSummary;
}

export interface GenerateReplyInput {
  extraction: LeadProfileExtraction;
  currentProfile?: LeadProfile;
  recentMessages?: readonly LLMConversationMessage[];
  conversationSummary?: ConversationSummary;
  groundedProperties?: readonly PropertyRecord[];
  propertySearchPerformed?: boolean;
  businessName?: string;
}

export interface GeneratedReply {
  message: string;
  referencedPropertyIds: string[];
  nextQuestion: string | null;
}

export interface SummarizeConversationInput {
  intent: LeadIntent;
  profile: LeadProfile;
  recentMessages: readonly LLMConversationMessage[];
  previousSummary?: ConversationSummary;
  shownPropertyIds?: readonly string[];
  stage?: ConversationStage;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResult<T> {
  data: T;
  provider: string;
  model: string;
  responseId: string | null;
  attempts: number;
  usage: LLMUsage;
}

/**
 * Provider de linguagem limitado às três operações necessárias ao MVP.
 * A interface não oferece acesso a banco, rede arbitrária, ferramentas ou credenciais.
 */
export interface LLMProvider {
  readonly providerName: string;

  extractLeadProfile(input: ExtractLeadProfileInput): Promise<LLMResult<LeadProfileExtraction>>;

  generateReply(input: GenerateReplyInput): Promise<LLMResult<GeneratedReply>>;

  summarizeConversation(input: SummarizeConversationInput): Promise<LLMResult<ConversationSummary>>;
}
