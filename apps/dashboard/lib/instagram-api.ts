import { SocialError, socialId, socialObject } from './social-model';

export const INSTAGRAM_VERSION = 'v26.0';
export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages'];
export function instagramAvailable() {
  return /^\d+$/.test(process.env.META_INSTAGRAM_APP_ID || '') && Boolean(process.env.META_INSTAGRAM_APP_SECRET);
}
function single(value: unknown): Record<string, unknown> {
  const result = socialObject(value);
  if (!('data' in result)) return result;
  if (!Array.isArray(result.data) || result.data.length !== 1) throw new SocialError('O Instagram retornou uma resposta incompleta.', 502);
  return socialObject(result.data[0]);
}
async function request(url: URL, init: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new SocialError('O Instagram não respondeu. Tente novamente.', 502, 'provider_unavailable'); }
  const result = socialObject(await response.json().catch(() => null));
  if (!response.ok || result.error || result.error_type) {
    if (response.status === 429) throw new SocialError('Aguarde antes de tentar conectar o Instagram novamente.', 429, 'provider_rate_limit');
    throw new SocialError('O Instagram não autorizou a conexão. Confira a conta profissional e as permissões.', 502, 'provider_rejected');
  }
  return result;
}
function token(value: unknown) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 8192 || /\s/.test(value)) throw new SocialError('O Instagram não retornou uma autorização válida.', 502);
  return value;
}
export async function instagramExchange(code: string, redirectUri: string) {
  if (!instagramAvailable()) throw new SocialError('A conexão direta do Instagram ainda precisa ser habilitada pela ImobFlow.', 503, 'instagram_unavailable');
  const form = new FormData();
  for (const [key, value] of Object.entries({ client_id: process.env.META_INSTAGRAM_APP_ID!, client_secret: process.env.META_INSTAGRAM_APP_SECRET!, grant_type: 'authorization_code', redirect_uri: redirectUri, code })) form.set(key, value);
  const short = single(await request(new URL('https://api.instagram.com/oauth/access_token'), { method: 'POST', body: form }));
  const shortToken = token(short.access_token);
  if (short.permissions !== undefined) {
    const scopes = Array.isArray(short.permissions) ? short.permissions : typeof short.permissions === 'string' ? short.permissions.split(',').map(s => s.trim()) : [];
    if (!INSTAGRAM_SCOPES.every(scope => scopes.includes(scope))) throw new SocialError('Autorize o acesso às mensagens do Instagram para conectar.', 409, 'permissions_missing');
  }
  const exchangeUrl = new URL('https://graph.instagram.com/access_token');
  exchangeUrl.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: process.env.META_INSTAGRAM_APP_SECRET!, access_token: shortToken }).toString();
  // Start the validity clock before the exchange; network/profile latency
  // must never extend the provider's token lifetime.
  const issuedAt = Date.now();
  const long = single(await request(exchangeUrl));
  const accessToken = token(long.access_token), seconds = Number(long.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 61 * 86400) throw new SocialError('O Instagram não informou a validade da conexão.', 502);
  const profileUrl = new URL(`https://graph.instagram.com/${INSTAGRAM_VERSION}/me`);
  profileUrl.searchParams.set('fields', 'id,user_id,username,account_type');
  const profile = single(await request(profileUrl, { headers: { Authorization: `Bearer ${accessToken}` } }));
  const accountId = socialId(profile.user_id), scopedId = socialId(profile.id);
  // user_id from token exchange is app-scoped; /me.user_id identifies the
  // professional account in webhook events. They are different namespaces.
  if (!accountId || scopedId && short.user_id !== undefined && scopedId !== String(short.user_id)) throw new SocialError('Não foi possível confirmar a identidade do Instagram.', 502);
  if (!['BUSINESS', 'MEDIA_CREATOR'].includes(String(profile.account_type).toUpperCase())) throw new SocialError('Use uma conta profissional do Instagram (empresa ou criador).', 409, 'account_not_professional');
  if (typeof profile.username !== 'string' || !/^[a-z\d._]{1,30}$/i.test(profile.username)) throw new SocialError('O Instagram não retornou o nome da conta.', 502);
  return { token: accessToken, expiresAt: new Date(issuedAt + seconds * 1000).toISOString(), accountId, username: profile.username };
}
export async function instagramSubscribe(accountId: string, accessToken: string) {
  if (!socialId(accountId)) throw new SocialError('Conta do Instagram inválida.', 400);
  const body = new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks' });
  const result = await request(new URL(`https://graph.instagram.com/${INSTAGRAM_VERSION}/${accountId}/subscribed_apps`), { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (result.success !== true) throw new SocialError('Não foi possível ativar o recebimento de mensagens do Instagram.', 502, 'subscription_failed');
}
