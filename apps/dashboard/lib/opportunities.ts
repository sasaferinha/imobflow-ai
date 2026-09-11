import { currentAccount } from './tenant-context';
import { supabaseServiceRequest } from './supabase';
import { whatsappNumber } from './property-matching';

export type Opportunity = {
  id: string; leadId: string; propertyId: string; leadName: string; propertyTitle: string;
  city: string; district: string; price: number; bedrooms: number; parkingSpaces: number;
  score: number; status: 'open' | 'contacted'; reasons: string[]; assignedTo: string | null;
  inactivityDays: number; notificationId: string | null; unread: boolean;
};
export function inactiveLeadDays() {
  const value = Number(process.env.INACTIVE_LEAD_DAYS || 7);
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 7;
}
function actor() {
  const account = currentAccount();
  if (!account) throw new Error('unauthorized');
  return { p_company_id: account.companyId, p_broker_id: account.brokerId };
}
export function listOpportunities(offset = 0) {
  return supabaseServiceRequest<Opportunity[]>('rpc/list_opportunities', { method: 'POST', body: { ...actor(), p_offset: offset } });
}
export type OpportunityDraft = { phone: string; name: string; title: string; district: string; city: string; price: number; bedrooms: number; purpose: string };
export function manualWhatsAppDraft(draft: OpportunityDraft) {
  const phone = whatsappNumber(draft.phone);
  if (!phone) throw new Error('Telefone do lead inválido. Corrija o cadastro antes de abrir o WhatsApp.');
  const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(draft.price);
  const message = `Olá, ${draft.name.trim().split(/\s+/)[0]}! Encontrei um imóvel que combina com o que você estava procurando: ${draft.title}, em ${draft.district}, ${draft.city}, com ${draft.bedrooms} quartos, por ${price}${draft.purpose === 'Aluguel' ? ' por mês' : ''}. Quer que eu te envie mais detalhes?`;
  return { message, url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` };
}
export async function opportunityAction(id: string, action: string) {
  const data = await supabaseServiceRequest<OpportunityDraft>('rpc/opportunity_action', {
    method: 'POST', body: { ...actor(), p_id: id, p_action: action },
  });
  return action === 'draft' ? manualWhatsAppDraft(data) : { ok: true };
}
export async function generatePropertyOpportunities(companyId: string, propertyId: string) {
  return supabaseServiceRequest<number>('rpc/generate_property_opportunities', { method: 'POST',
    body: { p_company_id: companyId, p_property_id: propertyId, p_inactive_days: inactiveLeadDays() } });
}
export async function onPropertyChanged(companyId: string, propertyId: string) {
  try { await generatePropertyOpportunities(companyId, propertyId); }
  catch { console.error('property_opportunities_failed'); }
}
export async function sweepOpportunities(companyId: string) {
  return supabaseServiceRequest<{ complete: boolean; generated: number; processed?: number; busy?: boolean }>('rpc/sweep_opportunities', { method: 'POST',
    body: { p_company_id: companyId, p_inactive_days: inactiveLeadDays(), p_batch: 100 } });
}
