import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, authenticate, cookieOptions, hashPassword, issueSession, normalizeEmail, normalizeName, tokenHash } from '@/lib/accounts';
import { COOKIE_NAME } from '@/lib/admin-auth';
import { type Account } from '@/lib/tenant-context';
import { consumeRateLimit, hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  const { action } = await params;
  if (!['login', 'login-admin', 'enroll'].includes(action)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 404 });
  try {
    if (!await consumeRateLimit(request, `account-${action}`, action === 'login' ? 10 : 5, 900)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return NextResponse.json({ error: 'Dados acima do limite.' }, { status: 413 });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 }); }
    if (!body || Array.isArray(body)) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    const company = typeof body.company === 'string' ? body.company.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    const name = typeof body.name === 'string' ? body.name.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (company.length < 2 || company.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 128 || (action === 'enroll' && (name.length < 2 || name.length > 120))) return NextResponse.json({ error: 'Preencha empresa, e-mail e senha corretamente.' }, { status: 400 });
    let account: Account | null;
    let passwordVersion: string;
    let authVersion = 0;
    if (action === 'login' || action === 'login-admin') {
      const authenticated = await authenticate(company, email, password);
      account = authenticated;
      if (!account || account.role !== (action === 'login-admin' ? 'owner' : 'broker')) return NextResponse.json({ error: 'Empresa, e-mail, senha ou tipo de acesso incorretos. Confira se escolheu Administrador ou Corretor.' }, { status: 401 });
      passwordVersion = authenticated!.passwordVersion;
      authVersion = authenticated!.authVersion;
    } else {
      const accessKey = typeof body.accessKey === 'string' ? body.accessKey.normalize('NFKC').trim() : '';
      if (accessKey.length < 20 || accessKey.length > 160) return NextResponse.json({ error: 'Informe uma chave de acesso válida.' }, { status: 400 });
      if (password.length < 8) return NextResponse.json({ error: 'Use uma senha com pelo menos 8 caracteres.' }, { status: 400 });
      passwordVersion = await hashPassword(password);
      try {
        const rows = await supabaseRequest<Array<{ broker_id: string; company_id: string; company: string; broker_name: string; role: 'owner' | 'broker' }>>('rpc/redeem_access_license', { method: 'POST', body: {
          p_company: company, p_company_key: normalizeName(company), p_name: name, p_name_key: normalizeName(name), p_email: email, p_email_key: normalizeEmail(email),
          p_password_hash: passwordVersion, p_key_hash: tokenHash(accessKey),
        } });
        const row = rows[0];
        if (!row) throw new Error('empty_license_redemption');
        account = { brokerId: row.broker_id, companyId: row.company_id, company: row.company, name: row.broker_name, role: row.role };
      } catch { return NextResponse.json({ error: 'Não foi possível criar o acesso. Confira a chave, a empresa e se ainda há vagas no plano.' }, { status: 409 }); }
    }
    const token = await issueSession(account, passwordVersion, authVersion);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCOUNT_COOKIE, token, cookieOptions);
    response.cookies.set(COOKIE_NAME, '', { ...cookieOptions, maxAge: 0 });
    return response;
  } catch { return NextResponse.json({ error: 'Serviço de acesso indisponível. Tente novamente em instantes.' }, { status: 503 }); }
}
