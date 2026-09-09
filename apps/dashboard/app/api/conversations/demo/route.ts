import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { hasSameOrigin, hasSafeRequestSize } from '@/lib/request-security';
import { listSharedDemoThreads, saveSharedDemoAction } from '@/lib/shared-demo-conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  try {
    return NextResponse.json({ data: await listSharedDemoThreads() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('demo_sync_failed', error);
    return NextResponse.json({ error: 'Não foi possível sincronizar a demonstração.' }, { status: 503 });
  }
});

export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!hasSafeRequestSize(request, 20_000)) return NextResponse.json({ error: 'Mensagem muito grande.' }, { status: 413 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const contactId = typeof body.contactId === 'string' ? body.contactId : '';
    const content = typeof body.content === 'string' ? body.content.trim() : undefined;
    const messageId = typeof body.messageId === 'string' ? body.messageId : undefined;
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : undefined;
    if (!/^example-[a-z-]{1,40}$/.test(contactId) || !['claim','message'].includes(String(body.action))
      || (body.action === 'message' && (!content || content.length > 4000 || !/^[0-9a-f-]{36}$/i.test(messageId || '')))
      || (propertyId && !/^[0-9a-f-]{36}$/i.test(propertyId))) {
      return NextResponse.json({ error: 'Dados do atendimento inválidos.' }, { status: 400 });
    }
    const data = await saveSharedDemoAction({ contactId, ...(body.action === 'message' ? { content, messageId, propertyId } : {}) });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('demo_save_failed', error);
    return NextResponse.json({ error: 'Não foi possível salvar o atendimento de demonstração. Tente novamente.' }, { status: 503 });
  }
});
