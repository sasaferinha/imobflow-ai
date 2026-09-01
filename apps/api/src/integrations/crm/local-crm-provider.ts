import { LeadRepository } from '../../modules/leads/lead-repository.js';
import type { CRMLead, CRMLeadPatchInput, CRMProvider } from './crm-provider.js';

/**
 * Local CRM adapter. Application code can depend on CRMProvider while this MVP
 * keeps the source of truth in the local LeadRepository.
 */
export class LocalCRMProvider implements CRMProvider {
  readonly providerName = 'local';

  constructor(private readonly leads: LeadRepository) {}

  getOrCreateLead(tenantId: string, phone: string): Promise<{ lead: CRMLead; created: boolean }> {
    return this.leads.getOrCreate(tenantId, phone);
  }

  getLead(tenantId: string, leadId: string): Promise<CRMLead> {
    return this.leads.getById(tenantId, leadId);
  }

  listLeads(tenantId: string, take?: number): Promise<CRMLead[]> {
    return take === undefined ? this.leads.list(tenantId) : this.leads.list(tenantId, take);
  }

  updateLead(tenantId: string, leadId: string, input: CRMLeadPatchInput): Promise<CRMLead> {
    return this.leads.patch(tenantId, leadId, input);
  }
}
