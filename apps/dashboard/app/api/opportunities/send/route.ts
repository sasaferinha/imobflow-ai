import { after, NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { hasSameOrigin } from '@/lib/request-security';
import { propertyWhatsAppContext, queuePropertyOffer, sendPropertyOffer, propertyOfferStatus, propertyOfferError } from '@/lib/property-whatsapp';
export const runtime = 'nodejs';
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GET = protectedRoute(async (request: NextRequest) => {
  try {
    const requestId = request.nextUrl.searchParams.get('requestId');
    if (requestId && uuid.test(requestId)) return NextResponse.json({ data: await propertyOfferStatus(requestId) });
    const id = request.nextUrl.searchParams.get('opportunityId') || '';
    if (!uuid.test(id)) return NextResponse.json({ error: 'Oportunidade inválida.' }, { status: 400 });
    const context = await propertyWhatsAppContext(id);
    return NextResponse.json({ data: { recipient: context.recipient, phone: context.phone, sender: 'WhatsApp conectado da imobiliária' } });
  } catch (error) { return NextResponse.json({ error: propertyOfferError(error) }, { status: 409 }); }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 20000) return NextResponse.json({ error: 'Solicitação muito grande.' }, { status: 413 });
    const body = JSON.parse(text);
    if (!body || body.confirmed !== true || !uuid.test(body.opportunityId || '') || !uuid.test(body.requestId || '') || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 4000 || !Array.isArray(body.images) || body.images.length > 5 || body.images.some((image: unknown) => typeof image !== 'string' || image.length > 2000)) return NextResponse.json({ error: 'Confira o texto e as fotos antes de confirmar.' }, { status: 400 });
    const batch = await queuePropertyOffer(body);
    after(() => sendPropertyOffer(batch.companyId, batch.ids));
    return NextResponse.json({ data: { requestId: body.requestId, count: batch.ids.length } }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: propertyOfferError(error) }, { status: 409 }); }
});
