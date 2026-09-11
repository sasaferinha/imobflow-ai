export type AILeadProfile = {
  city?: string; neighborhoods?: string[]; transactionType?: 'BUY' | 'RENT';
  propertyType?: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'OTHER';
  maxPrice?: number; minBedrooms?: number; minParkingSpaces?: number; features?: string[];
};
export type LLMConversationMessage = { role: 'user' | 'assistant'; content: string };
export type LeadProfileExtraction = {
  extractedFields: AILeadProfile; confidence: number; requestsHumanHandoff: boolean;
};
export interface LLMProvider {
  extractLeadProfile(input: { message: string; currentProfile?: AILeadProfile; recentMessages?: LLMConversationMessage[] }): Promise<{ data: LeadProfileExtraction }>;
}
