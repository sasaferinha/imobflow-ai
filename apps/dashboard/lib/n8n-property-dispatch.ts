import type { LeadProfile } from './leads';
import type { PropertyRecord } from './operations';
import { immediatePropertyMatch } from './immediate-property-match';
import type { PropertyAutomationConnection, PropertyPreferencesEvent } from './n8n-property-auth';
import { supabaseRequest } from './supabase';

type Row = Record<string, unknown>;
type DatabaseRequest = typeof supabaseRequest;
type Dependencies = { request: DatabaseRequest; fetch: typeof fetch };

export type PropertyDispatchResult = {
  status: 'accepted' | 'skipped' | 'uncertain';
  reason?: string;
  deliveryId?: string;
};

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function leadForMatching(row: Row): LeadProfile | null {
  // These structured constraints are not safely represented in LeadProfile.
  // Do not silently ignore them and promise a match.
  if (row.parking_spaces != null || (typeof row.payment_method === 'string' && row.payment_method.trim())) return null;
  const minimum = row.budget_min == null ? 0 : Number(row.budget_min);
  const maximum = row.budget_max == null ? NaN : Number(row.budget_max);
  if (!Number.isFinite(minimum) || minimum < 0 || !Number.isFinite(maximum) || maximum <= 0 || minimum > maximum) return null;
  const details = typeof row.details === 'string' ? row.details.trim() : '';
  const structuredRooms = row.bedrooms == null ? null : Number(row.bedrooms);
  if (structuredRooms != null && (!Number.isInteger(structuredRooms) || structuredRooms < 0)) return null;
  return {
    id: String(row.id), name: String(row.name || ''), phone: String(row.phone || ''), email: null,
    goal: String(row.goal || ''), propertyType: String(row.property_type || ''), region: String(row.region || ''),
    budget: minimum > 0 ? `${money(minimum)} a ${money(maximum)}` : `Até ${money(maximum)}`,
    // Conflicting free-text and structured requirements are checked separately below.
    details: details || (structuredRooms == null ? null : `${structuredRooms} quartos`),
    assignedTo: typeof row.assigned_to === 'string' ? row.assigned_to : null,
    lifecycleStatus: row.lifecycle_status as LeadProfile['lifecycleStatus'],
    summary: '', score: 0, temperature: '', source: String(row.source || ''), lastContactAt: null,
    inactivityDays: null, recoveryPotential: 'Baixo', scoreReasons: [], recoverySelected: false,
    createdAt: String(row.created_at || ''),
  };
}

function propertyForMatching(row: Row): PropertyRecord | null {
  // Unlike the display mapper, unknown status/purpose must never default to available.
  if (row.status !== 'Disponível' || !['Venda', 'Aluguel'].includes(String(row.purpose)) ||
      !Number.isFinite(Number(row.price)) || Number(row.price) <= 0) return null;
  return {
    id: String(row.id), title: String(row.title || ''), district: String(row.district || ''),
    city: String(row.city || ''), purpose: row.purpose as 'Venda' | 'Aluguel', status: 'Disponível',
    price: money(Number(row.price)), propertyType: String(row.property_type || ''),
    bedrooms: row.bedrooms == null ? undefined : Number(row.bedrooms),
    meta: row.bedrooms == null ? '' : `${row.bedrooms} quartos`,
    publicUrl: typeof row.public_url === 'string' ? row.public_url : undefined,
    tone: '', images: [], createdAt: String(row.created_at || ''),
  };
}

/** Only called from the authenticated machine endpoint. Never from a UI send action.
 * The future inbound connector must validate the provider signature/phone-number
 * mapping, persist the original incoming timestamp and confirmed preferences,
 * then emit this event. The n8n workflow itself does not extract free text.
 */
