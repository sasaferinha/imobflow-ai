import { isIP } from 'node:net';
import type { LeadProfile } from './leads';
import type { PropertyRecord } from './operations';
import { moneyValue, whatsappNumber } from './property-matching';

export type ImmediatePropertyMatchResult =
  | { status: 'matched'; propertyId: string; text: string; phone: string; reasons: string[] }
  | { status: 'skipped'; reason: 'inactive_lead' | 'invalid_phone' | 'incomplete_profile' | 'invalid_budget' | 'unsupported_preferences' | 'no_available_match'; reasons: string[] };

type Budget = { minimum: number; maximum: number };
type Rooms = { count: number; minimum: boolean };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const kinds = ['apartamento', 'casa', 'studio', 'terreno', 'comercial'];

function purpose(value: string): PropertyRecord['purpose'] | null {
  const normalized = normalize(value);
  if (['comprar', 'compra'].includes(normalized)) return 'Venda';
  if (['alugar', 'aluguel', 'locar', 'locacao'].includes(normalized)) return 'Aluguel';
  return null;
}

// Values without a qualifier are a budget ceiling, as in the CRM. Explicit
// ranges, exact amounts and minimums retain their lower bound.
function budget(value: string): Budget | null {
  const text = normalize(value);
  const ceiling = /^(?:ate|no maximo|maximo de)\s+(.+)$/.exec(text);
  const floor = /^(?:a partir de|no minimo|minimo de|pelo menos)\s+(.+)$/.exec(text);
  const exact = /^(?:exatamente|valor exato de)\s+(.+)$/.exec(text);
  if (ceiling || floor || exact) {
    const amount = moneyValue((ceiling || floor || exact)![1]);
    if (amount === null) return null;
    return { minimum: floor || exact ? amount : 0, maximum: floor ? Infinity : amount };
  }
  const range = /^(?:de\s+)?(.+?)\s+(?:a|ate)\s+(.+)$/.exec(text) || /^entre\s+(.+?)\s+e\s+(.+)$/.exec(text);
  if (range) {
    const minimum = moneyValue(range[1]);
    const maximum = moneyValue(range[2]);
    if (minimum === null || maximum === null || minimum > maximum) return null;
    // "400 a 500 mil" leaves the first unit implicit; do not infer a range.
    const scaled = (part: string) => /\b(?:mil|milhao|milhoes)\b/.test(part);
    if ((!scaled(range[1]) && minimum < 1000 && scaled(range[2])) ||
      (!scaled(range[2]) && maximum < 1000 && scaled(range[1]))) return null;
    return { minimum, maximum };
  }
  const maximum = moneyValue(text);
  return maximum === null ? null : { minimum: 0, maximum };
}

function regions(value: string): string[] | null {
  const text = normalize(value);
  // Matching supports explicitly named neighborhoods only. Relative locations,
  // negations and other qualifiers need interpretation before automatic use.
  if (/\b(?:ou|e|nao|sem|menos|qualquer|indiferente|preferencia|preferencialmente|preferencial|proximo|proxima|perto|arredores|regiao|com|exceto|apenas|somente|informado|tanto|faz)\b/.test(text)) return null;
  const parts = text.split(/[,;/]/).map((part) => part.trim());
  if (!parts.length || parts.some((part) => part.length < 3 || part.length > 100 || !/^[a-z0-9][a-z0-9 '\-]*$/.test(part))) return null;
  return [...new Set(parts)];
}

function numberWords(value: string): string {
  const words: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
  return normalize(value).replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis)\b/g, (word) => String(words[word]));
}

function detailRooms(value: string | null): Rooms | null | 'unsupported' {
  const text = numberWords(value || '');
  if (['', '-', 'nao informado'].includes(text)) return null;
  // The entire details field must be understood. Stripping just the bedroom
  // phrase would silently lose requirements such as a balcony or accessibility.
  const match = /^(?:(?:quero|procuro|busco)\s+)?(?:com\s+)?(?:(no minimo|minimo de|pelo menos)\s+)?(\d+)\s+(?:quartos?|dormitorios?)(\s+ou mais)?[.!]?$/.exec(text);
  if (!match) return 'unsupported';
  const count = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || count > 29) return 'unsupported';
  return { count, minimum: Boolean(match[1] || match[3]) };
}

function propertyRooms(property: PropertyRecord): number | null {
  if (property.bedrooms !== undefined) {
    return Number.isInteger(property.bedrooms) && property.bedrooms >= 0 && property.bedrooms < 30 ? property.bedrooms : null;
  }
  const text = numberWords(property.meta || '');
  if (/\b(?:nao|sem|menos|minimo|maximo|ate|ou)\b|\d+\s*(?:a|-)\s*\d+/.test(text)) return null;
  const matches = [...text.matchAll(/\b(\d+)\s+(?:quartos?|dormitorios?)\b/g)];
  if (matches.length !== 1) return null;
  const count = Number(matches[0][1]);
  return count >= 0 && count < 30 ? count : null;
}

