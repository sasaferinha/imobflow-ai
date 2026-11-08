import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { supabaseServiceRequest as db } from './supabase';
import { SocialError, socialId, socialObject, type SocialChannel, type SocialMode } from './social-model';
import { socialConnections, type SocialConnection } from './meta-social';

export const SOCIAL_COOKIE = 'imobflow_meta_social_state';
export const SOCIAL_VERSION = 'v26.0';
export type SocialAccountRow = { id: string; company_id: string; channel: SocialChannel; account_id: string; page_id: string; name: string; enabled: boolean; token_ciphertext: string | null; api_version: string; default_mode: SocialMode };
type Authorization = { company_id: string; broker_id: string; token_ciphertext: string; expires_at: string | null };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function key() {
  const explicit = process.env.META_SOCIAL_TOKEN_ENCRYPTION_KEY;
  if (explicit) { if (!/^[a-f\d]{64}$/i.test(explicit)) throw new SocialError('A proteção da conexão Meta precisa ser configurada.', 503); return Buffer.from(explicit, 'hex'); }
  if (!process.env.META_APP_SECRET) throw new SocialError('A integração Meta ainda não está configurada.', 503);
  return createHash('sha256').update('imobflow/social/token/v1\0' + process.env.META_APP_SECRET).digest();
}
export function encryptSocialToken(token: string, companyId: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(companyId));
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function decryptSocialToken(value: string, companyId: string) {
  const [version, iv, tag, data, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra) throw new SocialError('Reconecte a conta Meta.', 409, 'token_invalid');
  try { const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url')); cipher.setAAD(Buffer.from(companyId)); cipher.setAuthTag(Buffer.from(tag, 'base64url')); return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString('utf8'); }
  catch { throw new SocialError('Reconecte a conta Meta.', 409, 'token_invalid'); }
}
export function socialAvailable() { try { key(); return /^\d+$/.test(process.env.META_APP_ID || '') && Boolean(process.env.META_APP_SECRET); } catch { return false; } }
export async function socialGraph<T>(path: string, token: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${SOCIAL_VERSION}/${path}`), body = new URLSearchParams(params);
  if (token && process.env.META_APP_SECRET) body.set('appsecret_proof', createHmac('sha256', process.env.META_APP_SECRET).update(token).digest('hex'));
  if (method === 'GET') url.search = body.toString();
  let response: Response;
  try { response = await fetch(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: method === 'POST' ? body.toString() : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new SocialError('A Meta não respondeu. Tente novamente mais tarde.', 502, 'provider_unavailable'); }
  const payload = socialObject(await response.json().catch(() => null)), error = socialObject(payload.error);
  if (!response.ok || payload.error) {
    if (error.code === 190) throw new SocialError('A autorização Meta expirou. Conecte novamente.', 409, 'token_expired');
    if (response.status === 429 || [4,17,32,613].includes(Number(error.code))) throw new SocialError('A Meta limitou as solicitações. Aguarde antes de tentar novamente.', 429, 'provider_rate_limit');
    throw new SocialError('A Meta não autorizou a operação. Confira as permissões da Página e do aplicativo.', 502, 'provider_rejected');
  }
  return payload as T;
}
export async function beginSocialOAuth(companyId: string, brokerId: string, redirectUri: string) {
  if (!socialAvailable()) throw new SocialError('A conexão Meta precisa ser habilitada pela ImobFlow.', 503);
  const state = randomBytes(32).toString('hex');
  await db('social_oauth_requests', { method: 'POST', body: { state_hash: hash(state), company_id: companyId, broker_id: brokerId, redirect_uri: redirectUri, expires_at: new Date(Date.now() + 600000).toISOString() } });
  const url = new URL(`https://www.facebook.com/${SOCIAL_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: redirectUri, state, response_type: 'code', scope: 'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages,leads_retrieval' }).toString();
  return { state, url: url.href };
}
export async function finishSocialOAuth(state: string, cookie: string | undefined, code: string) {
  if (!/^[a-f\d]{64}$/.test(state) || state !== cookie || code.length < 10 || code.length > 4096) throw new SocialError('A conexão expirou. Inicie novamente pelo painel.');
  const [request] = await db<Array<{ company_id: string; broker_id: string; redirect_uri: string }>>(`social_oauth_requests?state_hash=eq.${hash(state)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!request) throw new SocialError('A conexão expirou. Inicie novamente pelo painel.');
  await requireSocialOwner(request.company_id, request.broker_id);
  const short = await socialGraph<{ access_token: string }>('oauth/access_token', '', { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: request.redirect_uri, code }, 'POST');
  if (!short.access_token) throw new SocialError('A Meta não retornou uma autorização.');
  const long = await socialGraph<{ access_token: string; expires_in?: number }>('oauth/access_token', '', { grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: short.access_token }, 'POST');
  if (!long.access_token) throw new SocialError('A Meta não retornou uma autorização.');
  await requireSocialOwner(request.company_id, request.broker_id);
  await db('social_authorizations?on_conflict=company_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { company_id: request.company_id, broker_id: request.broker_id, token_ciphertext: encryptSocialToken(long.access_token, request.company_id), expires_at: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null, updated_at: new Date().toISOString() } });
}
export async function requireSocialOwner(companyId: string, brokerId: string) {
  const owners = await db<Array<{ id: string }>>(`broker_accounts?company_id=eq.${companyId}&id=eq.${brokerId}&role=eq.owner&active=eq.true&select=id&limit=1`);
  if (!owners.length) throw new SocialError('Acesso exclusivo do administrador ativo.', 403);
}
async function authorization(companyId: string) {
  const [row] = await db<Authorization[]>(`social_authorizations?company_id=eq.${companyId}&select=company_id,broker_id,token_ciphertext,expires_at&limit=1`);
  if (!row || row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new SocialError('Conecte novamente sua conta Meta.', 409, 'authorization_missing');
  return decryptSocialToken(row.token_ciphertext, companyId);
}
type ProviderPage = { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string } };
async function pages(companyId: string): Promise<ProviderPage[]> {
  const token = await authorization(companyId), result: ProviderPage[] = []; let after = '';
  const seen = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const response = await socialGraph<{ data: ProviderPage[]; paging?: { next?: string; cursors?: { after?: string } } }>('me/accounts', token, { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100', ...(after ? { after } : {}) });
    if (!Array.isArray(response.data)) throw new SocialError('A Meta retornou uma lista incompleta.', 502);
    result.push(...response.data.filter(p => socialId(p.id)));
    if (!response.paging?.next) return result;
    after = response.paging.cursors?.after || ''; if (!after || after.length > 4096 || seen.has(after)) break; seen.add(after);
  }
  throw new SocialError('Há muitas Páginas. Peça ao suporte para revisar a seleção.', 409);
}
export async function socialConnectionStatus(companyId: string, includePages = false) {
  const accounts = await db<SocialAccountRow[]>(`social_accounts?company_id=eq.${companyId}&select=id,channel,account_id,page_id,name,enabled,default_mode&order=channel.asc`);
  const pending = await db<Array<{ expires_at: string | null }>>(`social_authorizations?company_id=eq.${companyId}&select=expires_at&limit=1`);
  return { available: socialAvailable(), webhookConfigured: Boolean(process.env.META_APP_SECRET && process.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN), authorized: Boolean(pending[0]), accounts: accounts.map(a => ({ id: a.id, channel: a.channel, accountId: a.account_id, pageId: a.page_id, name: a.name, enabled: a.enabled, defaultMode: a.default_mode })), ...(includePages ? { pages: (await pages(companyId)).map(p => ({ id: p.id, name: p.name, instagramId: p.instagram_business_account?.id || null, instagramName: p.instagram_business_account?.username || null })) } : {}) };
}
export async function selectSocialPage(companyId: string, brokerId: string, pageId: string, channels: SocialChannel[]) {
  await requireSocialOwner(companyId, brokerId);
  if (!socialId(pageId) || !channels.length || channels.some(c => !['instagram','facebook'].includes(c))) throw new SocialError('Escolha uma Página e um canal válidos.');
  const page = (await pages(companyId)).find(p => p.id === pageId);
  if (!page?.access_token) throw new SocialError('A Página não pertence à autorização conectada.', 403);
  if (channels.includes('instagram') && !socialId(page.instagram_business_account?.id)) throw new SocialError('Vincule uma conta profissional do Instagram a esta Página.');
  // Do not subscribe a Page that is already bound to another company.
  const conflicts = await db<Array<{ company_id: string }>>(`social_accounts?page_id=eq.${pageId}&select=company_id`);
  if (conflicts.some(c => c.company_id !== companyId)) throw new SocialError('Esta Página já está conectada a outra imobiliária.', 409);
  const subscription = await socialGraph<{ success: boolean }>(`${page.id}/subscribed_apps`, page.access_token, { subscribed_fields: 'messages,messaging_postbacks,message_deliveries,message_reads,leadgen' }, 'POST');
  if (subscription.success !== true) throw new SocialError('Não foi possível confirmar a inscrição dos eventos da Página.', 502);
  for (const channel of [...new Set(channels)]) {
    await db('rpc/bind_social_account', { method: 'POST', body: { p_company_id: companyId, p_actor_id: brokerId, p_channel: channel, p_account_id: channel === 'instagram' ? page.instagram_business_account!.id : page.id, p_page_id: page.id, p_name: channel === 'instagram' ? page.instagram_business_account!.username || page.name : page.name, p_token: encryptSocialToken(page.access_token, companyId), p_api_version: SOCIAL_VERSION } });
  }
}
export async function disconnectSocial(companyId: string, brokerId: string, channel: SocialChannel) {
  await db('rpc/configure_social_account', { method: 'POST', body: { p_company_id: companyId, p_actor_id: brokerId, p_channel: channel, p_action: 'disconnect', p_mode: null } });
}
export async function setSocialDefaultMode(companyId: string, brokerId: string, channel: SocialChannel, mode: SocialMode) {
  if (!['human','suggestions','automatic'].includes(mode)) throw new SocialError('Modo inválido.');
  await db('rpc/configure_social_account', { method: 'POST', body: { p_company_id: companyId, p_actor_id: brokerId, p_channel: channel, p_action: 'mode', p_mode: mode } });
}
export async function activeSocialConnections(filter: { companyId?: string; accountIds?: string[] } = {}): Promise<SocialConnection[]> {
  const ids = filter.accountIds?.filter(v => socialId(v));
  if (ids && !ids.length) return [];
  const scope = filter.companyId ? `&company_id=eq.${encodeURIComponent(filter.companyId)}` : ids ? `&or=(account_id.in.(${ids.join(',')}),page_id.in.(${ids.join(',')}))` : '';
  const saved = await db<SocialAccountRow[]>(`social_accounts?select=id,company_id,channel,account_id,page_id,name,enabled,token_ciphertext,api_version,default_mode&limit=1001${scope}`);
  if (saved.length > 1000) throw new SocialError('Limite de conexões excedido.', 503);
  const env = socialConnections().filter(c => (!filter.companyId || c.companyId === filter.companyId) && (!ids || ids.includes(c.pageId || '') || ids.includes(c.instagramId || '')));
  for (const c of env) for (const row of saved) if ((row.page_id === c.pageId || row.channel === 'instagram' && row.account_id === c.instagramId) && row.company_id !== c.companyId) throw new SocialError('Vínculo Meta ambíguo. Revise a configuração.', 503);
  const result: SocialConnection[] = saved.filter(a => a.enabled).map(a => ({ companyId: a.company_id, pageId: a.page_id, instagramId: a.channel === 'instagram' ? a.account_id : undefined, accessToken: a.token_ciphertext ? decryptSocialToken(a.token_ciphertext, a.company_id) : undefined, enabled: true, apiVersion: a.api_version, channel: a.channel, databaseId: a.id }));
  // A persisted disabled connection overrides the old environment opt-in.
  for (const c of env) {
    if (c.pageId && !saved.some(a => a.channel === 'facebook' && a.page_id === c.pageId)) result.push({ ...c, instagramId: undefined, channel: 'facebook' });
    if (c.instagramId && !saved.some(a => a.channel === 'instagram' && a.account_id === c.instagramId)) result.push({ ...c, channel: 'instagram' });
  }
  return result;
}
