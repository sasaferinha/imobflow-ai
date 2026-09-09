import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, authenticate, cookieOptions, hashPassword, issueSession, newToken, normalizeName, readAccount, tokenHash } from '@/lib/accounts';
import { isAdminCookie, COOKIE_NAME } from '@/lib/admin-auth';
import { LEGACY_COMPANY_ID } from '@/lib/tenant-context';
import { consumeRateLimit, hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  const { action } = await params;
  if (!['login', 'signup', 'invite'].includes(action)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 404 });
  try {
    if (!await consumeRateLimit(request, `account-${action}`, action === 'login' ? 10 : 5, 900)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
    if (action === 'invite') {
      const account = await readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value);
      if (account?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode convidar corretores.' }, { status: 403 });
      const token = newToken();
      await supabaseRequest('account_invitations', { method: 'POST', body: { token_hash: tokenHash(token), company_id: account.companyId, created_by: account.brokerId, expires_at: new Date(Date.now() + 86400000).toISOString() } });
      return NextResponse.json({ invitation: token, company: account.company, expiresIn: '24 horas' });
    }
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
      if (password.length < 12) return NextResponse.json({ error: 'Use uma senha com pelo menos 12 caracteres.' }, { status: 400 });
      const invitation = typeof body.invitation === 'string' ? body.invitation.trim() : '';
      if (invitation && !/^[a-f0-9]{64}$/.test(invitation)) return NextResponse.json({ error: 'Código de convite inválido.' }, { status: 400 });
      const claim = body.claimLegacy === true;
      if (claim && !isAdminCookie(request.cookies.get(COOKIE_NAME)?.value)) return NextResponse.json({ error: 'Acesso anterior expirado. Entre novamente para migrar a conta.' }, { status: 403 });
      token = newToken();
      try {
        await supabaseRequest('rpc/register_account', { method: 'POST', body: {
          p_company: company, p_company_key: normalizeName(company), p_name: name, p_name_key: normalizeName(name),
          p_password_hash: await hashPassword(password), p_session_hash: tokenHash(token),
          p_invitation_hash: invitation ? tokenHash(invitation) : null, p_claim_company: claim ? LEGACY_COMPANY_ID : null,
        } });
      } catch { return NextResponse.json({ error: 'Não foi possível cadastrar. Se a empresa já existe, peça um convite ao administrador. Confira também o nome do corretor e a validade do convite.' }, { status: 409 }); }
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCOUNT_COOKIE, token, cookieOptions);
    response.cookies.set(COOKIE_NAME, '', { ...cookieOptions, maxAge: 0 });
    return response;
  } catch { return NextResponse.json({ error: 'Serviço de acesso indisponível. Tente novamente em instantes.' }, { status: 503 }); }
}
