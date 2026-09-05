import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { deleteAppointment, updateAppointmentStatus } from '@/lib/database';

export const runtime = 'nodejs';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
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

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return await deleteAppointment((await context.params).id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Horário não encontrado.' }, { status: 404 });
  } catch (error) {
    console.error('appointment_delete_failed', error);
    return NextResponse.json({ error: 'Não foi possível excluir o horário.' }, { status: 500 });
  }
}
