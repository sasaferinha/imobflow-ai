export type SiteLayout = 'classic' | 'modern' | 'catalog';
export const SITE_LAYOUTS = [
  { id: 'classic', name: 'Clássico', description: 'Apresentação acolhedora, com foto de capa e catálogo em destaque.' },
  { id: 'modern', name: 'Moderno', description: 'Imagem ampla, contraste e uma apresentação marcante.' },
  { id: 'catalog', name: 'Vitrine', description: 'Busca e imóveis em primeiro plano, com apresentação compacta.' },
] as const satisfies readonly { id: SiteLayout; name: string; description: string }[];

export type SiteContent = {
  layout: SiteLayout;
  brandName: string; tagline: string; primaryColor: string; logoUrl: string; heroImageUrl: string;
  heroTitle: string; heroText: string; aboutTitle: string; aboutText: string;
  contactPhone: string; contactEmail: string; contactAddress: string; instagramUrl: string;
  promotion: { enabled: boolean; title: string; text: string; imageUrl: string; linkUrl: string; linkLabel: string };
  video: { enabled: boolean; title: string; url: string }; showPrices: boolean;
};
export type PublicProperty = { id: string; code: string; title: string; purpose: 'Venda' | 'Aluguel'; price: number; district: string; city: string; propertyType: string; bedrooms: number; parkingSpaces: number; area: number; description: string; images: string[]; features: string };
export type SiteDocument = { version: number; draft: SiteContent; published: SiteContent | null; publishedAt: string | null; updatedAt: string | null; previous: SiteContent | null };
export type MarketingAccount = { id: string; name: string; email: string; active: boolean };
export type WebsiteSnapshot = { site: SiteDocument; company: { id: string; name: string; slug: string }; properties: PublicProperty[]; role: 'owner' | 'marketing'; marketingAccounts?: MarketingAccount[] };
export class WebsiteError extends Error { constructor(message: string, public status = 400) { super(message); this.name = 'WebsiteError'; } }
export function defaultSiteContent(companyName: string): SiteContent {
  return { layout: 'classic', brandName: companyName, tagline: 'Imóveis para o seu próximo capítulo', primaryColor: '#174B42', logoUrl: '', heroImageUrl: '', heroTitle: 'Encontre um lugar para viver bem.', heroText: 'Conheça nossos imóveis e converse com quem entende da sua próxima conquista.', aboutTitle: 'Perto de você em cada escolha.', aboutText: '', contactPhone: '', contactEmail: '', contactAddress: '', instagramUrl: '', promotion: { enabled: false, title: '', text: '', imageUrl: '', linkUrl: '', linkLabel: 'Saiba mais' }, video: { enabled: false, title: '', url: '' }, showPrices: true };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reject = (message: string): never => { throw new WebsiteError(message); };
function shape(value: unknown, keys: string[], label: string): Record<string, unknown> { if (!object(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) reject(`${label}: confira os campos.`); return value as Record<string, unknown>; }
function text(value: unknown, max: number, label: string, required = false): string { if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) reject(`${label}: conteúdo inválido ou muito longo.`); const result = (value as string).trim(); if (required && !result) reject(`Preencha ${label.toLowerCase()}.`); return result; }
/** URLs are rendered by the browser, never fetched by the server. No credentials, local hosts or executable schemes. */
export function safeWebsiteUrl(raw: unknown, allowRelative = true): string {
  const value = text(raw, 2048, 'Endereço');
  if (!value) return '';
  if (allowRelative && /^\/[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/.test(value) && !value.includes('..')) return value;
  try {
    const u = new URL(value);
    if (!/^https:\/\//i.test(value) || u.protocol !== 'https:' || u.username || u.password || u.port || /[\s\\]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value) || !u.hostname.includes('.') || u.hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|arpa|corp|test|invalid|example|onion)$/.test(u.hostname) || /^\d[\d.]*$/.test(u.hostname)) return reject('Use um endereço público HTTPS, sem dados de acesso.');
    return u.href;
  } catch { return reject('Use um endereço público HTTPS válido.'); }
}
export function videoEmbedUrl(raw: string): string {
  const safe = safeWebsiteUrl(raw, false); if (!safe) return '';
  const u = new URL(safe), host = u.hostname.toLowerCase(); let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) id = u.pathname === '/watch' ? u.searchParams.get('v') || '' : /^\/(?:embed|shorts)\/([A-Za-z0-9_-]+)$/.exec(u.pathname)?.[1] || '';
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`;
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) { const v = /^\/(?:video\/)?(\d{1,15})\/?$/.exec(u.pathname)?.[1]; if (v) return `https://player.vimeo.com/video/${v}`; }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return safe;
  return reject('Use um vídeo do YouTube, Vimeo ou um arquivo HTTPS MP4/WebM.');
}
export function validateSiteContent(input: unknown): SiteContent {
  const keys = Object.keys(defaultSiteContent(''));
  // Existing drafts and publications keep their original appearance. Only an
  // absent field is legacy; explicit null, undefined or unknown layouts fail.
  const compatible = object(input) && !Object.hasOwn(input, 'layout') ? { ...input, layout: 'classic' } : input;
  const o = shape(compatible, keys, 'Site');
  if (!SITE_LAYOUTS.some(item => item.id === o.layout)) reject('Escolha um modelo de site válido.');
  const p = shape(o.promotion, ['enabled', 'title', 'text', 'imageUrl', 'linkUrl', 'linkLabel'], 'Destaque');
  const v = shape(o.video, ['enabled', 'title', 'url'], 'Vídeo');
  if (typeof p.enabled !== 'boolean' || typeof v.enabled !== 'boolean' || typeof o.showPrices !== 'boolean') reject('Confira as opções de exibição.');
  const color = text(o.primaryColor, 7, 'Cor'); if (!/^#[0-9a-f]{6}$/i.test(color)) reject('Escolha uma cor válida.');
  const email = text(o.contactEmail, 160, 'Email'); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reject('Confira o email de contato.');
  const phone = text(o.contactPhone, 30, 'Telefone'); if (phone && (!/^[+()\d\s-]{8,30}$/.test(phone) || !/^\d{8,15}$/.test(phone.replace(/\D/g, '')))) reject('Confira o telefone de contato.');
  const videoUrl = text(v.url, 2048, 'Vídeo'); if (videoUrl) videoEmbedUrl(videoUrl); if (v.enabled && !videoUrl) reject('Informe o endereço do vídeo.');
  const promotionTitle = text(p.title, 120, 'Título do destaque', p.enabled === true);
  return { layout: o.layout as SiteLayout, brandName: text(o.brandName, 120, 'Nome da imobiliária', true), tagline: text(o.tagline, 160, 'Frase da marca'), primaryColor: color, logoUrl: safeWebsiteUrl(o.logoUrl), heroImageUrl: safeWebsiteUrl(o.heroImageUrl), heroTitle: text(o.heroTitle, 160, 'Título principal', true), heroText: text(o.heroText, 600, 'Texto principal'), aboutTitle: text(o.aboutTitle, 160, 'Título sobre a empresa'), aboutText: text(o.aboutText, 3000, 'Sobre a empresa'), contactPhone: phone, contactEmail: email, contactAddress: text(o.contactAddress, 300, 'Endereço da empresa'), instagramUrl: safeWebsiteUrl(o.instagramUrl, false), promotion: { enabled: p.enabled as boolean, title: promotionTitle, text: text(p.text, 1200, 'Texto do destaque'), imageUrl: safeWebsiteUrl(p.imageUrl), linkUrl: safeWebsiteUrl(p.linkUrl), linkLabel: text(p.linkLabel, 60, 'Texto do botão') }, video: { enabled: v.enabled as boolean, title: text(v.title, 160, 'Título do vídeo'), url: videoUrl }, showPrices: o.showPrices as boolean };
}
/** Explicit allowlist: never serialize property owners, notes, address or CRM activity. */
export function projectPublicProperty(raw: Record<string, unknown>): PublicProperty | null {
  if (raw.status !== 'Disponível' || !['Venda', 'Aluguel'].includes(String(raw.purpose)) || typeof raw.id !== 'string' || !raw.id || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  const number = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
  const string = (v: unknown, max = 300) => typeof v === 'string' ? v.slice(0, max) : '';
  const images = (Array.isArray(raw.images) ? raw.images : []).flatMap(v => { try { const url = safeWebsiteUrl(v); return url ? [url] : []; } catch { return []; } }).slice(0, 20);
  return { id: raw.id, code: string(raw.code, 100), title: raw.title.slice(0, 300), purpose: raw.purpose as 'Venda' | 'Aluguel', price: number(raw.price), district: string(raw.district), city: string(raw.city), propertyType: string(raw.property_type || raw.propertyType), bedrooms: number(raw.bedrooms), parkingSpaces: number(raw.parking_spaces ?? raw.parkingSpaces), area: number(raw.area), description: string(raw.description, 10000), images, features: string(raw.features, 4000) };
}
