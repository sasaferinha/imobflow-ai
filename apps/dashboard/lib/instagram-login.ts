import { createHash, randomBytes } from 'node:crypto';
import { supabaseServiceRequest as db } from './supabase';
import { SocialError } from './social-model';
import { encryptSocialToken, requireSocialOwner, socialTokenProtectionAvailable } from './social-connections';
import { instagramAvailable, instagramExchange, instagramSubscribe, INSTAGRAM_SCOPES, INSTAGRAM_VERSION } from './instagram-api';
import { instagramConnectionIssue, type InstagramConnectionIssue } from './instagram-connection-feedback';

export const INSTAGRAM_COOKIE = 'imobflow_instagram_state';
export const INSTAGRAM_CALLBACK = '/api/integrations/meta/instagram/callback';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function instagramOAuthFailure(error: unknown): InstagramConnectionIssue {
  if (!(error instanceof SocialError)) return 'connection_failed';
  if (error.status === 403) return 'owner_required';
  return instagramConnectionIssue(error.code);
}
export async function beginInstagramOAuth(companyId: string, brokerId: string, redirectUri: string) {
  await requireSocialOwner(companyId, brokerId);
  if (!instagramAvailable() || !socialTokenProtectionAvailable() || !(process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN)) throw new SocialError('A conexão direta do Instagram ainda precisa ser habilitada pela ImobFlow.', 503, 'instagram_unavailable');
  const state = randomBytes(32).toString('hex');
  await db('social_oauth_requests', { method: 'POST', body: { state_hash: hash(state), company_id: companyId, broker_id: brokerId, channel: 'instagram', login_provider: 'instagram', redirect_uri: redirectUri, expires_at: new Date(Date.now() + 600000).toISOString() } });
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.search = new URLSearchParams({ client_id: process.env.META_INSTAGRAM_APP_ID!, redirect_uri: redirectUri, response_type: 'code', scope: INSTAGRAM_SCOPES.join(','), state, force_reauth: 'true', enable_fb_login: 'false' }).toString();
  return { state, url: url.href };
}
export async function finishInstagramOAuth(state: string, cookie: string | undefined, code: string) {
  if (!/^[a-f\d]{64}$/.test(state) || state !== cookie || code.length < 10 || code.length > 4096) throw new SocialError('A conexão expirou. Inicie novamente pelo painel.', 422, 'oauth_expired');
  const [record] = await db<Array<{ company_id: string; broker_id: string; redirect_uri: string }>>(`social_oauth_requests?state_hash=eq.${hash(state)}&login_provider=eq.instagram&channel=eq.instagram&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!record) throw new SocialError('A conexão expirou. Inicie novamente pelo painel.', 422, 'oauth_expired');
  await requireSocialOwner(record.company_id, record.broker_id);
  const account = await instagramExchange(code, record.redirect_uri);
  const owners = await db<Array<{ company_id: string }>>(`social_accounts?channel=eq.instagram&account_id=eq.${account.accountId}&select=company_id`);
  if (owners.some(row => row.company_id !== record.company_id)) throw new SocialError('Este Instagram já está vinculado a outra imobiliária.', 409, 'account_bound');
  const active = await db<Array<{ account_id: string; login_provider: string }>>(`social_accounts?company_id=eq.${record.company_id}&channel=eq.instagram&enabled=eq.true&select=account_id,login_provider`);
  if (active.some(row => row.account_id !== account.accountId || row.login_provider !== 'instagram')) throw new SocialError('Desconecte o Instagram atual antes de conectar outra conta.', 409, 'account_disconnect_required');
  await requireSocialOwner(record.company_id, record.broker_id);
  await instagramSubscribe(account.accountId, account.token);
  await db('rpc/bind_instagram_account', { method: 'POST', body: { p_company_id: record.company_id, p_actor_id: record.broker_id, p_account_id: account.accountId, p_name: account.username, p_token: encryptSocialToken(account.token, record.company_id), p_api_version: INSTAGRAM_VERSION, p_expires_at: account.expiresAt } });
}
