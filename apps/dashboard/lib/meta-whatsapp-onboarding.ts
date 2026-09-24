// Server-only Graph API calls. Provider bodies and credentials must never reach UI errors.
export const META_GRAPH_VERSION = 'v26.0';
export const META_PHONE_ID = /^\d{5,30}$/;

export class WhatsAppSetupError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) {
    super(message);
  }
}

type GraphPayload = { error?: { code?: number }; [key: string]: unknown };

async function graph(url: URL, options: RequestInit, stage: string, message: string): Promise<GraphPayload> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
  } catch {
    throw new WhatsAppSetupError('meta_unavailable', 'A Meta não respondeu a tempo. Aguarde um momento e tente novamente.', 502);
  }
  let payload: GraphPayload;
  try { payload = await response.json() as GraphPayload; }
  catch { throw new WhatsAppSetupError('meta_unavailable', 'A Meta retornou uma resposta inesperada. Tente novamente.', 502); }
  if (!payload || typeof payload !== 'object') throw new WhatsAppSetupError('meta_unavailable', 'A Meta retornou uma resposta inesperada. Tente novamente.', 502);
  if (!response.ok || payload.error) {
    if (payload.error?.code === 190) throw new WhatsAppSetupError('authorization_expired', 'A autorização expirou ou foi revogada. Conecte novamente com a Meta ou substitua o token.');
    if (response.status === 429 || [4, 17, 32, 613].includes(payload.error?.code || 0)) throw new WhatsAppSetupError('meta_rate_limit', 'A Meta limitou as tentativas. Aguarde alguns minutos antes de tentar novamente.', 429);
    throw new WhatsAppSetupError(stage, message);
  }
  return payload;
}

function graphUrl(path: string, version = META_GRAPH_VERSION) {
  if (!/^v\d+\.\d+$/.test(version)) throw new WhatsAppSetupError('invalid_version', 'Versão da API inválida.', 400);
  return new URL(`https://graph.facebook.com/${version}/${path}`);
}

function bearer(accessToken: string) { return { Authorization: `Bearer ${accessToken}` }; }

export async function verifyMetaPhone(phoneNumberId: string, accessToken: string, version = META_GRAPH_VERSION) {
  if (!META_PHONE_ID.test(phoneNumberId)) throw new WhatsAppSetupError('invalid_phone', 'Informe a identificação do número fornecida pela Meta.', 400);
  const url = graphUrl(phoneNumberId, version);
  url.searchParams.set('fields', 'id,display_phone_number,verified_name,is_on_biz_app');
  const phone = await graph(url, { headers: bearer(accessToken) }, 'phone_access_denied', 'O token não tem acesso a esse número. Confira o ID e as permissões da conta WhatsApp na Meta.');
  if (phone.id !== phoneNumberId || typeof phone.display_phone_number !== 'string' || !phone.display_phone_number.trim()) {
    throw new WhatsAppSetupError('phone_mismatch', 'A Meta não confirmou esse número WhatsApp. Confira a identificação do número.');
  }
  return { displayPhoneNumber: phone.display_phone_number.slice(0, 60), verifiedName: typeof phone.verified_name === 'string' ? phone.verified_name.slice(0, 160) : null, verifiedAt: new Date().toISOString(), businessAppConnected: typeof phone.is_on_biz_app === 'boolean' ? phone.is_on_biz_app : null };
}

export async function exchangeMetaSignupCode(code: string, appId: string, appSecret: string) {
  const url = graphUrl('oauth/access_token');
  url.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, code }).toString();
  const token = await graph(url, {}, 'authorization_failed', 'A autorização da Meta não pôde ser concluída. Abra a conexão novamente e permita o acesso à conta WhatsApp.');
  if (typeof token.access_token !== 'string' || !token.access_token.trim()) throw new WhatsAppSetupError('authorization_failed', 'A Meta não forneceu uma autorização válida. Conecte novamente.');
  return token.access_token;
}

