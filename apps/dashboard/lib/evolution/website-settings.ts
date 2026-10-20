/** Preparation only: no adapter, connection, credentials, feed or synchronization is enabled by these values. */
export type WebsiteSettings = { url: string; provider: string; syncScope: 'full' };
export type StoredWebsiteSettings = WebsiteSettings & { updatedAt: string; updatedBy: string };
export const DEFAULT_WEBSITE_SETTINGS: WebsiteSettings = Object.freeze({ url: '', provider: '', syncScope: 'full' });

export class WebsiteSettingsValidationError extends Error {
  constructor(message = 'Configuração do site inválida. Confira os campos informados.') {
    super(message); this.name = 'WebsiteSettingsValidationError';
  }
}
const invalid = (message?: string): never => { throw new WebsiteSettingsValidationError(message); };
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reservedSuffixes = ['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'arpa', 'test', 'invalid', 'example', 'onion'];

/** Syntax-only preparation, deliberately without DNS or HTTP. A future adapter must independently verify ownership, DNS/IP/redirect safety and provider credentials before any network access. */
function publicWebsiteUrl(value: string): string {
  if (!/^https:\/\/[^/]/i.test(value) || /[\s\\?#\u0000-\u001f\u007f]/u.test(value)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) invalid('Informe o endereço público HTTPS do site, sem parâmetros, acesso ou fragmento.');
  const authority = value.slice(8).split('/')[0];
  if (authority.includes('@') || (authority.includes(':') && !/^[^:]+:443$/.test(authority))) invalid('Use o domínio público sem dados de acesso e apenas a porta HTTPS padrão.');
  let parsed: URL;
  try { parsed = new URL(value); } catch { return invalid('Informe um endereço HTTPS válido para o site.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.port && parsed.port !== '443')) invalid('Use HTTPS na porta padrão, sem usuário, senha, parâmetros ou fragmento.');
  const hostname = parsed.hostname.toLowerCase();
  const labels = hostname.split('.');
  if (hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
    || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels[labels.length - 1])
    || reservedSuffixes.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))) {
    invalid('Informe um domínio público completo. Endereços locais, internos e IPs não são aceitos.');
  }
  if (parsed.href.length > 1024) invalid('O endereço do site deve ter até 1024 caracteres.');
  return parsed.href;
}

/** The complete editable object; unknown fields (including connection status and audit data) are rejected. */
export function validateWebsiteSettings(raw: unknown): WebsiteSettings {
  if (!isObject(raw) || Object.keys(raw).length !== 3 || !Object.hasOwn(raw, 'url') || !Object.hasOwn(raw, 'provider')
    || !Object.hasOwn(raw, 'syncScope') || typeof raw.url !== 'string' || typeof raw.provider !== 'string' || raw.syncScope !== 'full') return invalid();
  if (raw.url.length > 1024 || raw.provider.length > 100 || /[\u0000-\u001f\u007f]/u.test(raw.url + raw.provider)) return invalid('Confira os limites do endereço (1024) e do fornecedor (100 caracteres).');
  const url = raw.url.trim(), provider = raw.provider.trim();
  if (!url) {
    if (provider) return invalid('Informe o endereço do site ou deixe endereço e fornecedor vazios para remover o cadastro.');
    return { ...DEFAULT_WEBSITE_SETTINGS };
  }
  return { url: publicWebsiteUrl(url), provider, syncScope: 'full' };
}

/** Absent legacy settings have no configured site; corrupt saved settings are not silently replaced. */
export function getWebsiteSettings(raw?: unknown): WebsiteSettings {
  if (raw === undefined) return { ...DEFAULT_WEBSITE_SETTINGS };
  if (!isObject(raw)) return invalid();
  if (!Object.hasOwn(raw, 'updatedAt') && !Object.hasOwn(raw, 'updatedBy')) return validateWebsiteSettings(raw);
  if (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt))
    || new Date(raw.updatedAt).toISOString() !== raw.updatedAt || typeof raw.updatedBy !== 'string' || !UUID.test(raw.updatedBy)) return invalid();
  const editable = { ...raw };
  delete editable.updatedAt; delete editable.updatedBy;
  return validateWebsiteSettings(editable);
}
