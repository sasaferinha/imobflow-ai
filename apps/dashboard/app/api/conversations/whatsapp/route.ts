import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount, requireCompanyId } from '@/lib/tenant-context';
import { hasSameOrigin } from '@/lib/request-security';
import { loadMetaWhatsAppConnectionForCompany, saveMetaWhatsAppConnection, disconnectMetaWhatsAppConnection } from '@/lib/meta-whatsapp-connections';
import { META_GRAPH_VERSION, META_PHONE_ID, publicWhatsAppSetupError, subscribeMetaBusinessWebhook, verifyMetaPhone } from '@/lib/meta-whatsapp-onboarding';

const noStore = { 'Cache-Control': 'no-store' };

export const GET = protectedRoute(async (request: NextRequest) => {
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode ver a configuração do WhatsApp.' }, { status: 403 });
  try {
    const [connection] = await loadMetaWhatsAppConnectionForCompany(requireCompanyId());
    const data = {
      configured: Boolean(connection?.accessToken), phoneNumberId: connection?.phoneNumberId || '', apiVersion: connection?.apiVersion || META_GRAPH_VERSION,
      enabled: connection?.enabled || false, hasAccessToken: Boolean(connection?.accessToken), verification: 'unchecked',
    };
    if (request.nextUrl.searchParams.get('verify') === '1' && connection?.accessToken) {
      try {
        const verification = await verifyMetaPhone(connection.phoneNumberId, connection.accessToken, connection.apiVersion);
        return NextResponse.json({ data: { ...data, ...verification, verification: 'verified' } }, { headers: noStore });
      } catch (error) {
        const failure = publicWhatsAppSetupError(error);
        return NextResponse.json({ data: { ...data, verification: 'failed', verificationError: failure.error } }, { headers: noStore });
      }
    }
    return NextResponse.json({ data }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const category = /WHATSAPP_META_CONNECTIONS|Conexão WhatsApp inválida/.test(message) ? 'environment_configuration'
      : /mais de uma empresa/.test(message) ? 'ownership_conflict'
      : /timeout|aborted/i.test(message) ? 'timeout' : 'configuration_store';
    console.error('whatsapp_configuration_load_failed', { category });
    return NextResponse.json({ error: 'Não foi possível carregar o WhatsApp da empresa. Tente atualizar a configuração.' }, { status: 503, headers: noStore });
  }
});

export const DELETE = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode desvincular o WhatsApp.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { confirm?: unknown; phoneNumberId?: unknown } | null;
  if (body?.confirm !== true || typeof body.phoneNumberId !== 'string' || !META_PHONE_ID.test(body.phoneNumberId)) return NextResponse.json({ error: 'Confirme o número que deseja desvincular.' }, { status: 400 });
  try {
    await disconnectMetaWhatsAppConnection(requireCompanyId(), body.phoneNumberId);
    return NextResponse.json({ data: { configured: false, phoneNumberId: '', apiVersion: META_GRAPH_VERSION, enabled: false, hasAccessToken: false, verification: 'unchecked' } }, { headers: noStore });
  } catch (error) {
    const changed = error instanceof Error && error.message.includes('connection_changed');
    return NextResponse.json({ error: changed ? 'A conexão mudou. Atualize a página antes de desvincular.' : 'Não foi possível confirmar a desvinculação. Atualize a configuração.' }, { status: changed ? 409 : 503, headers: noStore });
  }
});

export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode alterar o WhatsApp.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { phoneNumberId?: unknown; accessToken?: unknown; apiVersion?: unknown; enabled?: unknown; wabaId?: unknown } | null;
  const phoneNumberId = typeof body?.phoneNumberId === 'string' ? body.phoneNumberId.trim() : '';
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  const wabaId = typeof body?.wabaId === 'string' ? body.wabaId.trim() : '';
  const apiVersion = typeof body?.apiVersion === 'string' ? body.apiVersion.trim() : META_GRAPH_VERSION;
  if (!META_PHONE_ID.test(phoneNumberId) || (wabaId && !META_PHONE_ID.test(wabaId)) || accessToken.length < 10 || accessToken.length > 4096 || !/^v\d+\.\d+$/.test(apiVersion) || (body?.enabled !== undefined && typeof body.enabled !== 'boolean')) {
    return NextResponse.json({ error: 'Revise a identificação do número, o token e a versão da API.' }, { status: 400 });
  }
  try {
    const verification = await verifyMetaPhone(phoneNumberId, accessToken, apiVersion);
    if (wabaId) await subscribeMetaBusinessWebhook(wabaId, phoneNumberId, accessToken, apiVersion);
    const enabled = body?.enabled !== false;
    await saveMetaWhatsAppConnection(requireCompanyId(), { phoneNumberId, accessToken, apiVersion, enabled });
    return NextResponse.json({ ok: true, data: { configured: true, phoneNumberId, apiVersion, enabled, hasAccessToken: true, verification: 'verified', ...verification, messageTestRequired: true } }, { headers: noStore });
  } catch (error) {
    const failure = publicWhatsAppSetupError(error);
    return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: noStore });
  }
});
