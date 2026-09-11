import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createConversationMessage, listConversationMessages } from '@/lib/conversations';
import { hasSameOrigin } from '@/lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json({ data: await listConversationMessages() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('conversation_list_failed');
    return NextResponse.json({ error: 'Não foi possível carregar as conversas.' }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const leadId = typeof body.leadId === 'string' ? body.leadId : '';
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : '';
    const images = Array.isArray(body.images) ? body.images.filter((item): item is string => typeof item === 'string').slice(0, 5) : [];
    const propertyId = typeof body.propertyId === 'string' ? body.propertyId : null;
    const requestId=typeof body.requestId==='string'?body.requestId:'';
    if(!/^[0-9a-f-]{36}$/i.test(requestId))return NextResponse.json({error:'Identificador de envio inválido.'},{status:400});
    if (!/^[0-9a-f-]{36}$/i.test(leadId) || !content) return NextResponse.json({ error: 'Mensagem inválida.' }, { status: 400 });
    const templateName=typeof body.templateName==='string'&&/^[a-z0-9_]{1,100}$/.test(body.templateName)?body.templateName:undefined;
    return NextResponse.json({ data: await createConversationMessage({ leadId, content, images, propertyId, requestId, templateName }) }, { status: 201 });
  } catch (error) {
    console.error('conversation_create_failed');
    const message = error instanceof Error ? error.message : '';
    if(message.includes('claim_required'))return NextResponse.json({error:'Assuma o atendimento antes de enviar.'},{status:409});
    if(message.includes('template_required'))return NextResponse.json({error:'Fora da janela de 24 horas. Configure um modelo aprovado pela Meta.'},{status:409});
    if (message.includes('não encontrado nesta imobiliária') || message.includes('não está mais disponível')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível salvar a mensagem.' }, { status: 500 });
  }
}

export const GET = protectedRoute(handleGET);
export const POST = protectedRoute(handlePOST);
