import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, authenticate, cookieOptions, hashPassword, issueSession, normalizeName } from '@/lib/accounts';
import { COOKIE_NAME, isValidAdminPassword } from '@/lib/admin-auth';
import { consumeRateLimit, hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  const { action } = await params;
  if (!['login', 'provision'].includes(action)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 404 });
  try {
    if (!await consumeRateLimit(request, `account-${action}`, action === 'login' ? 10 : 5, 900)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return NextResponse.json({ error: 'Dados acima do limite.' }, { status: 413 });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 }); }
    if (!body || Array.isArray(body)) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    const company = typeof body.company === 'string' ? body.company.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    const name = typeof body.name === 'string' ? body.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (company.length < 2 || company.length > 120 || name.length < 2 || name.length > 120 || !password || password.length > 128) return NextResponse.json({ error: 'Preencha empresa, nome do corretor e senha.' }, { status: 400 });
    let token: string;
    if (action === 'login') {
      const account = await authenticate(company, name, password);
      if (!account) return NextResponse.json({ error: 'Empresa, corretor ou senha incorretos.' }, { status: 401 });
      token = await issueSession(account);
    } else {
      const managementPassword = typeof body.managementPassword === 'string' ? body.managementPassword : '';
      if (!isValidAdminPassword(managementPassword)) return NextResponse.json({ error: 'Senha administrativa incorreta.' }, { status: 401 });
      if (password.length < 12) return NextResponse.json({ error: 'Use uma senha com pelo menos 12 caracteres.' }, { status: 400 });
      const existingCompany = body.existingCompany === true;
      const seatLimit = Number(body.seatLimit);
      if (!Number.isInteger(seatLimit) || seatLimit < 1 || seatLimit > 500) return NextResponse.json({ error: 'Informe um limite de 1 a 500 corretores.' }, { status: 400 });
      try {
        await supabaseRequest('rpc/admin_provision_broker', { method: 'POST', body: {
          p_company: company, p_company_key: normalizeName(company), p_name: name, p_name_key: normalizeName(name),
          p_password_hash: await hashPassword(password), p_seat_limit: seatLimit, p_existing_company: existingCompany,
        } });
      } catch { return NextResponse.json({ error: 'Não foi possível cadastrar. Confira o nome da empresa, o limite de corretores e se o corretor já existe.' }, { status: 409 }); }
      return NextResponse.json({ ok: true });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCOUNT_COOKIE, token, cookieOptions);
    response.cookies.set(COOKIE_NAME, '', { ...cookieOptions, maxAge: 0 });
    return response;
  } catch { return NextResponse.json({ error: 'Serviço de acesso indisponível. Tente novamente em instantes.' }, { status: 503 }); }
}
