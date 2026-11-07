import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, cookieOptions, readAccount, normalizeEmail, verifyPassword, newToken, tokenHash } from '../accounts';
import { supabaseRequest } from '../supabase';
import { hasSameOrigin, hasSafeRequestSize } from '../request-security';
import { WebsiteError } from './model';

export type WebsiteActor = { companyId: string; id: string; name: string; role: 'owner' | 'marketing' };
export const WEBSITE_COOKIE = 'imobflow_website_session';
export const websiteCookieOptions = { ...cookieOptions };
export async function resolveWebsiteActor(request: NextRequest): Promise<WebsiteActor | null> {
  // An explicit marketing view must never silently reuse another tenant's CRM
  // session when both cookies are present in the same browser.
  if (request.nextUrl.searchParams.get('access') !== 'marketing') {
    const owner = await readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value);
    if (owner?.role === 'owner') return { companyId: owner.companyId, id: owner.brokerId, name: owner.name, role: 'owner' };
    return null;
  }
  const token = request.cookies.get(WEBSITE_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await supabaseRequest<Array<{ id: string; company_id: string; name: string }>>('rpc/read_website_session', { method: 'POST', body: { p_token_hash: tokenHash(token) } });
  return row ? { id: row.id, companyId: row.company_id, name: row.name, role: 'marketing' } : null;
}
export async function requireWebsiteActor(request: NextRequest, ownerOnly = false): Promise<WebsiteActor> {
  const actor = await resolveWebsiteActor(request);
  if (!actor) throw new WebsiteError('Entre na sua conta para acessar o site.', 401);
  if (ownerOnly && actor.role !== 'owner') throw new WebsiteError('Somente o administrador pode gerenciar os acessos.', 403);
  const allowed = await supabaseRequest<boolean>('rpc/website_can_edit', { method: 'POST', body: { p_company_id: actor.companyId, p_actor_id: actor.id, p_actor_role: actor.role } });
  if (!allowed) throw new WebsiteError('Seu acesso mudou. Entre novamente.', 403);
  return actor;
}
export function websiteResponse(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }); }
export function websiteFailure(error: unknown) {
  if (error instanceof WebsiteError) return websiteResponse({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : '';
  if (message.includes('website_conflict')) return websiteResponse({ error: 'Outra pessoa atualizou o site. Recarregue e revise antes de salvar.' }, 409);
  if (message.includes('website_forbidden')) return websiteResponse({ error: 'Seu acesso não permite esta alteração.' }, 403);
  if (message.includes('website_no_previous')) return websiteResponse({ error: 'Ainda não há uma publicação anterior para restaurar.' }, 400);
  if (message.includes('website_not_found')) return websiteResponse({ error: 'Acesso não encontrado nesta imobiliária.' }, 404);
  if (message.includes('23505')) return websiteResponse({ error: 'Este email já possui um acesso de marketing. Use outro email.' }, 409);
  console.error('website_request_failed');
  return websiteResponse({ error: 'Não foi possível confirmar o resultado. Atualize a página antes de tentar novamente.' }, 503);
}
export function assertWebsiteOrigin(request: NextRequest) { if (!request.headers.get('origin') || !hasSameOrigin(request)) throw new WebsiteError('Origem não permitida.', 403); }
export async function readWebsiteBody(request: NextRequest, maximum = 65536): Promise<Record<string, unknown>> {
  assertWebsiteOrigin(request);
  if (!hasSafeRequestSize(request, maximum)) throw new WebsiteError('Requisição muito grande.', 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > maximum) throw new WebsiteError('Requisição muito grande.', 413);
  try { const value: unknown = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new WebsiteError('Confira os dados enviados.'); }
}
export async function authenticateWebsiteMarketing(email: string, password: string): Promise<string | null> {
  const rows = await supabaseRequest<Array<{ id: string; password_hash: string }>>(`website_marketing_accounts?email_key=eq.${encodeURIComponent(normalizeEmail(email))}&active=eq.true&select=id,password_hash&limit=2`);
  const account = rows.length === 1 ? rows[0] : undefined;
  const valid = await verifyPassword(password, account?.password_hash || `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`);
  if (!valid || !account) return null;
  const token = newToken();
  const accepted = await supabaseRequest<boolean>('rpc/issue_website_session', { method: 'POST', body: { p_account_id: account.id, p_expected_hash: account.password_hash, p_token_hash: tokenHash(token) } });
  return accepted ? token : null;
}
