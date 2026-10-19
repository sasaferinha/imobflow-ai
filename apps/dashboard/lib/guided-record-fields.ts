/** Shared suggestions only: these are not defaults or a closed validation vocabulary. */
export const PROPERTY_TYPE_CHOICES = ['Apartamento', 'Casa', 'Studio', 'Terreno', 'Comercial', 'Chácara', 'Sítio', 'Cobertura'] as const;
export const PROPERTY_FEATURE_CHOICES = ['Elevador', 'Varanda', 'Suíte', 'Mobiliado', 'Portaria', 'Piscina', 'Churrasqueira', 'Academia', 'Quintal', 'Aceita pets'] as const;
/** Manual creation UI only; intake and existing/legacy records keep their own contracts. */
export const NEW_PROPERTY_FORM_ESSENTIALS = ['city', 'district', 'propertyType', 'area', 'description', 'bedrooms', 'parkingSpaces'] as const;

const normalized = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
export function featureTokens(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[,;\n]+/).map(item => item.trim()).filter(item => {
    const key = normalized(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function featureSelected(value: string, option: string) {
  return featureTokens(value).some(item => normalized(item) === normalized(option));
}
export function toggleFeature(value: string, option: string, checked: boolean) {
  const tokens = featureTokens(value).filter(item => normalized(item) !== normalized(option));
  if (checked) tokens.push(option);
  return tokens.join(', ');
}
export function customFeatures(value: string, options: readonly string[]) {
  return featureTokens(value).filter(item => !options.some(option => normalized(item) === normalized(option))).join(', ');
}
export function replaceCustomFeatures(value: string, options: readonly string[], custom: string, previousCustom = '') {
  const previouslyTyped = featureTokens(previousCustom);
  const selected = featureTokens(value).filter(item => options.some(option => normalized(item) === normalized(option))
    && !previouslyTyped.some(typed => normalized(typed) === normalized(item)));
  // The caller's custom text is kept intact while typing, including its last separator.
  return [...selected, custom].filter(Boolean).join(', ');
}

type SuggestionRecord = { kind: string; data: Record<string, unknown> };
/** Uses only the tenant/role-filtered snapshot already available to the editor. */
export function locationSuggestions(records: readonly SuggestionRecord[], key: 'city' | 'district' | 'region', city = ''): string[] {
  const suggestions = new Map<string, string>();
  for (const record of records) {
    if (!['properties', 'leads', 'neighborhoods', 'condominiums'].includes(record.kind)) continue;
    if (key === 'district' && city && normalized(String(record.data.city || '')) !== normalized(city)) continue;
    const values = key === 'city' ? [record.data.city] : key === 'district'
      ? [record.data.district, ...(record.kind === 'neighborhoods' ? [record.data.name] : [])]
      : [record.data.region, record.data.district, ...(record.kind === 'neighborhoods' ? [record.data.name] : [])];
    for (const value of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const token = value.trim();
      if (!suggestions.has(normalized(token))) suggestions.set(normalized(token), token);
    }
  }
  return [...suggestions.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 80);
}