// This validates a link for inclusion in text; it never resolves or fetches it.
// Reject all IP literals, credentials, unusual ports and local/reserved names.
export function publicPropertyUrl(value: string | undefined): string | null {
  if (!value || value.length > 2048 || /\s|[\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const labels = host.split('.');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || host.endsWith('.') || isIP(host) || host.includes(':') ||
      labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      !/^[a-z]{2,63}$/.test(labels[labels.length - 1]) ||
      labels.some((label) => ['localhost', 'local', 'internal', 'intranet', 'home', 'lan'].includes(label)) ||
      /\.(?:test|example|invalid|arpa|onion)$/.test(host) ||
      /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

function safeLabel(value: string): boolean {
  return Boolean(value.trim()) && value.length <= 180 && !/[\u0000-\u001f\u007f]|https?:|www\./i.test(value);
}

/**
 * Pure selection from inventory already scoped to the authenticated company.
 * The caller must preserve raw availability/purpose (no default to available),
 * enforce channel/assignment/inbound-message rules and own delivery/deduplication.
 * Creation dates deliberately do not affect immediate recommendations.
 */
export function immediatePropertyMatch(lead: LeadProfile, properties: PropertyRecord[]): ImmediatePropertyMatchResult {
  const skip = (reason: Extract<ImmediatePropertyMatchResult, { status: 'skipped' }>['reason'], explanation: string): ImmediatePropertyMatchResult =>
    ({ status: 'skipped', reason, reasons: [explanation] });
  if (!['Novo', 'Em atendimento'].includes(lead.lifecycleStatus)) return skip('inactive_lead', 'Lead fora das etapas de atendimento automático.');
  const phone = whatsappNumber(lead.phone);
  if (!phone) return skip('invalid_phone', 'Telefone válido ausente.');
  const desiredPurpose = purpose(lead.goal);
  const kind = normalize(lead.propertyType);
  const districts = regions(lead.region);
  if (!desiredPurpose || !kinds.includes(kind) || !districts) return skip('incomplete_profile', 'Informe finalidade, tipo e bairros sem alternativas ambíguas.');
  const amounts = budget(lead.budget);
  if (!amounts) return skip('invalid_budget', 'Orçamento ausente ou ambíguo.');
  const rooms = detailRooms(lead.details);
  if (rooms === 'unsupported') return skip('unsupported_preferences', 'Há preferências que este envio automático não consegue verificar.');
  if (!rooms && ['casa', 'apartamento'].includes(kind)) return skip('incomplete_profile', 'Informe a quantidade de quartos desejada.');

  const matches = properties.flatMap((property) => {
    if (property.status !== 'Disponível' || property.purpose !== desiredPurpose ||
      normalize(property.propertyType || '') !== kind || !districts.includes(normalize(property.district)) ||
      !property.id || !safeLabel(property.title) || !safeLabel(property.district)) return [];
    const price = moneyValue(property.price);
    const url = publicPropertyUrl(property.publicUrl);
    if (price === null || price < amounts.minimum || price > amounts.maximum) return [];
    const count = propertyRooms(property);
    if (rooms && (count === null || (rooms.minimum ? count < rooms.count : count !== rooms.count))) return [];
    return [{ property, price, url, count }];
  }).sort((left, right) => left.price - right.price || (left.property.id < right.property.id ? -1 : left.property.id > right.property.id ? 1 : 0));
  const match = matches[0];
  if (!match) return skip('no_available_match', 'Nenhum imóvel disponível confirma os critérios informados.');
  const firstName = lead.name.trim().split(/\s+/)[0];
  const greeting = /^[\p{L}][\p{L}'’-]{0,49}$/u.test(firstName) ? `Olá, ${firstName}!` : 'Olá!';
  const roomText = rooms && match.count !== null ? `, com ${match.count} ${match.count === 1 ? 'quarto' : 'quartos'}` : '';
  return {
    status: 'matched', propertyId: match.property.id, phone,
    text: `${greeting} Encontrei este imóvel disponível para ${desiredPurpose === 'Venda' ? 'compra' : 'aluguel'}: ${match.property.title}, no bairro ${match.property.district}${roomText}, por ${match.property.price}.${match.url ? `\n${match.url}` : ''}\nGostaria de saber mais?`,
    reasons: [desiredPurpose, match.property.propertyType!, match.property.district, 'Dentro do orçamento informado', ...(rooms ? [`${match.count} quartos`] : [])],
  };
}
