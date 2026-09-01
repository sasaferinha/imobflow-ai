import { NextRequest, NextResponse } from 'next/server';
import { createLead, listLeads } from '@/lib/database';
import type { LeadInput } from '@/lib/leads';

export const runtime = 'nodejs';

function clean(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const input: LeadInput = {
      name: clean(body.name, 120), phone: clean(body.phone, 30), email: clean(body.email, 160) || null,
      goal: clean(body.goal, 50), propertyType: clean(body.propertyType, 50), region: clean(body.region, 160),
      budget: clean(body.budget, 100), details: clean(body.details, 1000) || null,
    };
    if (!input.name || !input.phone || !input.goal || !input.propertyType || !input.region || !input.budget) {
      return NextResponse.json({ error: 'Preencha os campos obrigatórios.' }, { status: 400 });
    }
    return NextResponse.json({ data: await createLead(input) }, { status: 201 });
  } catch (error) {
    console.error('lead_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível registrar sua solicitação.' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (request.cookies.get('imobflow_admin')?.value !== process.env.ADMIN_PANEL_SECRET) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  try {
    return NextResponse.json({ data: await listLeads() });
  } catch (error) {
    console.error('lead_list_failed', error);
    return NextResponse.json({ error: 'Não foi possível carregar os leads.' }, { status: 500 });
  }
}
