import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount, requireCompanyId } from '@/lib/tenant-context';
import { consumeRateLimit, hasSameOrigin, hasSafeRequestSize } from '@/lib/request-security';
import { ADS_COOKIE, AdsError, adsAvailable, adsDashboard, beginAdsOAuth, createPausedCampaign, createPausedAdDraft, disconnectAds, listAdAccounts, listAdDrafts, listAdsPages, loadAdsConnection, selectAdAccount, updateAdCampaign } from '@/lib/meta-ads';
import { adsAttributionReport } from '@/lib/meta-ads-attribution';
export const runtime = 'nodejs';
export const maxDuration = 120;
function failure(error: unknown) { return NextResponse.json({ error: error instanceof AdsError ? error.message : 'Não foi possível acessar anúncios. Peça ao suporte para conferir a conexão e a atualização do banco.' }, { status: error instanceof AdsError ? error.status : 503 }); }
export const GET = protectedRoute(async (request: NextRequest) => {
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Acesso exclusivo do administrador.' }, { status: 403 });
  try {
    const action = request.nextUrl.searchParams.get('action');
    if(action==='attribution')return NextResponse.json(await adsAttributionReport(requireCompanyId(),currentAccount()!.brokerId,request.nextUrl.searchParams.get('since')||'',request.nextUrl.searchParams.get('until')||''));
    if (!adsAvailable()) return NextResponse.json({ available: false, connected: false });
    const connection = await loadAdsConnection(requireCompanyId());
    if (!connection) return NextResponse.json({ available: true, connected: false });
    if (action === 'accounts') return NextResponse.json({ accounts: await listAdAccounts(connection) });
    if (action === 'metrics') return NextResponse.json(await adsDashboard(connection, request.nextUrl.searchParams.get('since') || '', request.nextUrl.searchParams.get('until') || ''));
    if (action === 'pages') return NextResponse.json({pages:await listAdsPages(connection)});
    if (action === 'drafts') return NextResponse.json({drafts:await listAdDrafts(connection)});
    return NextResponse.json({ available: true, connected: true, accountId: connection.account_id, accountName: connection.account_name, currency: connection.currency, expiresAt: connection.expires_at });
  } catch (error) { return failure(error); }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (currentAccount()?.role !== 'owner' || !request.headers.get('origin') || !hasSameOrigin(request)) return NextResponse.json({ error: 'Acesso não autorizado.' }, { status: 403 });
  if (!hasSafeRequestSize(request, 8192)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
  try {
    if (!await consumeRateLimit(request, 'meta-ads-mutations', 20, 60)) return NextResponse.json({ error: 'Aguarde um minuto e tente novamente.' }, { status: 429 });
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 8192) throw new AdsError('Requisição muito grande.', 413);
    let input: { action?: string; accountId?: unknown; name?: unknown; dailyBudget?: unknown; objective?: unknown; requestId?: unknown; campaignId?: unknown; status?: unknown; confirmSpend?: unknown; pageId?: unknown; message?: unknown; title?: unknown; destinationUrl?: unknown; imageUrl?: unknown; confirmBudget?: unknown } | null;
    try { input = JSON.parse(raw); } catch { throw new AdsError('Requisição inválida.', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AdsError('Requisição inválida.', 400);
    const companyId = requireCompanyId();
    if (input?.action === 'connect') {
      const result = await beginAdsOAuth(companyId, currentAccount()!.brokerId, new URL('/api/integrations/meta/ads/callback', request.nextUrl.origin).toString());
      const response = NextResponse.json({ url: result.url });
      response.cookies.set(ADS_COOKIE, result.state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/integrations/meta/ads/callback', maxAge: 600 });
      return response;
    }
    if (input?.action === 'select-account') { await selectAdAccount(companyId, typeof input.accountId === 'string' ? input.accountId : ''); return NextResponse.json({ ok: true }); }
    if (input?.action === 'disconnect') { await disconnectAds(companyId); return NextResponse.json({ ok: true }); }
    if (input?.action === 'create-campaign') {
      const connection = await loadAdsConnection(companyId);
      if (!connection) throw new AdsError('Conecte primeiro sua conta Meta.');
      return NextResponse.json({ campaign: await createPausedCampaign(connection, input) });
    }
    if (input.action === 'update-campaign') {
      const connection = await loadAdsConnection(companyId);
      if (!connection) throw new AdsError('Conecte primeiro sua conta Meta.');
      return NextResponse.json({ campaign: await updateAdCampaign(connection, input) });
    }
    if (input.action === 'create-ad-draft') {
      const connection=await loadAdsConnection(companyId);if(!connection)throw new AdsError('Conecte primeiro sua conta Meta.');
      return NextResponse.json({draft:await createPausedAdDraft(connection,currentAccount()!.brokerId,input)},{status:201});
    }
    return NextResponse.json({ error: 'Operação inválida.' }, { status: 400 });
  } catch (error) { return failure(error); }
});
