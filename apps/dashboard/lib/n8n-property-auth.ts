import { createHash, timingSafeEqual } from 'node:crypto';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PropertyAutomationConnection = {
  companyId: string;
  tokenSha256: string;
  enabled: boolean;
  provider: 'meta';
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
};

// Operator-managed server secret. A credential belongs to exactly one company;
// callers cannot choose a tenant, destination phone, message or provider URL.
// No configuration means NO automatic sending, including in demonstrations.
export function propertyAutomationConnection(
  authorization: string | null,
  rawConfig = process.env.N8N_PROPERTY_AUTOMATION_CONNECTIONS,
): PropertyAutomationConnection | null {
  if (!rawConfig || !authorization || !/^Bearer [A-Za-z0-9_-]{43,128}$/.test(authorization)) return null;
  let entries: unknown;
  try { entries = JSON.parse(rawConfig); } catch { return null; }
  if (!Array.isArray(entries) || entries.length > 1000) return null;
  const digest = createHash('sha256').update(authorization.slice(7)).digest();
  const matched = entries.filter((entry) => {
    if (!entry || typeof entry !== 'object' || !/^[a-f0-9]{64}$/.test(entry.tokenSha256 || '')) return false;
    return timingSafeEqual(digest, Buffer.from(entry.tokenSha256, 'hex'));
  });
  if (matched.length !== 1) return null;
  const entry = matched[0];
  if (typeof entry.companyId !== 'string' || !UUID.test(entry.companyId)) return null;
  if (entry.enabled !== true || entry.provider !== 'meta' ||
      typeof entry.phoneNumberId !== 'string' || !/^\d{5,30}$/.test(entry.phoneNumberId) ||
      typeof entry.accessToken !== 'string' || entry.accessToken.length < 20 ||
      typeof entry.apiVersion !== 'string' || !/^v\d{1,3}\.\d{1,2}$/.test(entry.apiVersion)) return null;
  return entry as PropertyAutomationConnection;
}

export type PropertyPreferencesEvent = {
  type: 'lead.preferences.updated';
  leadId: string;
  incomingMessageId: string;
  profileUpdatedAt: string;
};

export function parsePropertyPreferencesEvent(value: unknown): PropertyPreferencesEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['type', 'leadId', 'incomingMessageId', 'profileUpdatedAt'].includes(key))) return null;
  if (data.type !== 'lead.preferences.updated' ||
      typeof data.leadId !== 'string' || !UUID.test(data.leadId) ||
      typeof data.incomingMessageId !== 'string' || !UUID.test(data.incomingMessageId) ||
      typeof data.profileUpdatedAt !== 'string' || data.profileUpdatedAt.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(data.profileUpdatedAt) ||
      !Number.isFinite(Date.parse(data.profileUpdatedAt))) return null;
  return data as PropertyPreferencesEvent;
}
