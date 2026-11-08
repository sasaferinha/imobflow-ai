export type SocialChannel = 'instagram' | 'facebook';
export type SocialMode = 'human' | 'suggestions' | 'automatic';
export type SocialMessageStatus = 'received' | 'pending' | 'sending' | 'sent' | 'failed' | 'unknown';
export type SocialMessage = { id: string; text: string; at: string; direction: 'incoming' | 'outgoing'; status: SocialMessageStatus; error: string | null; mediaUrls: string[]; mediaType: string | null; source: string };
export type SocialLeadProfile = { goal: string | null; region: string | null; propertyType: string | null; budgetMin: number | null; budgetMax: number | null; interestProfile: Record<string, unknown> };
export type SocialContact = { id: string; leadId: string; channel: SocialChannel; name: string; assignedTo: string | null; assignedBrokerId: string | null; lastMessageAt: string | null; lastInboundAt: string | null; mode: SocialMode; messages: SocialMessage[]; nextCursor: string | null; windowEndsAt: string | null; canSend: boolean; leadProfile: SocialLeadProfile; connectionReady?: boolean; claimBlockedReason?: string | null; dutyPriorityUntil?: string | null; dutyPreferred?: boolean; waitingSince?: string | null; urgent?: boolean };
export function socialClaimBlockedMessage(reason?: string | null) {
  if (reason === 'broker_compliance_pending') return 'Conclua os registros ou atividades pendentes para receber novos atendimentos.';
  if (reason === 'duty_priority_wait') return 'Este atendimento está reservado ao plantonista online por alguns minutos.';
  if (reason) return 'Este atendimento pertence a outro responsável. Atualize a lista.';
  return null;
}
export class SocialError extends Error { constructor(message: string, public status = 422, public code = 'invalid') { super(message); } }
export const socialObject = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const socialId = (v: unknown): string => typeof v === 'string' && /^\d{1,40}$/.test(v) ? v : '';
export const socialUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function socialImageUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 4096 || /[\s\\\u0000-\u001f]/u.test(v)) return null;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.includes('.') && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname) ? u.href : null; } catch { return null; }
}
export function publicSocialMessage(value: unknown): SocialMessage {
  const r = socialObject(value);
  return { id: String(r.id), text: typeof r.content === 'string' ? r.content : '', at: String(r.occurred_at || r.created_at), direction: r.direction === 'outgoing' ? 'outgoing' : 'incoming', status: r.status as SocialMessageStatus, error: typeof r.error_message === 'string' ? r.error_message : null, mediaUrls: Array.isArray(r.media_urls) ? r.media_urls.map(socialImageUrl).filter((u): u is string => Boolean(u)) : [], mediaType: typeof r.media_type === 'string' ? r.media_type : null, source: typeof r.source === 'string' ? r.source : 'client' };
}
/** Only qualified property preferences, never raw provider identifiers or transcript data. */
export function publicSocialProfile(value: unknown): Record<string, unknown> {
  const profile = socialObject(value), result: Record<string, unknown> = {};
  for (const key of ['city','district','regions','bedrooms','parkingSpaces','areaMin','areaMax','budgetMin','budgetMax','purpose','propertyType','features','timeline','financing','financingIntent','intendedUse','preferencesRecorded','preferenceNotes','summaryConfirmed','correctionRequested','correctionField','intent','summary']) {
    const v = profile[key]; if (typeof v === 'string' && v.length <= 2000 || typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean') result[key] = v;
    else if (Array.isArray(v) && v.length <= 30 && v.every(x => typeof x === 'string' && x.length < 200)) result[key] = v;
  }
  return result;
}
