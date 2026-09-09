import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { deleteAppointment, updateAppointmentStatus } from '@/lib/database';
import { hasSameOrigin } from '@/lib/request-security';

export const runtime = 'nodejs';

async function handlePATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as { status?: string };
    const status = body.status === 'Confirmada' ? 'Confirmada' : 'Aguardando';
    const data = await updateAppointmentStatus((await context.params).id, status);
    return data ? NextResponse.json({ data }) : NextResponse.json({ error: 'Horário não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('appointment_update_failed', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o horário.' }, { status: 500 });
  }
}

async function handleDELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    return await deleteAppointment((await context.params).id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Horário não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('appointment_delete_failed', error);
    return NextResponse.json({ error: 'Não foi possível excluir o horário.' }, { status: 500 });
  }
}

export const PATCH = protectedRoute(handlePATCH);
export const DELETE = protectedRoute(handleDELETE);
