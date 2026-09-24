import { after, NextRequest, NextResponse } from 'next/server';
import {
  configuredMetaWhatsAppConnections,
  parseIncomingWhatsAppMessages,
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
} from '@/lib/meta-whatsapp';
import { saveIncomingWhatsAppMessage } from '@/lib/meta-whatsapp-store';
import { attendanceFailureDiagnostic, requestAttendanceSuggestion } from '@/lib/n8n-attendance';

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
    console.info('meta_whatsapp_webhook_matched', { matchedCount: messages.length });
    let savedCount = 0;
    for (const message of messages) {
      const saved = await saveIncomingWhatsAppMessage(message);
      if (saved.saved) {
        savedCount += 1;
        after(async () => {
          try {
            const result = await requestAttendanceSuggestion(saved);
            console.info('n8n_attendance_result', {
              requested: result.requested, sent: 'sent' in result && result.sent === true,
              afterHours: 'afterHours' in result && result.afterHours === true, reason: result.reason,
            });
          } catch (error) {
            console.error('n8n_attendance_delivery_failed', attendanceFailureDiagnostic(error));
          }
        });
      }
    }
    console.info('meta_whatsapp_webhook_saved', { matchedCount: messages.length, savedCount, duplicateCount: messages.length - savedCount });
    return NextResponse.json({ received: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('meta_whatsapp_webhook_processing_failed');
    return NextResponse.json({ error: 'Não foi possível processar o webhook.' }, { status: 500 });
  }
}