export async function verifyMetaBusinessPhone(wabaId: string, phoneNumberId: string, accessToken: string) {
  if (!META_PHONE_ID.test(wabaId) || !META_PHONE_ID.test(phoneNumberId)) throw new WhatsAppSetupError('invalid_phone', 'A Meta não retornou os dados do número escolhido.', 400);
  let after = '';
  for (let page = 0; page < 10; page++) {
    const url = graphUrl(`${wabaId}/phone_numbers`);
    url.search = new URLSearchParams({ fields: 'id', limit: '100', ...(after ? { after } : {}) }).toString();
    const payload = await graph(url, { headers: bearer(accessToken) }, 'business_access_denied', 'A autorização não dá acesso à conta WhatsApp escolhida. Entre com o administrador dessa conta e tente novamente.');
    if (Array.isArray(payload.data) && payload.data.some(phone => phone && typeof phone === 'object' && phone.id === phoneNumberId)) return;
    const paging = payload.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
    const nextCursor = paging?.cursors?.after;
    if (!paging?.next || typeof nextCursor !== 'string' || !nextCursor || nextCursor === after || nextCursor.length > 2000) break;
    // Rebuild a fixed Graph URL; never fetch a URL supplied in a provider response.
    after = nextCursor;
  }
  throw new WhatsAppSetupError('phone_business_mismatch', 'O número escolhido não pertence à conta WhatsApp autorizada. Faça a conexão novamente e escolha a conta correta.');
}

export async function activateMetaBusinessPhone(wabaId: string, phoneNumberId: string, accessToken: string, pin: string, businessAppConnected = false) {
  // Coexistence numbers are already registered by Embedded Signup.
  if (!businessAppConnected) {
  if (!/^\d{6}$/.test(pin)) throw new WhatsAppSetupError('invalid_pin', 'Informe um PIN de proteção com 6 dígitos.', 400);
  const registration = await graph(graphUrl(`${phoneNumberId}/register`), {
    method: 'POST', headers: { ...bearer(accessToken), 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  }, 'registration_failed', 'Não foi possível ativar o número. Confira o PIN de proteção e conclua as pendências do número no Gerenciador do WhatsApp da Meta.');
  if (registration.success !== true) throw new WhatsAppSetupError('registration_failed', 'A Meta não confirmou a ativação do número. Confira o número no Gerenciador do WhatsApp.');
  }
  const subscription = await graph(graphUrl(`${wabaId}/subscribed_apps`), { method: 'POST', headers: bearer(accessToken) }, 'subscription_failed', 'O número foi autorizado, mas o recebimento não foi ativado. Peça ao suporte para revisar o webhook do aplicativo Meta e tente conectar novamente.');
  if (subscription.success !== true) throw new WhatsAppSetupError('subscription_failed', 'A Meta não confirmou o recebimento de mensagens. Peça ao suporte para revisar o webhook.');
}

export async function subscribeMetaBusinessWebhook(wabaId: string, phoneNumberId: string, accessToken: string, version = META_GRAPH_VERSION) {
  await verifyMetaBusinessPhone(wabaId, phoneNumberId, accessToken);
  const subscription = await graph(graphUrl(`${wabaId}/subscribed_apps`, version), { method: 'POST', headers: bearer(accessToken) }, 'subscription_failed', 'O token foi aceito, mas o recebimento de mensagens não foi ativado na Meta. Confira o ID da conta WhatsApp Business e as permissões do token.');
  if (subscription.success !== true) throw new WhatsAppSetupError('subscription_failed', 'A Meta não confirmou a ativação do recebimento de mensagens. Confira o ID da conta WhatsApp Business.');
}

export function publicWhatsAppSetupError(error: unknown) {
  return error instanceof WhatsAppSetupError ? { error: error.message, code: error.code, status: error.status }
    : { error: 'Não foi possível salvar a conexão. Tente novamente; se persistir, peça ao suporte para verificar a configuração.', code: 'connection_save_failed', status: 503 };
}
