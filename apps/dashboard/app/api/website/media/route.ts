import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit, hasSafeRequestSize, hasSameOrigin } from '@/lib/request-security';
import { requireWebsiteActor } from '@/lib/website/auth';
import { storeWebsiteImage } from '@/lib/website/media';
import { WebsiteError } from '@/lib/website/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY = 2_850_000;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get('origin') || !hasSameOrigin(request)) throw new WebsiteError('Origem não permitida.', 403);
    if (!hasSafeRequestSize(request, MAX_BODY)) throw new WebsiteError('A imagem deve ter até 2 MB.', 413);
    const actor = await requireWebsiteActor(request);
    if (!await consumeRateLimit(request, `website-image:${actor.companyId}:${actor.id}`, 30, 3600)) throw new WebsiteError('Limite de imagens atingido. Tente novamente mais tarde.', 429);
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) throw new WebsiteError('A imagem deve ter até 2 MB.', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new WebsiteError('Arquivo inválido.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('dataUrl' in body)) throw new WebsiteError('Arquivo inválido.');
    return NextResponse.json({ url: await storeWebsiteImage(actor.companyId, body.dataUrl) }, { headers });
  } catch (error) {
    const expected = error instanceof WebsiteError;
    if (!expected) console.error('website_image_upload_failed');
    return NextResponse.json({ error: expected ? error.message : 'Não foi possível enviar a imagem.' }, { status: expected ? error.status : 503, headers });
  }
}
