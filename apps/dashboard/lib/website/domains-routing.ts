import { supabaseRequest } from '../supabase';
import { WebsiteError } from './model';
import { isCoreWebsiteHost, normalizeCustomHostname, requestHostname } from './domains-host';

export async function activeWebsiteDomain(hostname: string): Promise<{ companyId: string; slug: string } | null> {
  try { if (normalizeCustomHostname(hostname) !== hostname) return null; } catch { return null; }
  const rows = await supabaseRequest<Array<{ company_id: string; companies: { slug: string } | null }>>(`company_website_domains?hostname=eq.${encodeURIComponent(hostname)}&status=eq.active&disabled_at=is.null&ownership_verified_at=not.is.null&tls_verified_at=not.is.null&select=company_id,companies!inner(slug)&limit=1`, { timeoutMs: 4000 });
  const row = rows[0];
  return row?.companies?.slug ? { companyId: row.company_id, slug: row.companies.slug } : null;
}

/** Public pages and handlers recheck the real Host independently of Proxy rewrites. */
export async function assertPublicWebsiteHost(headers: Pick<Headers, 'get'>, slug: string): Promise<void> {
  const host = requestHostname(headers);
  if (isCoreWebsiteHost(host)) return;
  const domain = host ? await activeWebsiteDomain(host) : null;
  if (!domain || domain.slug !== slug) throw new WebsiteError('Site não encontrado.', 404);
}

export function assertCoreWebsiteHost(headers: Pick<Headers, 'get'>) {
  if (!isCoreWebsiteHost(requestHostname(headers))) throw new WebsiteError('Página não encontrada.', 404);
}
