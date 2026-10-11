/** A contact has one acquisition source; the messaging channel is independent. */
export const LEAD_SOURCE_OPTIONS: readonly string[] = ['Facebook', 'Instagram', 'Cliente pessoal', 'Tráfego pago', 'Indicação', 'WhatsApp', 'Site', 'Portal imobiliário', 'Placa no imóvel', 'Atendimento presencial', 'Outros'];

export function leadSourceOptions(configured: readonly string[] = [], current?: string): string[] {
  const values = [...LEAD_SOURCE_OPTIONS, ...configured, ...(current ? [current] : [])];
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim() && value !== 'Outros')), 'Outros'];
}

export function validLeadSource(value: unknown, configured: readonly string[] = [], current?: string): boolean {
  if (typeof value !== 'string' || !value || value.length > 200 || value !== value.trim() || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value)) return false;
  if (value.startsWith('Outros: ')) {
    const detail = value.slice(8);
    return Boolean(detail && detail === detail.trim());
  }
  return leadSourceOptions(configured, current).includes(value);
}
