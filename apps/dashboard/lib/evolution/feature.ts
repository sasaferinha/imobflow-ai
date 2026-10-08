/** Server-only rollout gate. An empty allowlist always leaves the legacy UI active. */
export function evolutionEnabled(companyId: string): boolean {
  if (process.env.CRM_EVOLUTION_ENABLED !== 'true') return false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(companyId)) return false;
  const enabled = (process.env.CRM_EVOLUTION_COMPANIES || '').split(',')
    .map(value => value.trim().toLowerCase()).filter(value => uuid.test(value));
  return enabled.includes(companyId.toLowerCase());
}
