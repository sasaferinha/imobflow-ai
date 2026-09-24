import {
  configuredMetaWhatsAppConnections,
  normalizePhone,
  type MetaWhatsAppConnection,
} from "./meta-whatsapp";
import { supabaseServiceRequest as db } from "./supabase";

type DatabaseWhatsAppRow = {
  company_id: string;
  whatsapp_phone_number_id: string | null;
  whatsapp_access_token: string | null;
  whatsapp_api_version: string | null;
  whatsapp_enabled: boolean | null;
};

const VALID_API_VERSION = /^v\d+\.\d+$/;

function normalizeApiVersion(value: string | null): string {
  return value && VALID_API_VERSION.test(value) ? value : "v26.0";
}

function normalizeDbToken(value: string | null) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token ? token : null;
}

function normalizeDbConnection(
  row: DatabaseWhatsAppRow,
): MetaWhatsAppConnection | null {
  const phoneNumberId = normalizePhone(row.whatsapp_phone_number_id || "");
  if (!phoneNumberId) return null;
  return {
    companyId: row.company_id,
    phoneNumberId,
    enabled: row.whatsapp_enabled !== false,
    accessToken: normalizeDbToken(row.whatsapp_access_token),
    apiVersion: normalizeApiVersion(row.whatsapp_api_version),
  };
}

function mergeByPhoneNumber(rows: MetaWhatsAppConnection[]): Map<string, MetaWhatsAppConnection> {
  const byPhoneNumberId = new Map<string, MetaWhatsAppConnection>();
  for (const connection of rows) {
    const existing = byPhoneNumberId.get(connection.phoneNumberId);
    if (existing && existing.companyId !== connection.companyId) {
      throw new Error("Há mais de uma empresa configurada para o mesmo número WhatsApp.");
    }
    byPhoneNumberId.set(connection.phoneNumberId, connection);
  }
  return byPhoneNumberId;
}

export async function loadMetaWhatsAppConnections(): Promise<MetaWhatsAppConnection[]> {
  const envConnections = configuredMetaWhatsAppConnections();
  // If persisted ownership cannot be checked, do not revive a stale environment
  // mapping. The caller can retry after the configuration store recovers.
  const rows = await db<DatabaseWhatsAppRow[]>(
    "conversation_settings?select=company_id,whatsapp_phone_number_id,whatsapp_access_token,whatsapp_api_version,whatsapp_enabled",
    { timeoutMs: 4000 },
  );
  const saved = rows.map(normalizeDbConnection).filter((row): row is MetaWhatsAppConnection => row !== null);
  // Check all configured ownership first, including superseded environment
  // numbers. A stale environment assignment must not silently transfer tenants.
  mergeByPhoneNumber([...envConnections, ...saved]);
  const persistedCompanies = new Set(saved.map(connection => connection.companyId));
  for (const row of rows) {
    if (row.whatsapp_enabled === false) persistedCompanies.add(row.company_id);
  }
  // A saved connection replaces the company's entire environment mapping.
  // Ordinary settings rows with no WhatsApp configuration do not override it.
  const fallback = envConnections.filter(connection => !persistedCompanies.has(connection.companyId));
  return Array.from(mergeByPhoneNumber([...fallback, ...saved]).values());
}

export async function loadMetaWhatsAppConnectionForCompany(
  companyId: string,
): Promise<MetaWhatsAppConnection[]> {
  if (!companyId) return [];
  return (await loadMetaWhatsAppConnections()).filter(
    (connection) => connection.companyId === companyId,
  );
}

export async function loadMetaWhatsAppConnectionByPhone(
  companyId: string,
  phoneNumberId: string,
): Promise<MetaWhatsAppConnection | null> {
  const normalizedPhoneNumberId = normalizePhone(phoneNumberId);
  if (!companyId || !normalizedPhoneNumberId) return null;
  const row = (await loadMetaWhatsAppConnections()).find(
    (connection) =>
      connection.companyId === companyId &&
      connection.phoneNumberId === normalizedPhoneNumberId,
  );
  return row || null;
}

export async function assertMetaWhatsAppPhoneAvailable(companyId: string, phoneId: string) {
  const phoneNumberId = normalizePhone(phoneId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId) || !phoneNumberId) {
    throw new Error("Conexão WhatsApp inválida.");
  }
  if (configuredMetaWhatsAppConnections().some(connection => connection.phoneNumberId === phoneNumberId && connection.companyId !== companyId)) {
    throw new Error("Este número WhatsApp já está vinculado a outra empresa.");
  }
  const existing = await db<Array<{ company_id: string }>>(
    `conversation_settings?whatsapp_phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&select=company_id&limit=1`,
  );
  if (existing.some(connection => connection.company_id !== companyId)) {
    throw new Error("Este número WhatsApp já está vinculado a outra empresa.");
  }
  return phoneNumberId;
}

export async function saveMetaWhatsAppConnection(
  companyId: string,
  input: {
    phoneNumberId: string;
    accessToken: string;
    apiVersion: string;
    enabled: boolean;
  },
) {
  const phoneNumberId = await assertMetaWhatsAppPhoneAvailable(companyId, input.phoneNumberId);
  // The unique database index is the final arbiter if another company saves
  // this number between the ownership read and the upsert.
  await db("conversation_settings?on_conflict=company_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: {
      company_id: companyId,
      whatsapp_phone_number_id: phoneNumberId,
      whatsapp_access_token: normalizeDbToken(input.accessToken),
      whatsapp_api_version: normalizeApiVersion(input.apiVersion),
      whatsapp_enabled: input.enabled,
    },
  });
}

export async function disconnectMetaWhatsAppConnection(companyId: string, phoneNumberId: string) {
  await db('rpc/disconnect_company_whatsapp', { method: 'POST', body: { p_company_id: companyId, p_phone_id: phoneNumberId } });
}
