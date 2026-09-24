import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createSale, deleteSale, getPerformance, updatePerformanceSettings } from '@/lib/database';
import { supabaseCompanyId, supabaseRequest } from '@/lib/supabase';
import type { PerformanceSettingsInput, SaleInput } from '@/lib/operations';
import { hasSameOrigin } from '@/lib/request-security';
import { currentAccount } from '@/lib/tenant-context';

export const runtime = 'nodejs';

function clean(value: unknown, max = 160) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validSaleDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeText(value: string | undefined | null) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function normalizePropertyPurpose(value: string | undefined | null) {
  const purpose = normalizeText(value || 'venda');
  if (purpose === 'aluguel' || purpose === 'alugar' || purpose === 'rent') return 'aluguel';
  if (purpose === 'venda' || purpose === 'compra' || purpose === 'comprar' || purpose === 'buy') return 'venda';
  return purpose || 'venda';
}

function normalizePropertyStatus(value: string | undefined | null) {
  const status = normalizeText(value || 'disponivel');
  if (status === 'disponivel' || status === 'available') return 'disponivel';
  if (status === 'reservado' || status === 'reservada' || status === 'reserved') return 'reservado';
  if (status === 'vendido' || status === 'vendida' || status === 'sold') return 'vendido';
  if (status === 'alugado' || status === 'aluguel' || status === 'rented') return 'alugado';
  return 'disponivel';
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
    const propertyId = clean(body.propertyId, 36);
    if (!/^[a-f0-9-]{36}$/i.test(propertyId)) return NextResponse.json({ error: 'Selecione um imóvel do catálogo.' }, { status: 400 });
    const propertyPath = `properties?id=eq.${propertyId}&company_id=eq.${encodeURIComponent(supabaseCompanyId())}`;
    const [property] = await supabaseRequest<Array<{ title: string; status: string; purpose: string }>>(`${propertyPath}&select=title,status,purpose`);
    if (!property) return NextResponse.json({ error: 'Este imóvel não foi encontrado.' }, { status: 404 });
    const normalizedStatus = normalizePropertyStatus(property.status);
    if (!['disponivel', 'reservado'].includes(normalizedStatus)) {
      return NextResponse.json({ error: 'Este imóvel não está disponível para registrar um negócio.' }, { status: 409 });
    }
    if (body.dealType !== undefined && body.dealType !== 'Venda' && body.dealType !== 'Aluguel') {
      return NextResponse.json({ error: 'Tipo de negócio inválido.' }, { status: 400 });
    }
    const dealType = body.dealType === 'Aluguel' ? 'Aluguel' : 'Venda';
    const input: SaleInput = {
      dealType,
      date: clean(body.date, 10), broker: clean(body.broker), property: property.title, client: clean(body.client), amount: positiveNumber(body.amount),
    };
    if (!validSaleDate(input.date) || !input.broker || !input.property || !input.client || input.amount <= 0) {
      return NextResponse.json({ error: 'Preencha os dados válidos do negócio.' }, { status: 400 });
    }
    const normalizedPurpose = normalizePropertyPurpose(property.purpose);
    const normalizedDealType = normalizePropertyPurpose(dealType);
    if (normalizedPurpose !== normalizedDealType) {
      return NextResponse.json({ error: 'A finalidade do imóvel não corresponde ao negócio selecionado.' }, { status: 400 });
    }
    const sale = await createSale(input);
    try {
      // Only the request that still sees the catalog state it validated may
      // close this property. A concurrent/repeated sale is rolled back below.
      const expectedStatus = property.status == null ? 'is.null' : `eq.${encodeURIComponent(property.status)}`;
      const updated = await supabaseRequest<Array<{ id: string }>>(
        `${propertyPath}&status=${expectedStatus}&select=id`,
        {
        method: 'PATCH', prefer: 'return=representation', body: { status: input.dealType === 'Aluguel' ? 'Alugado' : 'Vendido' },
        },
      );
      if (!updated.length) throw new Error('property_status_changed');
    } catch (error) {
      await deleteSale(sale.id);
      if (error instanceof Error && error.message === 'property_status_changed') {
        return NextResponse.json({ error: 'O imóvel foi alterado enquanto você registrava o negócio. Atualize o catálogo antes de tentar novamente.' }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ data: sale }, { status: 201 });
  } catch (error) {
    console.error('sale_create_failed', error);
    return NextResponse.json({ error: 'Não foi possível registrar o negócio. Verifique a conexão com o banco de dados.' }, { status: 500 });
  }
}

async function handlePATCH(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode alterar metas e indicadores.' }, { status: 403 });
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
