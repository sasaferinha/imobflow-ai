import type { LeadProfile } from '../../domain/leads/lead-profile.js';
import type { LeadRecord } from '../../modules/leads/lead-repository.js';

export type CRMLead = LeadRecord;

export interface CRMLeadPatchInput {
  name?: string;
  status?: string;
  profile?: LeadProfile;
}

export interface CRMProvider {
  readonly providerName: string;

  getOrCreateLead(tenantId: string, phone: string): Promise<{ lead: CRMLead; created: boolean }>;

  getLead(tenantId: string, leadId: string): Promise<CRMLead>;

  listLeads(tenantId: string, take?: number): Promise<CRMLead[]>;

  updateLead(tenantId: string, leadId: string, input: CRMLeadPatchInput): Promise<CRMLead>;
}
