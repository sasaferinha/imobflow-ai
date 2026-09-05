import { NextRequest, NextResponse } from 'next/server';
import { importLeads } from '@/lib/database';
import type { LeadInput, LeadLifecycleStatus } from '@/lib/leads';
import { isAdminRequest } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const statuses: LeadLifecycleStatus[] = ['Novo', 'Em atendimento', 'Visita', 'Proposta', 'Convertido', 'Perdido'];

function clean(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const body = await request.json() as { leads?: Array<Record<string, unknown>> };
    const rawLeads = Array.isArray(body.leads) ? body.leads.slice(0, 500) : [];
    const leads: LeadInput[] = rawLeads.map((item) => {
      const status = clean(item.lifecycleStatus, 30) as LeadLifecycleStatus;
      const lastContact = clean(item.lastContactAt, 40);
      return {
        name: clean(item.name, 120), phone: clean(item.phone, 30), email: clean(item.email, 160) || null,
        goal: clean(item.goal, 50) || 'Não informado', propertyType: clean(item.propertyType, 50) || 'Não informado',
        region: clean(item.region, 160) || 'Não informado', budget: clean(item.budget, 100) || 'Não informado',
        details: clean(item.details, 1000) || null, source: clean(item.source, 80) || 'Importação CSV',
        assignedTo: clean(item.assignedTo, 120) || null,
        lifecycleStatus: statuses.includes(status) ? status : 'Novo',
        lastContactAt: lastContact && !Number.isNaN(new Date(lastContact).getTime()) ? new Date(lastContact).toISOString() : null,
      };
    }).filter((lead) => lead.name && (lead.phone || lead.email));

    if (leads.length === 0) return NextResponse.json({ error: 'Nenhum lead válido encontrado. Informe nome e telefone ou e-mail.' }, { status: 400 });
    return NextResponse.json({ data: await importLeads(leads) }, { status: 201 });
  } catch (error) {
    console.error('lead_import_failed', error);
    return NextResponse.json({ error: 'Não foi possível importar a base de leads.' }, { status: 500 });
  }
}
