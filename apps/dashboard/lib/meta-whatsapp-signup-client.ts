export type FacebookSdk = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void;
};

export type SignupAssets = { phoneNumberId: string; wabaId: string };

export function parseMetaSignupEvent(event: Pick<MessageEvent, 'origin' | 'data'>):
  | { event: 'finish'; assets: SignupAssets }
  | { event: 'cancel' | 'error' }
  | null {
  if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return null;
  try {
    const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (!message || message.type !== 'WA_EMBEDDED_SIGNUP') return null;
    if (message.event === 'CANCEL') return { event: 'cancel' };
    if (message.event === 'ERROR') return { event: 'error' };
    if (!['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(message.event)) return null;
    const phoneNumberId = message.data?.phone_number_id;
    const wabaId = message.data?.waba_id;
    if (typeof phoneNumberId !== 'string' || !/^\d{5,30}$/.test(phoneNumberId) || typeof wabaId !== 'string' || !/^\d{5,30}$/.test(wabaId)) return { event: 'error' };
    return { event: 'finish', assets: { phoneNumberId, wabaId } };
  } catch { return null; }
}

// Login must run directly from the click; awaiting SDK loading here would block the popup.
export function beginMetaSignup(sdk: FacebookSdk, configId: string, callbacks: {
  complete: (data: SignupAssets & { code: string }) => void;
  error: (message: string) => void;
}, coexistence = false) {
  let code = '';
  let assets: SignupAssets | null = null;
  let active = true;
  const cleanup = () => {
    active = false;
    window.removeEventListener('message', listener);
    clearTimeout(timeout);
  };
  const fail = (message: string) => { if (active) { cleanup(); callbacks.error(message); } };
  const complete = () => {
    if (!active || !code || !assets) return;
    const result = { ...assets, code };
    cleanup();
    callbacks.complete(result);
  };
  const listener = (event: MessageEvent) => {
    if (!active) return;
    const message = parseMetaSignupEvent(event);
    if (message?.event === 'finish') { assets = message.assets; complete(); }
    if (message?.event === 'cancel') fail('Conexão cancelada. Você pode começar novamente quando quiser.');
    if (message?.event === 'error') fail('A Meta não concluiu a seleção do número. Confira o acesso de administrador e tente novamente.');
  };
  const timeout = setTimeout(() => fail('A conexão não foi concluída. Feche a janela da Meta e tente novamente; permita pop-ups para este site.'), 300000);
  window.addEventListener('message', listener);
  try {
    sdk.login(response => {
      if (!active) return;
      code = response.authResponse?.code || '';
      if (!code) { fail('A autorização não foi concluída. Permita pop-ups e confirme as permissões na janela da Meta.'); return; }
      complete();
    }, { config_id: configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: '3', ...(coexistence ? { featureType: 'whatsapp_business_app_onboarding' } : {}) } });
  } catch { fail('Não foi possível abrir a Meta. Permita pop-ups para este site e tente novamente.'); }
  return cleanup;
}
