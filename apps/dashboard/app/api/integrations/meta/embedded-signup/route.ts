import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount, requireCompanyId } from '@/lib/tenant-context';
import { hasSameOrigin } from '@/lib/request-security';
import { assertMetaWhatsAppPhoneAvailable, saveMetaWhatsAppConnection } from '@/lib/meta-whatsapp-connections';
import { META_GRAPH_VERSION, META_PHONE_ID, WhatsAppSetupError, activateMetaBusinessPhone, discoverMetaBusinessPhone, exchangeMetaSignupCode, publicWhatsAppSetupError, verifyMetaBusinessPhone, verifyMetaPhone } from '@/lib/meta-whatsapp-onboarding';

export const runtime = 'nodejs';
export const maxDuration = 60;
const noStore = { 'Cache-Control': 'no-store' };

function publicConfiguration() {
  const appId = process.env.META_APP_ID?.trim() || '';
  const configId = process.env.META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim() || '';
  const loginConfigured = /^\d+$/.test(appId) && /^\d+$/.test(configId) && Boolean(process.env.META_APP_SECRET?.trim());
  const webhookConfigured = Boolean(process.env.META_APP_SECRET?.trim() && process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim());
  return { appId, configId, available: loginConfigured && webhookConfigured, loginConfigured, webhookConfigured, apiVersion: META_GRAPH_VERSION };
}

export const GET = protectedRoute(async () => {
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode conectar o WhatsApp.' }, { status: 403 });
  return NextResponse.json({ data: publicConfiguration() }, { headers: noStore });
});

export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode conectar o WhatsApp.' }, { status: 403 });
  const { appId, available } = publicConfiguration();
  if (!available) return NextResponse.json({ error: 'A conexão pela Meta ainda não está habilitada neste ImobFlow. Use a configuração manual ou peça ao suporte para habilitá-la.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { code?: unknown; phoneNumberId?: unknown; wabaId?: unknown; pin?: unknown; businessAppOnboarding?: unknown } | null;
  if (!body || typeof body.code !== 'string' || body.code.length < 20 || body.code.length > 4096 ||
      (body.phoneNumberId === undefined ? body.businessAppOnboarding !== true : typeof body.phoneNumberId !== 'string' || !META_PHONE_ID.test(body.phoneNumberId)) ||
      (body.businessAppOnboarding !== undefined && typeof body.businessAppOnboarding !== 'boolean') ||
      typeof body.wabaId !== 'string' || !META_PHONE_ID.test(body.wabaId) || (body.pin !== undefined && body.pin !== '' && (typeof body.pin !== 'string' || !/^\d{6}$/.test(body.pin)))) {
    return NextResponse.json({ error: 'Confira o PIN de 6 dígitos e conclua a seleção do número na Meta.' }, { status: 400 });
  }
  try {
    const companyId = requireCompanyId();
    const suppliedPhoneId = typeof body.phoneNumberId === 'string' ? body.phoneNumberId : undefined;
    if (suppliedPhoneId) await assertMetaWhatsAppPhoneAvailable(companyId, suppliedPhoneId);
    const accessToken = await exchangeMetaSignupCode(body.code, appId, process.env.META_APP_SECRET!.trim());
    const phoneNumberId = suppliedPhoneId || await discoverMetaBusinessPhone(body.wabaId, accessToken);
    if (suppliedPhoneId) await verifyMetaBusinessPhone(body.wabaId, phoneNumberId, accessToken);
    else await assertMetaWhatsAppPhoneAvailable(companyId, phoneNumberId);
    const verification = await verifyMetaPhone(phoneNumberId, accessToken);
    if (body.businessAppOnboarding === true && verification.businessAppConnected !== true) {
      throw new WhatsAppSetupError('coexistence_not_confirmed', 'A Meta ainda não confirmou a conexão com o WhatsApp Business do celular. Nenhum registro foi alterado. Peça ao suporte para conferir essa autorização.');
    }
    // Only Meta's server response can authorize bypassing registration/PIN.
    await activateMetaBusinessPhone(body.wabaId, phoneNumberId, accessToken, typeof body.pin === 'string' ? body.pin : '', verification.businessAppConnected === true);
    await saveMetaWhatsAppConnection(companyId, { phoneNumberId, accessToken, apiVersion: META_GRAPH_VERSION, enabled: true });
    return NextResponse.json({ ok: true, data: { configured: true, phoneNumberId, apiVersion: META_GRAPH_VERSION, enabled: true, hasAccessToken: true, verification: 'verified', ...verification, messageTestRequired: true } }, { headers: noStore });
  } catch (error) {
    const failure = publicWhatsAppSetupError(error);
    console.error('meta_embedded_signup_failed', failure.code);
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: noStore });
  }
});
