import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createSale, getPerformance, updatePerformanceSettings } from '@/lib/database';
import type { PerformanceSettingsInput, SaleInput } from '@/lib/operations';
import { hasSameOrigin } from '@/lib/request-security';

export const runtime = 'nodejs';

function clean(value: unknown, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

async function handleGET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const month = request.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  if (!validMonth(month)) return NextResponse.json({ error: 'Mês inválido.' }, { status: 400 });
  try {
    return NextResponse.json({ data: await getPerformance(month) });
  } catch (error) {
    console.error('performance_get_failed', error);
    return NextResponse.json({ error: 'Não foi possível carregar os indicadores.' }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.dealType !== undefined && body.dealType !== 'Venda' && body.dealType !== 'Aluguel') return NextResponse.json({ error: 'Tipo de negócio inválido.' }, { status: 400 });
    const input: SaleInput = {
      dealType: body.dealType === 'Aluguel' ? 'Aluguel' : 'Venda',
      date: clean(body.date, 10), broker: clean(body.broker), property: clean(body.property), client: clean(body.client), amount: positiveNumber(body.amount),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.broker || !input.property || !input.client || input.amount <= 0) {
      return NextResponse.json({ error: 'Preencha os dados válidos do negócio.' }, { status: 400 });
    }
    return NextResponse.json({ data: await createSale(input) }, { status: 201 });
  } catch (error) {
    console.error('sale_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível registrar o negócio. Verifique a conexão com o banco de dados.' }, { status: 500 });
  }
}

async function handlePATCH(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const month = clean(body.month, 7);
    const rawGoals = Array.isArray(body.brokerGoals) ? body.brokerGoals : [];
    const input: PerformanceSettingsInput = {
      month, companyGoal: positiveNumber(body.companyGoal), leadsReceived: Math.round(positiveNumber(body.leadsReceived)),
      convertedLeads: Math.round(positiveNumber(body.convertedLeads)), recoveredLeads: Math.round(positiveNumber(body.recoveredLeads)),
      brokerGoals: rawGoals.slice(0, 20).map((item) => {
        const goal = item as Record<string, unknown>;
        return { broker: clean(goal.broker), goal: positiveNumber(goal.goal) };
      }).filter((item) => item.broker),
    };
    if (!validMonth(month) || input.convertedLeads > input.leadsReceived || input.recoveredLeads > input.convertedLeads) {
      return NextResponse.json({ error: 'Revise os indicadores informados.' }, { status: 400 });
    }
    return NextResponse.json({ data: await updatePerformanceSettings(input) });
  } catch (error) {
    console.error('performance_update_failed', error);
    return NextResponse.json({ error: 'Não foi possível atualizar as metas.' }, { status: 500 });
  }
}

export const GET = protectedRoute(handleGET);
export const POST = protectedRoute(handlePOST);
export const PATCH = protectedRoute(handlePATCH);
