import { after, NextRequest, NextResponse } from 'next/server';
import {
  configuredMetaWhatsAppConnections,
  parseIncomingWhatsAppMessages,
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
} from '@/lib/meta-whatsapp';
import { saveIncomingWhatsAppMessage } from '@/lib/meta-whatsapp-store';
import { respondToIncomingMessage } from '@/lib/attendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 512 * 1024;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  if (mode !== 'subscribe' || !challenge || !verifyMetaWebhookToken(token)) {
    return new NextResponse('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: 'Payload muito grande.' }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: 'Payload muito grande.' }, { status: 413 });
  if (!verifyMetaWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    console.warn('meta_whatsapp_webhook_signature_invalid');
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  try {
    const messages = parseIncomingWhatsAppMessages(payload, configuredMetaWhatsAppConnections());
    for (const message of messages) {
      const saved = await saveIncomingWhatsAppMessage(message);
      if (saved.saved) after(async () => {
        try { await respondToIncomingMessage(saved); }
        catch { console.error('attendance_delivery_failed'); }
      });
    }
    return NextResponse.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('meta_whatsapp_webhook_processing_failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Não foi possível processar o webhook.' }, { status: 500 });
  }
}
