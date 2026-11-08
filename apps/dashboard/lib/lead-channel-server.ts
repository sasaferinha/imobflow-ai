import { currentAccount } from './tenant-context';
import { supabaseServiceRequest as db } from './supabase';
import { leadChannel } from './lead-channel';
import { resolveSocialThreadForLead } from './social-messaging';
import { SocialError, socialUuid } from './social-model';

/** Call only after authorizing the target operation; never accept a channel supplied by the browser. */
export async function leadMessageDestination(leadId: string) {
  const actor = currentAccount();
  if (!actor || !socialUuid(leadId)) throw new SocialError('Cliente indisponível.', 403);
  const [lead] = await db<Array<{ source: string; interest_profile: Record<string, unknown> }>>(`leads?company_id=eq.${actor.companyId}&id=eq.${leadId}&select=source,interest_profile&limit=1`);
  if (!lead) throw new SocialError('Cliente indisponível.', 404);
  const source = leadChannel(lead.source), stored = lead.interest_profile?.socialChannel;
  if (stored && stored !== source) throw new SocialError('O canal do cadastro precisa ser conferido antes do envio.', 409);
  const thread = await resolveSocialThreadForLead(leadId);
  if (thread && thread.channel !== source) throw new SocialError('O canal do atendimento não corresponde à origem do cliente. Confira o cadastro.', 409);
  if (source !== 'whatsapp' && !thread) throw new SocialError('Conecte a conta e receba uma mensagem deste cliente no canal de origem antes de enviar.', 409);
  return { channel: source, threadId: thread?.threadId || null };
}

export async function opportunityMessageDestination(opportunityId: string) {
  const actor = currentAccount();
  if (!actor || !socialUuid(opportunityId)) throw new SocialError('Oportunidade indisponível.', 403);
  // The table intentionally has no service-role SELECT grant. A narrow RPC
  // authorizes the draft and returns only its current lead/property binding.
  const row = await db<{ lead_id: string; property_id: string }>('rpc/opportunity_delivery_context', { method: 'POST', body: { p_company_id: actor.companyId, p_broker_id: actor.brokerId, p_opportunity_id: opportunityId } });
  if (!row || !socialUuid(row.lead_id) || !socialUuid(row.property_id)) throw new SocialError('Oportunidade indisponível.', 404);
  return { ...await leadMessageDestination(row.lead_id), leadId: row.lead_id, propertyId: row.property_id };
}