export async function dispatchImmediateProperty(
  connection: PropertyAutomationConnection,
  event: PropertyPreferencesEvent,
  deps: Dependencies = { request: supabaseRequest, fetch },
): Promise<PropertyDispatchResult> {
  const { companyId } = connection;
  const company = encodeURIComponent(companyId);
  const [row] = await deps.request<Row[]>(`leads?company_id=eq.${company}&id=eq.${event.leadId}&select=*&limit=1`);
  if (!row || row.company_id !== companyId || String(row.id) !== event.leadId) return { status: 'skipped', reason: 'lead_not_found' };
  if (typeof row.assigned_to === 'string' && row.assigned_to.trim()) return { status: 'skipped', reason: 'human_assigned' };
  if (!['Novo', 'Em atendimento'].includes(String(row.lifecycle_status))) return { status: 'skipped', reason: 'lead_not_eligible' };
  // Preserve database microseconds; JS Date equality could accept an older event
  // within the same millisecond. Producers echo the exact PostgREST value.
  if (String(row.updated_at) !== event.profileUpdatedAt) return { status: 'skipped', reason: 'stale_preferences' };
  const lead = leadForMatching(row);
  if (!lead) return { status: 'skipped', reason: 'preferences_need_review' };
  const rows = await deps.request<Row[]>(`properties?company_id=eq.${company}&status=eq.Dispon%C3%ADvel&select=*&order=id.asc`, { allRows: true });
  const properties = rows.filter((property) => property.company_id === companyId).flatMap((property) => {
    const mapped = propertyForMatching(property);
    // A known structured bedroom requirement may not be contradicted by free text.
    if (row.bedrooms != null && Number(row.bedrooms) !== mapped?.bedrooms) return [];
    return mapped ? [mapped] : [];
  });
  const match = immediatePropertyMatch(lead, properties);
  if (match.status !== 'matched') return { status: 'skipped', reason: match.reason };
  const property = rows.find((candidate) => String(candidate.id) === match.propertyId && candidate.company_id === companyId);
  if (!property || !Number.isFinite(Date.parse(String(property.updated_at)))) return { status: 'skipped', reason: 'property_needs_review' };
  // Reservation locks the live lead/property/inbound rows, compares snapshots,
  // checks the real 24h window + handoff and uniquely claims lead/property AND
  // incoming event. A crash after this point stays blocked for reconciliation.
  const deliveryId = await deps.request<string | null>('rpc/claim_property_auto_delivery', {
    method: 'POST', body: {
      p_company_id: companyId, p_lead_id: event.leadId, p_property_id: match.propertyId,
      p_incoming_message_id: event.incomingMessageId, p_content: match.text,
      p_lead_updated_at: row.updated_at, p_property_updated_at: property.updated_at,
      p_phone_number_id: connection.phoneNumberId, p_recipient_phone: match.phone,
    },
  });
  if (!deliveryId) return { status: 'skipped', reason: 'already_reserved_or_ineligible' };

  try {
    // No automatic retry: a timeout may occur AFTER the provider accepted a send.
    const response = await deps.fetch(`https://graph.facebook.com/${connection.apiVersion}/${connection.phoneNumberId}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: match.phone,
        type: 'text', text: { preview_url: false, body: match.text }, biz_opaque_callback_data: deliveryId }),
    });
    // Do not log the request, provider error payload, token, phone or message.
    if (!response.ok) throw new Error('provider_not_accepted');
    const payload = await response.json() as { messages?: Array<{ id?: unknown }> };
    const providerId = payload.messages?.[0]?.id;
    if (typeof providerId !== 'string' || !providerId.trim() || providerId.length > 500) throw new Error('provider_receipt_missing');
    await deps.request('rpc/finish_property_auto_delivery', { method: 'POST', body: {
      p_company_id: companyId, p_delivery_id: deliveryId, p_provider_message_id: providerId,
    } });
    // Accepted is NOT delivered/read. Only verified provider webhooks can establish those.
    return { status: 'accepted', deliveryId };
  } catch {
    try {
      await deps.request('rpc/mark_property_auto_delivery_uncertain', { method: 'POST', body: { p_company_id: companyId, p_delivery_id: deliveryId } });
    } catch { /* Sending reservation remains permanent even if the database is down. */ }
    console.error('property_auto_delivery_requires_review', { companyId, deliveryId });
    return { status: 'uncertain', reason: 'manual_reconciliation_required', deliveryId };
  }
}
