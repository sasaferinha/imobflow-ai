import { after, NextRequest, NextResponse } from 'next/server';
import { verifyMetaWebhookSignature, verifyMetaWebhookToken } from '@/lib/meta-whatsapp';
import { parseSocialEvents, saveSocialEvent } from '@/lib/meta-social';
import { activeSocialConnections } from '@/lib/social-connections';
import { socialId, socialObject } from '@/lib/social-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Instagram Login uses its own app secret, never the Facebook app fallback. */
export async function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  const verifyToken = process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN || '';
  if (request.nextUrl.searchParams.get('hub.mode') !== 'subscribe' || !challenge || challenge.length > 4096
    || !verifyMetaWebhookToken(request.nextUrl.searchParams.get('hub.verify_token'), verifyToken)) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(challenge, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 262144) return NextResponse.json({ error: 'Payload muito grande.' }, { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 262144) return NextResponse.json({ error: 'Payload muito grande.' }, { status: 413 });
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'), process.env.META_INSTAGRAM_APP_SECRET || '')) return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
  // A correctly signed Page notification still cannot enter Instagram's inbox.
  if (socialObject(payload).object !== 'instagram') return NextResponse.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const entries = socialObject(payload).entry;
    const accountIds = Array.isArray(entries) ? entries.map(entry => socialId(socialObject(entry).id)).filter(Boolean) : [];
    const connections = (await activeSocialConnections({ accountIds })).filter(connection => connection.loginProvider === 'instagram' && connection.channel === 'instagram');
    const events = parseSocialEvents(payload, connections);
    const deadline = Date.now() + 45000;
    for (const event of events) {
      if (Date.now() > deadline) throw Error('deadline');
      const result = await saveSocialEvent(event);
      if ('saved' in result && result.saved && result.companyId && result.messageId) {
        const input = { companyId: result.companyId, threadId: result.threadId, leadId: result.leadId, messageId: result.messageId };
        after(async () => { try { const { processSocialAI } = await import('@/lib/social-ai'); await processSocialAI(input); } catch { console.error('social_ai_processing_failed'); } });
      }
    }
    return NextResponse.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('instagram_login_webhook_failed');
    return NextResponse.json({ error: 'Não foi possível confirmar todos os eventos. Reenvie o webhook.' }, { status: 503 });
  }
}
