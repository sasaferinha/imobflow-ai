import { NextRequest, NextResponse } from 'next/server';
import { updateLeadIntelligence } from '@/lib/database';
import type { LeadLifecycleStatus } from '@/lib/leads';
import { isAdminRequest } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const statuses: LeadLifecycleStatus[] = ['Novo', 'Em atendimento', 'Visita', 'Proposta', 'Convertido', 'Perdido'];

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const lifecycleStatus = statuses.includes(body.lifecycleStatus as LeadLifecycleStatus) ? body.lifecycleStatus as LeadLifecycleStatus : 'Novo';
    const rawDate = typeof body.lastContactAt === 'string' ? body.lastContactAt : '';
    const lastContactAt = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString() : null;
    const data = await updateLeadIntelligence(id, {
      lifecycleStatus, lastContactAt, recoverySelected: Boolean(body.recoverySelected),
      assignedTo: typeof body.assignedTo === 'string' && body.assignedTo.trim() ? body.assignedTo.trim().slice(0, 120) : null,
    });
    if (!data) return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('lead_update_failed', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o lead.' }, { status: 500 });
  }
}
