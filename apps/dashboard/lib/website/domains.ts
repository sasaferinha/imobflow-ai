import { randomBytes, randomUUID } from 'node:crypto';
import { supabaseRequest } from '../supabase';
import type { WebsiteActor } from './auth';
import { WebsiteError } from './model';
import { normalizeCustomHostname } from './domains-host';
import { checkWebsiteDomain, domainProviderConfig } from './domains-provider';
import type { WebsiteDomain, WebsiteDomainStatus, WebsiteDomainsSnapshot, WebsiteDnsRecord } from './domains-model';

type DomainRow = { id: string; company_id: string; hostname: string; ownership_token: string; status: WebsiteDomainStatus; version: number; disabled_at: string | null; ownership_verified_at: string | null; tls_verified_at: string | null; checked_at: string | null; message: string; records: WebsiteDnsRecord[] };
const fields = 'id,company_id,hostname,ownership_token,status,version,disabled_at,ownership_verified_at,tls_verified_at,checked_at,message,records';
function requireOwner(actor: WebsiteActor) { if (actor.role !== 'owner') throw new WebsiteError('Somente o administrador pode gerenciar o domínio.', 403); }
function present(row: DomainRow): WebsiteDomain {
  return { id: row.id, hostname: row.hostname, status: row.status, version: Number(row.version), disabled: !!row.disabled_at, checkedAt: row.checked_at, ownershipVerifiedAt: row.ownership_verified_at, tlsVerifiedAt: row.tls_verified_at, message: row.message, records: [{ type: 'TXT', name: `_imobflow-domain.${row.hostname}`, value: `imobflow-verification=${row.ownership_token}`, purpose: 'ownership' }, ...(Array.isArray(row.records) ? row.records : [])] };
}
export async function readWebsiteDomains(actor: WebsiteActor): Promise<WebsiteDomainsSnapshot> {
  requireOwner(actor);
  const rows = await supabaseRequest<DomainRow[]>(`company_website_domains?company_id=eq.${encodeURIComponent(actor.companyId)}&select=${fields}&order=created_at.asc&limit=4`);
  return { domains: rows.map(present), providerConfigured: !!domainProviderConfig() };
}
export async function changeWebsiteDomain(actor: WebsiteActor, body: Record<string, unknown>): Promise<WebsiteDomainsSnapshot> {
  requireOwner(actor);
  if (!['create', 'verify', 'disable', 'enable'].includes(String(body.action)) || Object.keys(body).some(key => !['action', 'hostname', 'id', 'expectedVersion'].includes(key))) throw new WebsiteError('Comando de domínio inválido.');
  if (body.action === 'create') {
    const hostname = normalizeCustomHostname(body.hostname);
    await supabaseRequest('rpc/manage_website_domain', { method: 'POST', body: { p_company_id: actor.companyId, p_actor_id: actor.id, p_action: 'create', p_hostname: hostname, p_token: randomBytes(32).toString('hex') } });
  } else {
    if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) throw new WebsiteError('Atualize a lista de domínios antes de continuar.');
    const scope = { p_company_id: actor.companyId, p_actor_id: actor.id, p_id: body.id };
    if (body.action === 'verify') {
      const checkId = randomUUID();
      const row = await supabaseRequest<DomainRow>('rpc/begin_website_domain_check', { method: 'POST', body: { ...scope, p_expected_version: body.expectedVersion, p_check_id: checkId } });
      // Normalize again: server jobs must never provision a reserved/platform host.
      const result = await checkWebsiteDomain(normalizeCustomHostname(row.hostname), row.ownership_token);
      await supabaseRequest('rpc/finish_website_domain_check', { method: 'POST', body: { ...scope, p_check_id: checkId, p_result: result } });
    } else await supabaseRequest('rpc/manage_website_domain', { method: 'POST', body: { ...scope, p_expected_version: body.expectedVersion, p_action: body.action } });
  }
  return readWebsiteDomains(actor);
}

export function domainFailure(error: unknown): WebsiteError | unknown {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('website_domain_reserved') || message.includes('23505')) return new WebsiteError('Este domínio já possui um vínculo. Nenhum domínio de outra imobiliária será transferido. Se ele é seu, contate o suporte.', 409);
  if (message.includes('website_domain_limit')) return new WebsiteError('Sua imobiliária já possui três domínios cadastrados. Contate o suporte para ajustar seus vínculos.', 409);
  if (message.includes('website_domain_invalid')) return new WebsiteError('Confira o domínio informado.');
  return error;
}
