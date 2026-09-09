import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createAppointment, listAppointments } from '@/lib/database';
import type { AppointmentInput } from '@/lib/operations';
import { hasSameOrigin } from '@/lib/request-security';

export const runtime = 'nodejs';

function clean(value: unknown, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function handleGET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json({ data: await listAppointments() });
  } catch (error) {
    console.error('appointment_list_failed', error);
    return NextResponse.json({ error: 'Não foi possível carregar a agenda.' }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input: AppointmentInput = {
      date: clean(body.date, 10), time: clean(body.time, 5), name: clean(body.name), property: clean(body.property),
      broker: clean(body.broker) || 'Marina Oliveira', status: body.status === 'Confirmada' ? 'Confirmada' : 'Aguardando', color: clean(body.color, 30) || 'amber',
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time) || !input.name || !input.property) {
      return NextResponse.json({ error: 'Preencha os dados válidos do horário.' }, { status: 400 });
    }
    return NextResponse.json({ data: await createAppointment(input) }, { status: 201 });
  } catch (error) {
    console.error('appointment_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível salvar o horário.' }, { status: 500 });
  }
}

export const GET = protectedRoute(handleGET);
export const POST = protectedRoute(handlePOST);
