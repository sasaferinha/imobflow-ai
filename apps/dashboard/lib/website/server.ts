import { randomUUID } from 'node:crypto';
import { hashPassword, normalizeEmail } from '../accounts';
import { supabaseRequest } from '../supabase';
import { publicCompany } from '../public-company';
import { defaultSiteContent, validateSiteContent, projectPublicProperty, WebsiteError, type SiteContent, type SiteDocument, type MarketingAccount, type WebsiteSnapshot, type PublicProperty } from './model';
import type { WebsiteActor } from './auth';

type SiteRow = { company_id: string; version: number; draft: unknown; published: unknown; previous: unknown; published_at: string | null; updated_at: string | null };
async function companyFor(actor: WebsiteActor) {
  const [company] = await supabaseRequest<Array<{ id: string; name: string; slug: string }>>(`companies?id=eq.${encodeURIComponent(actor.companyId)}&select=id,name,slug&limit=1`);
  if (!company) throw new WebsiteError('Imobiliária indisponível.', 404);
  return company;
}
export async function readWebsiteCatalog(companyId: string): Promise<PublicProperty[]> {
  const rows = await supabaseRequest<Array<Record<string, unknown>>>('rpc/website_catalog', { method: 'POST', body: { p_company_id: companyId } });
  if (!Array.isArray(rows) || rows.length > 10000) throw new WebsiteError('Não foi possível carregar o catálogo completo. Contate o suporte.', 503);
  return rows.map(projectPublicProperty).filter((item): item is PublicProperty => !!item);
}
function siteDocument(row: SiteRow | undefined, companyName: string): SiteDocument {
  return row ? { version: Number(row.version), draft: validateSiteContent(row.draft), published: row.published ? validateSiteContent(row.published) : null, previous: row.previous ? validateSiteContent(row.previous) : null, publishedAt: row.published_at, updatedAt: row.updated_at } : { version: 0, draft: defaultSiteContent(companyName), published: null, previous: null, publishedAt: null, updatedAt: null };
}
export async function listWebsiteMarketing(actor: WebsiteActor): Promise<MarketingAccount[]> {
  if (actor.role !== 'owner') throw new WebsiteError('Somente o administrador pode gerenciar os acessos.', 403);
  return supabaseRequest<MarketingAccount[]>(`website_marketing_accounts?company_id=eq.${encodeURIComponent(actor.companyId)}&select=id,name,email,active&order=created_at.asc`, { allRows: true });
}
export async function readWebsiteSnapshot(actor: WebsiteActor): Promise<WebsiteSnapshot> {
  const [company, rows, properties, marketingAccounts] = await Promise.all([
    companyFor(actor), supabaseRequest<SiteRow[]>(`company_websites?company_id=eq.${encodeURIComponent(actor.companyId)}&select=company_id,version,draft,published,previous,published_at,updated_at&limit=1`), readWebsiteCatalog(actor.companyId), actor.role === 'owner' ? listWebsiteMarketing(actor) : undefined,
  ]);
  return { company, site: siteDocument(rows[0], company.name), properties, role: actor.role, ...(marketingAccounts ? { marketingAccounts } : {}) };
}
export async function changeWebsite(actor: WebsiteActor, body: Record<string, unknown>): Promise<WebsiteSnapshot> {
  if (Object.keys(body).some(key => !['action', 'expectedVersion', 'content'].includes(key)) || !['save', 'publish', 'unpublish', 'restore'].includes(String(body.action)) || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) throw new WebsiteError('Comando inválido. Atualize o site e tente novamente.');
  const content = ['save', 'publish'].includes(String(body.action)) ? validateSiteContent(body.content) : null;
  await supabaseRequest('rpc/save_company_website', { method: 'POST', body: { p_company_id: actor.companyId, p_actor_id: actor.id, p_actor_role: actor.role, p_expected_version: body.expectedVersion, p_action: body.action, p_content: content } });
  return readWebsiteSnapshot(actor);
}
export async function manageWebsiteMarketing(actor: WebsiteActor, body: Record<string, unknown>): Promise<MarketingAccount[]> {
  if (actor.role !== 'owner') throw new WebsiteError('Somente o administrador pode gerenciar os acessos.', 403);
  if (!['create', 'deactivate', 'reset-password'].includes(String(body.action)) || Object.keys(body).some(key => !['action','name','email','password','id'].includes(key))) throw new WebsiteError('Comando inválido.');
  let id = '', name = '', email = '', passwordHash = '';
  if (body.action === 'create') {
    name = typeof body.name === 'string' ? body.name.trim() : ''; email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name) || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WebsiteError('Informe um nome e um email válidos.');
    id = randomUUID();
  } else {
    id = typeof body.id === 'string' ? body.id : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new WebsiteError('Acesso inválido.');
  }
  if (body.action === 'create' || body.action === 'reset-password') {
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) throw new WebsiteError('Use uma senha de 12 a 128 caracteres.');
    passwordHash = await hashPassword(body.password);
  }
  await supabaseRequest('rpc/manage_website_marketing', { method: 'POST', body: { p_company_id: actor.companyId, p_actor_id: actor.id, p_action: body.action, p_id: id, p_name: name, p_email: email, p_password_hash: passwordHash } });
  return listWebsiteMarketing(actor);
}
/** Only a boolean marker is read: withdrawal must not resurrect the old contact page. */
export async function hasWebsitePublication(companyId: string): Promise<boolean> {
  const rows = await supabaseRequest<Array<{ company_id: string }>>(`company_websites?company_id=eq.${encodeURIComponent(companyId)}&or=(published.not.is.null,previous.not.is.null)&select=company_id&limit=1`);
  return rows.length > 0;
}
export async function getPublicWebsite(slug: string): Promise<{ company: { id: string; name: string; slug: string }; content: SiteContent; properties: PublicProperty[] } | null> {
  const company = await publicCompany(slug); if (!company) return null;
  // Never SELECT draft, previous, audit metadata or marketing accounts here.
  const [row] = await supabaseRequest<Array<{ published: unknown }>>(`company_websites?company_id=eq.${company.id}&published=not.is.null&select=published&limit=1`);
  if (!row?.published) return null;
  const content = validateSiteContent(row.published), properties = await readWebsiteCatalog(company.id);
  // Prices hidden in the design are also absent from usable public data.
  return { company, content, properties: content.showPrices ? properties : properties.map(p => ({ ...p, price: 0 })) };
}
