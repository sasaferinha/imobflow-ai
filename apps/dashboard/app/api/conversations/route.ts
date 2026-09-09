import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createConversationMessage, listConversationMessages } from '@/lib/conversations';
import { hasSameOrigin } from '@/lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json({ data: await listConversationMessages() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('conversation_list_failed', error);
    return NextResponse.json({ error: 'Não foi possível carregar as conversas.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const leadId = typeof body.leadId === 'string' ? body.leadId : '';
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : '';
    const images = Array.isArray(body.images) ? body.images.filter((item): item is string => typeof item === 'string').slice(0, 5) : [];
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null;
    if (!/^[0-9a-f-]{36}$/i.test(leadId) || !content) return NextResponse.json({ error: 'Mensagem inválida.' }, { status: 400 });
    return NextResponse.json({ data: await createConversationMessage({ leadId, content, images, propertyId }) }, { status: 201 });
  } catch (error) {
    console.error('conversation_create_failed', error);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('não encontrado nesta imobiliária') || message.includes('não está mais disponível')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível salvar a mensagem.' }, { status: 500 });
  }
}
