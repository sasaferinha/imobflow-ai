import { protectedRoute } from '@/lib/accounts';
import { after, NextRequest, NextResponse } from 'next/server';
import { runAutomationsAfterEvent } from '@/lib/automations';
import { updateLeadIntelligence } from '@/lib/database';
import type { LeadLifecycleStatus } from '@/lib/leads';
import { isAdminRequest } from '@/lib/admin-auth';
import { hasSameOrigin } from '@/lib/request-security';
import { currentAccount } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const maxDuration = 60;

const statuses: LeadLifecycleStatus[] = ['Novo', 'Em atendimento', 'Visita', 'Proposta', 'Convertido', 'Perdido'];

async function handlePATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if(body.claim===true||'assignedTo' in body)return NextResponse.json({error:'Altere o responsável pela ação de atendimento na conversa.'},{status:409});
    if ('lifecycleStatus' in body && !statuses.includes(body.lifecycleStatus as LeadLifecycleStatus)) return NextResponse.json({ error: 'Etapa inválida.' }, { status: 400 });
    const rawDate = typeof body.lastContactAt === 'string' ? body.lastContactAt : '';
    const lastContactAt = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate).toISOString() : null;
    const data = await updateLeadIntelligence(id, {
      ...('lifecycleStatus' in body ? { lifecycleStatus: body.lifecycleStatus as LeadLifecycleStatus } : {}),
      ...('lastContactAt' in body ? { lastContactAt } : {}),
      ...(body.claim === true ? { assignedTo: currentAccount()!.name } : 'assignedTo' in body ? {
        assignedTo: typeof body.assignedTo === 'string' && body.assignedTo.trim() ? body.assignedTo.trim().slice(0, 120) : null,
      } : {}),
    });
    if (!data) return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 });
    after(runAutomationsAfterEvent);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('lead_update_failed', error);
    return NextResponse.json({ error: 'Não foi possível atualizar o lead.' }, { status: 500 });
  }
}

export const PATCH = protectedRoute(handlePATCH);
