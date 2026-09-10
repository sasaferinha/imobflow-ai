import { createHmac, timingSafeEqual } from 'node:crypto';

export type MetaWhatsAppConnection = {
  companyId: string;
  phoneNumberId: string;
  enabled: boolean;
  /** Server-only token used exclusively to retrieve media sent to this number. */
  accessToken: string | null;
  apiVersion: string;
};

type RawConnection = Partial<MetaWhatsAppConnection>;

export type IncomingWhatsAppMessage = {
  companyId: string;
  phoneNumberId: string;
  phone: string;
  externalMessageId: string;
  text: string;
  contactName: string | null;
  occurredAt: string | null;
  media: { id: string; mimeType: string; caption: string | null } | null;
  accessToken: string | null;
  apiVersion: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

export function configuredMetaWhatsAppConnections(raw = process.env.WHATSAPP_META_CONNECTIONS): MetaWhatsAppConnection[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('WHATSAPP_META_CONNECTIONS inválido.');
  }
  if (!Array.isArray(parsed)) throw new Error('WHATSAPP_META_CONNECTIONS deve ser uma lista.');
  const ids = new Set<string>();
  const sharedAccessToken = typeof process.env.META_WHATSAPP_ACCESS_TOKEN === 'string' && process.env.META_WHATSAPP_ACCESS_TOKEN.trim()
    ? process.env.META_WHATSAPP_ACCESS_TOKEN.trim() : null;
  const sharedApiVersion = /^v\d+\.\d+$/.test(process.env.META_WHATSAPP_GRAPH_VERSION || '') ? process.env.META_WHATSAPP_GRAPH_VERSION! : 'v26.0';
  return parsed.map((entry) => {
    const item = entry as RawConnection;
    const companyId = typeof item.companyId === 'string' ? item.companyId : '';
    const phoneNumberId = typeof item.phoneNumberId === 'string' ? normalizePhone(item.phoneNumberId) : '';
    if (!UUID.test(companyId) || !phoneNumberId) throw new Error('Conexão WhatsApp inválida.');
    if (ids.has(phoneNumberId)) throw new Error('Há mais de uma empresa para o mesmo número WhatsApp.');
    ids.add(phoneNumberId);
    const accessToken = typeof item.accessToken === 'string' && item.accessToken.trim() ? item.accessToken.trim() : sharedAccessToken;
    const apiVersion = typeof item.apiVersion === 'string' && /^v\d+\.\d+$/.test(item.apiVersion) ? item.apiVersion : sharedApiVersion;
    return { companyId, phoneNumberId, enabled: item.enabled !== false, accessToken, apiVersion };
  });
}

export function verifyMetaWebhookSignature(rawBody: string, signature: string | null, appSecret = process.env.META_APP_SECRET) {
  if (!appSecret || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const received = Buffer.from(signature);
  const comparison = Buffer.from(expected);
  return received.length === comparison.length && timingSafeEqual(received, comparison);
}

export function verifyMetaWebhookToken(token: string | null, expected = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
  if (!token || !expected) return false;
  const received = Buffer.from(token);
  const comparison = Buffer.from(expected);
  return received.length === comparison.length && timingSafeEqual(received, comparison);
}

function readableText(message: Record<string, unknown>) {
  if (message.type === 'text' && message.text && typeof message.text === 'object') {
    const body = (message.text as Record<string, unknown>).body;
    return typeof body === 'string' ? body.trim().slice(0, 4000) : '';
  }
  if (message.type === 'button' && message.button && typeof message.button === 'object') {
    const text = (message.button as Record<string, unknown>).text;
    return typeof text === 'string' ? text.trim().slice(0, 4000) : '';
  }
  return '';
}

function incomingImage(message: Record<string, unknown>) {
  if (message.type !== 'image' || !message.image || typeof message.image !== 'object') return null;
  const image = message.image as Record<string, unknown>;
  const id = typeof image.id === 'string' ? image.id.trim().slice(0, 255) : '';
  const mimeType = typeof image.mime_type === 'string' ? image.mime_type.trim().toLowerCase().slice(0, 100) : '';
  const caption = typeof image.caption === 'string' ? image.caption.trim().slice(0, 4000) || null : null;
  return id ? { id, mimeType, caption } : null;
}

export function parseIncomingWhatsAppMessages(payload: unknown, connections: MetaWhatsAppConnection[]): IncomingWhatsAppMessage[] {
  if (!payload || typeof payload !== 'object' || (payload as Record<string, unknown>).object !== 'whatsapp_business_account') return [];
  const byPhoneNumberId = new Map(connections.filter((connection) => connection.enabled).map((connection) => [connection.phoneNumberId, connection]));
  const entries = Array.isArray((payload as Record<string, unknown>).entry) ? (payload as Record<string, unknown>).entry as unknown[] : [];
  const output: IncomingWhatsAppMessage[] = [];
  for (const entry of entries) {
    const changes = entry && typeof entry === 'object' && Array.isArray((entry as Record<string, unknown>).changes)
      ? (entry as Record<string, unknown>).changes as unknown[] : [];
    for (const change of changes) {
      if (!change || typeof change !== 'object' || (change as Record<string, unknown>).field !== 'messages') continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== 'object') continue;
      const metadata = (value as Record<string, unknown>).metadata;
      const phoneNumberId = metadata && typeof metadata === 'object' ? normalizePhone(String((metadata as Record<string, unknown>).phone_number_id || '')) : '';
      const connection = byPhoneNumberId.get(phoneNumberId);
      if (!connection) continue;
      const contacts = Array.isArray((value as Record<string, unknown>).contacts) ? (value as Record<string, unknown>).contacts as unknown[] : [];
      const profile = contacts[0] && typeof contacts[0] === 'object' ? (contacts[0] as Record<string, unknown>).profile : null;
      const contactName = profile && typeof profile === 'object' && typeof (profile as Record<string, unknown>).name === 'string'
        ? String((profile as Record<string, unknown>).name).trim().slice(0, 160) : null;
      const messages = Array.isArray((value as Record<string, unknown>).messages) ? (value as Record<string, unknown>).messages as unknown[] : [];
      for (const message of messages) {
        if (!message || typeof message !== 'object') continue;
        const row = message as Record<string, unknown>;
        const phone = normalizePhone(String(row.from || ''));
        const externalMessageId = typeof row.id === 'string' ? row.id.slice(0, 255) : '';
        const media = incomingImage(row);
        const text = readableText(row) || media?.caption || (media ? '📷 Foto recebida' : '');
        if (!phone || !externalMessageId || !text) continue;
        const unixSeconds = typeof row.timestamp === 'string' && /^\d+$/.test(row.timestamp) ? Number(row.timestamp) : NaN;
        output.push({
          companyId: connection.companyId,
          phoneNumberId: connection.phoneNumberId,
          phone,
          externalMessageId,
          text,
          contactName,
          occurredAt: Number.isFinite(unixSeconds) ? new Date(unixSeconds * 1000).toISOString() : null,
          media,
          accessToken: connection.accessToken,
          apiVersion: connection.apiVersion,
        });
      }
    }
  }
  return output;
}

export { normalizePhone };
