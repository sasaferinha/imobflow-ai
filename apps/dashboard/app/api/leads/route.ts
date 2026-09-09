import { after, NextRequest, NextResponse } from 'next/server';
import { runAutomationsAfterEvent } from '@/lib/automations';
import { createLead, listLeads } from '@/lib/database';
import type { LeadInput } from '@/lib/leads';
import { isAdminRequest } from '@/lib/admin-auth';
import { consumeRateLimit, hasSafeRequestSize, hasSameOrigin } from '@/lib/request-security';

export const runtime = 'nodejs';
export const maxDuration = 60;

function clean(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(request: NextRequest) {
  try {
    if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
    if (!hasSafeRequestSize(request, 16_384)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
    if (!await consumeRateLimit(request, 'public-lead', 12, 60 * 60)) {
      return NextResponse.json({ error: 'Muitas solicitações. Tente novamente mais tarde.' }, { status: 429, headers: { 'Retry-After': '3600' } });
    }
    const body = await request.json() as Record<string, unknown>;
    const input: LeadInput = {
      name: clean(body.name, 120), phone: clean(body.phone, 30), email: clean(body.email, 160) || null,
      goal: clean(body.goal, 50), propertyType: clean(body.propertyType, 50), region: clean(body.region, 160),
      budget: clean(body.budget, 100), details: clean(body.details, 1000) || null,
    };
    if (!input.name || !input.phone || !input.goal || !input.propertyType || !input.region || !input.budget) {
      return NextResponse.json({ error: 'Preencha os campos obrigatórios.' }, { status: 400 });
    }
    const data = await createLead(input);
    after(runAutomationsAfterEvent);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('lead_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível registrar sua solicitação.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    return NextResponse.json({ data: await listLeads() });
  } catch (error) {
    console.error('lead_list_failed', error);
    return NextResponse.json({ error: 'Não foi possível carregar os leads.' }, { status: 500 });
  }
}
