import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, normalizeName, protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { consumeRateLimit, hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';

type Broker = { id: string; name: string; role: 'owner' | 'broker'; active: boolean; created_at: string };

function owner() {
  const account = currentAccount();
  return account?.role === 'owner' ? account : null;
}

async function getBrokers() {
  const account = owner();
  if (!account) return NextResponse.json({ error: 'Apenas o administrador da empresa pode gerenciar corretores.' }, { status: 403 });
  try {
    const [brokers, company] = await Promise.all([
      supabaseRequest<Broker[]>(`broker_accounts?company_id=eq.${encodeURIComponent(account.companyId)}&select=id,name,role,active,created_at&order=created_at.asc`),
      supabaseRequest<Array<{ seat_limit: number }>>(`account_companies?company_id=eq.${encodeURIComponent(account.companyId)}&select=seat_limit&limit=1`),
    ]);
    return NextResponse.json({ data: brokers, brokerLimit: company[0]?.seat_limit || 5 });
  } catch { return NextResponse.json({ error: 'Não foi possível carregar a equipe.' }, { status: 503 }); }
}

async function createBroker(request: NextRequest) {
  const account = owner();
  if (!account) return NextResponse.json({ error: 'Apenas o administrador da empresa pode cadastrar corretores.' }, { status: 403 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!await consumeRateLimit(request, 'broker-create', 10, 900)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2048) return NextResponse.json({ error: 'Dados acima do limite.' }, { status: 413 });
    const body = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2 || name.length > 120 || password.length < 12 || password.length > 128) return NextResponse.json({ error: 'Informe o nome e uma senha de pelo menos 12 caracteres.' }, { status: 400 });
    const rows = await supabaseRequest<Broker[]>('rpc/create_company_broker', { method: 'POST', body: {
      p_company_id: account.companyId, p_name: name, p_name_key: normalizeName(name), p_password_hash: await hashPassword(password),
    } });
    if (!rows[0]) throw new Error('empty_broker');
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Não foi possível cadastrar. O corretor pode já existir ou o plano Basic atingiu o limite de cinco corretores.' }, { status: 409 }); }
}

export const GET = protectedRoute(getBrokers);
export const POST = protectedRoute(createBroker);
