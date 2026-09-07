import type { LeadProfile } from './leads';
import type { PropertyRecord } from './operations';
import type { AutomationCandidate } from './automation-rules';

const normalize = (value: string) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const NEW_PROPERTY_DAYS = 7;

// Conservative parsing of the existing Brazilian currency fields; ambiguous
// free text is excluded, never interpreted as a confirmed match.
export function moneyValue(value: string): number | null {
  const text = normalize(value).replace(/^r\$\s*/, '').replace(/\s*\/\s*mes$/, '').trim();
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(,\d{1,2})?\s*(mil|milhao|milhoes)?$/.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(/\./g, '') + (match[2] || '').replace(',', '.')) * (match[3] === 'mil' ? 1000 : match[3] ? 1000000 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function budgetCeiling(value: string): number | null {
  const text = normalize(value).replace(/^(?:ate|no maximo|maximo de)\s+/, '').replace(/^de\s+/, '');
  const parts = text.split(/\s+(?:a|ate|e)\s+/);
  if (parts.length === 1) return moneyValue(text);
  if (parts.length !== 2) return null;
  const lower = moneyValue(parts[0]);
  const upper = moneyValue(parts[1]);
  return lower && upper && lower <= upper ? upper : null;
}

function bedrooms(value: string): { count: number; minimum: boolean } | null {
  const text = normalize(value).replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis)\b/g, (word) => String(({ um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 } as Record<string, number>)[word]));
  // Alternatives, ranges and negations require human interpretation.
  if (/\b(?:nao|sem|menos|maximo)\b|\d+\s*(?:ou|a|ate|-)\s*\d+/.test(text.replace(/pelo menos/g, 'minimo'))) return null;
  const matches = [...text.matchAll(/\b(\d+)\s*(?:quartos?|dormitorios?)\b/g)];
  if (matches.length !== 1) return null;
  const count = Number(matches[0][1]);
  return count > 0 && count < 30 ? { count, minimum: /\b(?:minimo|pelo menos)\b|quartos?\s+ou mais/.test(text) } : null;
}

function propertyKind(value: string): string | null {
  const text = normalize(value);
  const types = ['apartamento', 'casa', 'studio', 'terreno', 'comercial'];
  const found = types.filter((type) => new RegExp('\\b' + type + '\\b').test(text));
  return found.length === 1 ? found[0] : null;
}

export function newPropertyCandidates(lead: LeadProfile, properties: PropertyRecord[], now = new Date()): AutomationCandidate[] {
  if (['Convertido', 'Perdido'].includes(lead.lifecycleStatus)) return [];
  const goal = normalize(lead.goal);
  if (/alug|loca/.test(goal) && /compr/.test(goal)) return [];
  const purpose = /alug|loca/.test(goal) ? 'Aluguel' : /compr/.test(goal) ? 'Venda' : null;
  const ceiling = budgetCeiling(lead.budget);
  const rooms = bedrooms(lead.details || '');
  const kind = propertyKind(lead.propertyType);
  const regions = normalize(lead.region).split(/[,;/]/).map((region) => region.trim()).filter((region) => region.length > 2 && region !== 'nao informado');
  const contactDate = new Date(lead.lastContactAt || lead.createdAt).getTime();
  if (!purpose || !ceiling || !rooms || !kind || !regions.length || !Number.isFinite(contactDate)) return [];
  return properties.flatMap((property) => {
    const created = new Date(property.createdAt).getTime();
    const price = moneyValue(property.price);
    const propertyRooms = bedrooms(property.meta);
    if (!Number.isFinite(created) || created <= contactDate || created > now.getTime() || now.getTime() - created > NEW_PROPERTY_DAYS * 86400000 ||
      (property.status && property.status !== 'Disponível') || property.purpose !== purpose ||
      !regions.includes(normalize(property.district)) || !price || price > ceiling ||
      !propertyRooms || propertyRooms.minimum || (rooms.minimum ? propertyRooms.count < rooms.count : propertyRooms.count !== rooms.count) ||
      propertyKind(property.propertyType || property.title + ' ' + property.meta) !== kind) return [];
    const firstName = lead.name.trim().split(/\s+/)[0] || lead.name;
    const message = `Olá, ${firstName}! Acabou de ser catalogado um imóvel que se encaixa no perfil que você informou: ${property.title}, no bairro ${property.district}, com ${propertyRooms.count} quartos, por ${property.price}${purpose === 'Aluguel' ? ' (aluguel)' : ''}. Gostaria de conhecer os detalhes?`;
    return [{
      leadId: lead.id,
      // One opportunity per lead/property, independent of subsequent edits.
      version: 'new-property:' + property.id,
      summary: `${lead.name} · ${property.title}`,
      detail: { propertyId: property.id, leadName: lead.name, message, assignedTo: lead.assignedTo,
        matches: [{ id: property.id, title: property.title, district: property.district, price: property.price }],
        reasons: [property.district, `${propertyRooms.count} quartos`, `Dentro de ${lead.budget}`, property.purpose, lead.propertyType],
        note: 'Rascunho para revisão. Confira as demais preferências e a disponibilidade antes de contatar. Nenhuma mensagem enviada.' },
    }];
  });
}

export function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  // Domestic Brazilian numbers or explicitly country-prefixed numbers only.
  if (!phone.trim().startsWith('+') && /^(?:[1-9]\d)(?:[2-5]\d{7}|9\d{8})$/.test(digits)) return '55' + digits;
  if (/^55[1-9]\d(?:[2-5]\d{7}|9\d{8})$/.test(digits)) return digits;
  if (phone.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}
