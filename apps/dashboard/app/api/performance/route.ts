import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createSale, getPerformance, updatePerformanceSettings } from '@/lib/database';
import type { PerformanceSettingsInput, PerformanceSnapshot, SaleInput } from '@/lib/operations';

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

function localPerformance(month: string): PerformanceSnapshot {
  const isReferenceMonth = month === '2026-09';
  const sales = isReferenceMonth ? [
    { id:'demo-1', date:'2026-09-01', broker:'Marina Oliveira', property:'Residencial Aurora', client:'Lucas Carvalho', amount:575000, createdAt:'2026-09-01T12:00:00.000Z' },
    { id:'demo-2', date:'2026-09-02', broker:'Marina Oliveira', property:'Edifício Horizonte', client:'Ana Martins', amount:590000, createdAt:'2026-09-02T12:00:00.000Z' },
    { id:'demo-3', date:'2026-09-03', broker:'Paulo Mendes', property:'Casa Bosque Sereno', client:'Rafael Borges', amount:820000, createdAt:'2026-09-03T12:00:00.000Z' },
    { id:'demo-4', date:'2026-09-04', broker:'Paulo Mendes', property:'Casa Vila Verde', client:'Bruno Lima', amount:360000, createdAt:'2026-09-04T12:00:00.000Z' },
    { id:'demo-5', date:'2026-09-05', broker:'Camila Rocha', property:'Studio Vila Nova', client:'Juliana Reis', amount:295000, createdAt:'2026-09-05T12:00:00.000Z' },
  ] : [];
  const brokerSettings = [
    { broker:'Marina Oliveira', goal:isReferenceMonth ? 1200000 : 0, leadsReceived:isReferenceMonth ? 26 : 0, convertedLeads:isReferenceMonth ? 9 : 0, recoveredLeads:isReferenceMonth ? 4 : 0, visits:isReferenceMonth ? 7 : 0 },
    { broker:'Paulo Mendes', goal:isReferenceMonth ? 1000000 : 0, leadsReceived:isReferenceMonth ? 22 : 0, convertedLeads:isReferenceMonth ? 6 : 0, recoveredLeads:isReferenceMonth ? 2 : 0, visits:isReferenceMonth ? 5 : 0 },
    { broker:'Camila Rocha', goal:isReferenceMonth ? 800000 : 0, leadsReceived:isReferenceMonth ? 16 : 0, convertedLeads:isReferenceMonth ? 3 : 0, recoveredLeads:isReferenceMonth ? 1 : 0, visits:isReferenceMonth ? 4 : 0 },
  ];
  const history = isReferenceMonth ? [
    { month:'2026-04', sold:1420000 }, { month:'2026-05', sold:1750000 }, { month:'2026-06', sold:1980000 },
    { month:'2026-07', sold:2210000 }, { month:'2026-08', sold:2360000 }, { month:'2026-09', sold:2640000 },
  ] : [];
  const totalSold = sales.reduce((total, sale) => total + sale.amount, 0);
  const leadsReceived = isReferenceMonth ? 64 : 0;
  const convertedLeads = isReferenceMonth ? 18 : 0;
  return {
    dataMode:'demo', month, companyGoal:isReferenceMonth ? 3000000 : 0, totalSold, salesCount:sales.length,
    averageTicket:sales.length ? totalSold / sales.length : 0, leadsReceived, convertedLeads,
    recoveredLeads:isReferenceMonth ? 7 : 0, conversionRate:leadsReceived ? convertedLeads / leadsReceived * 100 : 0,
    brokers:brokerSettings.map((item) => {
      const brokerSales = sales.filter((sale) => sale.broker === item.broker);
      const sold = brokerSales.reduce((total, sale) => total + sale.amount, 0);
      return { ...item, sold, salesCount:brokerSales.length, progress:item.goal ? sold / item.goal * 100 : 0, conversionRate:item.leadsReceived ? item.convertedLeads / item.leadsReceived * 100 : 0, history:history.map((entry) => ({ ...entry, sold:entry.month === month ? sold : 0 })) };
    }).sort((a,b) => b.sold - a.sold),
    history, sales,
  };
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const month = request.nextUrl.searchParams.get('month') || new Date().toISOString().slice(0, 7);
  if (!validMonth(month)) return NextResponse.json({ error: 'Mês inválido.' }, { status: 400 });
  try {
    return NextResponse.json({ data: await getPerformance(month) });
  } catch (error) {
    console.error('performance_get_failed', error);
    if (!process.env.DATABASE_URL) return NextResponse.json({ data: localPerformance(month) });
    return NextResponse.json({ error: 'Não foi possível carregar os indicadores.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const input: SaleInput = {
      date: clean(body.date, 10), broker: clean(body.broker), property: clean(body.property), client: clean(body.client), amount: positiveNumber(body.amount),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.broker || !input.property || !input.client || input.amount <= 0) {
      return NextResponse.json({ error: 'Preencha os dados válidos da venda.' }, { status: 400 });
    }
    return NextResponse.json({ data: await createSale(input) }, { status: 201 });
  } catch (error) {
    console.error('sale_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível registrar a venda.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
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
