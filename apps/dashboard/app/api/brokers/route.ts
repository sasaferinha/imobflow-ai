import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, normalizeEmail, normalizeName, protectedRoute, verifyPassword } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { consumeRateLimit, hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';

type Broker = { id: string; name: string; email: string | null; role: 'owner' | 'broker'; active: boolean; created_at: string };

function owner() {
  const account = currentAccount();
  return account?.role === 'owner' ? account : null;
}

async function getBrokers() {
  const account = owner();
  if (!account) return NextResponse.json({ error: 'Apenas o administrador da empresa pode gerenciar corretores.' }, { status: 403 });
  try {
    const [brokers, company, publicRows] = await Promise.all([
      supabaseRequest<Broker[]>(`broker_accounts?company_id=eq.${encodeURIComponent(account.companyId)}&select=id,name,email,role,active,created_at&order=created_at.asc`),
      supabaseRequest<Array<{ seat_limit: number }>>(`account_companies?company_id=eq.${encodeURIComponent(account.companyId)}&select=seat_limit&limit=1`),
      supabaseRequest<Array<{ slug: string }>>(`companies?id=eq.${encodeURIComponent(account.companyId)}&select=slug&limit=1`),
    ]);
    return NextResponse.json({ data: brokers, brokerLimit: company[0]?.seat_limit || 3, publicContactPath: publicRows[0] ? `/imobiliaria/${encodeURIComponent(publicRows[0].slug)}` : null });
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
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) return NextResponse.json({ error: 'Informe nome, e-mail válido e uma senha de pelo menos 8 caracteres.' }, { status: 400 });
    const rows = await supabaseRequest<Broker[]>('rpc/create_company_broker', { method: 'POST', body: {
      p_company_id: account.companyId, p_name: name, p_name_key: normalizeName(name), p_email: email, p_email_key: normalizeEmail(email), p_password_hash: await hashPassword(password),
    } });
    if (!rows[0]) throw new Error('empty_broker');
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Não foi possível cadastrar. O corretor pode já existir ou o plano Basic atingiu o limite de três corretores.' }, { status: 409 }); }
}

async function updateOwnEmail(request: NextRequest) {
  const account = currentAccount();
  if (!account) return NextResponse.json({ error: 'Entre na sua conta para continuar.' }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    if (!await consumeRateLimit(request,'account-email-change',5,900)) return NextResponse.json({error:'Muitas tentativas. Aguarde 15 minutos.'},{status:429});
    const raw = await request.text();
    if (Buffer.byteLength(raw)>2048) return NextResponse.json({error:'Dados acima do limite.'},{status:413});
    const body = JSON.parse(raw) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const [current] = await supabaseRequest<Array<{password_hash:string;auth_version:number}>>(`broker_accounts?id=eq.${account.brokerId}&company_id=eq.${account.companyId}&active=eq.true&select=password_hash,auth_version&limit=1`);
    if(!current || !currentPassword || currentPassword.length>128 || !await verifyPassword(currentPassword,current.password_hash)) return NextResponse.json({error:'Confirme sua senha atual.'},{status:403});
    if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
    const changed = await supabaseRequest<boolean>('rpc/change_account_email', { method: 'POST', body: { p_broker_id:account.brokerId,p_expected_hash:current.password_hash,p_expected_auth_version:current.auth_version,p_email:email } });
    if (!changed) return NextResponse.json({error:'Seu acesso mudou. Entre novamente antes de alterar o e-mail.'},{status:409});
    return NextResponse.json({ ok:true });
  } catch { return NextResponse.json({ error: 'Não foi possível salvar o e-mail de acesso.' }, { status: 409 }); }
}

export const GET = protectedRoute(getBrokers);
export const POST = protectedRoute(createBroker);
export const PATCH = protectedRoute(updateOwnEmail);
