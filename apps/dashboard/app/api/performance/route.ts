import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { createSale, getPerformance, updatePerformanceSettings } from '@/lib/database';
import type { PerformanceSettingsInput, SaleInput } from '@/lib/operations';
import { hasSameOrigin } from '@/lib/request-security';
import { currentAccount } from '@/lib/tenant-context';

export const runtime = 'nodejs';
const clean = (value:unknown,max=160) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const uuid = (value:string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const validMonth = (value:string) => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
const amount = (value:unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1_000_000_000_000 ? value : NaN;
function validSaleDate(value:string) {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

async function handleGET(request:NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error:'Não autorizado' },{ status:401 });
  const month = request.nextUrl.searchParams.get('month') || new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit' }).format(new Date());
  if (!validMonth(month)) return NextResponse.json({ error:'Mês inválido.' },{ status:400 });
  try { return NextResponse.json({ data:await getPerformance(month) }); }
  catch (error) { console.error('performance_get_failed',error); return NextResponse.json({ error:'Não foi possível carregar os indicadores.' },{ status:500 }); }
}

async function handlePOST(request:NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error:'Não autorizado' },{ status:401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error:'Origem não permitida.' },{ status:403 });
  try {
    const body = await request.json() as Record<string,unknown>;
    const actor = currentAccount();
    const brokerId = actor?.role === 'broker' ? actor.brokerId : clean(body.brokerId,36);
    const input:SaleInput = { date:clean(body.date,10), brokerId, propertyId:clean(body.propertyId,36),leadId:clean(body.leadId,36) || undefined,
      broker:'',property:'',client:clean(body.client),amount:amount(body.amount),dealType:body.dealType === 'Aluguel' ? 'Aluguel' : 'Venda' };
    if (!validSaleDate(input.date) || !uuid(input.propertyId!) || !uuid(brokerId) || (input.leadId && !uuid(input.leadId)) || (!input.leadId && !input.client) || !Number.isFinite(input.amount) || input.amount<=0 || (body.dealType !== undefined && !['Venda','Aluguel'].includes(String(body.dealType)))) {
      return NextResponse.json({ error:'Selecione o imóvel, o corretor e o cliente e preencha os dados válidos do negócio.' },{ status:400 });
    }
    return NextResponse.json({ data:await createSale(input) },{ status:201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/property_unavailable/.test(message)) return NextResponse.json({ error:'O imóvel já foi vendido, alugado ou alterado. Atualize o catálogo antes de continuar.' },{ status:409 });
    if (/deal_forbidden/.test(message)) return NextResponse.json({ error:'Este corretor não pode registrar o negócio.' },{ status:403 });
    if (/property_not_found|lead_not_found/.test(message)) return NextResponse.json({ error:'O imóvel ou cliente não foi encontrado nesta empresa.' },{ status:404 });
    if (/deal_purpose_mismatch|deal_invalid|numeric field overflow/.test(message)) return NextResponse.json({ error:'Confira a data, o valor e a finalidade do imóvel.' },{ status:400 });
    console.error('sale_create_failed',error);
    return NextResponse.json({ error:'Não foi possível confirmar o negócio. Atualize os resultados antes de tentar novamente.' },{ status:500 });
  }
}

async function handlePATCH(request:NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error:'Não autorizado' },{ status:401 });
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error:'Somente o administrador pode alterar metas.' },{ status:403 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error:'Origem não permitida.' },{ status:403 });
  try {
    const body = await request.json() as Record<string,unknown>;
    const raw = Array.isArray(body.brokerGoals) ? body.brokerGoals : [];
    const input:PerformanceSettingsInput = { month:clean(body.month,7),companyGoal:amount(body.companyGoal),brokerGoals:raw.map(item => {
      const goal = item as Record<string,unknown>; return { broker:clean(goal.broker),brokerId:clean(goal.brokerId,36),goal:amount(goal.goal) };
    }) };
    if (!validMonth(input.month) || !Number.isFinite(input.companyGoal) || raw.length>100 || input.brokerGoals.some(g => !uuid(g.brokerId) || !Number.isFinite(g.goal)) || new Set(input.brokerGoals.map(g => g.brokerId)).size !== raw.length) return NextResponse.json({ error:'Revise o mês e as metas informadas.' },{ status:400 });
    // Old editable counters are ignored: only CRM events count.
    return NextResponse.json({ data:await updatePerformanceSettings(input) });
  } catch (error) {
    console.error('performance_update_failed',error);
    return NextResponse.json({ error:'Não foi possível atualizar as metas.' },{ status:500 });
  }
}

export const GET = protectedRoute(handleGET);
export const POST = protectedRoute(handlePOST);
export const PATCH = protectedRoute(handlePATCH);
