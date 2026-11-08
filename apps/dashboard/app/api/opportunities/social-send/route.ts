import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { socialBody, socialFailure } from '@/lib/social-http';
import { opportunityMessageDestination } from '@/lib/lead-channel-server';
import { supabaseServiceRequest as db } from '@/lib/supabase';
import { sendSocialMessage } from '@/lib/social-messaging';
import { SocialError, socialUuid } from '@/lib/social-model';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = protectedRoute(async (request: NextRequest) => {
  const deadline = Date.now() + 45000;
  try {
    const body = await socialBody(request, ['confirmed', 'opportunityId', 'requestId', 'content', 'images'], 18000);
    if (body.confirmed !== true || !socialUuid(body.opportunityId) || !socialUuid(body.requestId) || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 2000 || !Array.isArray(body.images) || body.images.length > 5 || body.images.some((image: unknown) => typeof image !== 'string')) throw new SocialError('Confira a mensagem e as fotos.', 400);
    const destination = await opportunityMessageDestination(body.opportunityId);
    if (!destination.threadId || destination.channel === 'whatsapp') throw new SocialError('Use a conversa do canal de origem deste cliente.', 409);
    const actor = currentAccount()!;
    const [property] = await db<Array<{ images: string[] }>>(`properties?company_id=eq.${actor.companyId}&id=eq.${destination.propertyId}&select=images&limit=1`);
    if (!property || body.images.some((image: string) => !property.images.includes(image))) throw new SocialError('As fotos precisam pertencer a este imóvel.', 400);
    return NextResponse.json({ data: await sendSocialMessage({ threadId: destination.threadId, content: body.content, requestId: body.requestId, images: body.images as string[], source: 'workflow', deadline }) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return socialFailure(error);
  }
});
