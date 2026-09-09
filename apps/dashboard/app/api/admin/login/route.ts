import { NextRequest, NextResponse } from 'next/server';
import { adminSessionToken, COOKIE_NAME, isValidAdminPassword } from '@/lib/admin-auth';
import { consumeRateLimit, hasSafeRequestSize, hasSameOrigin } from '@/lib/request-security';

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!hasSafeRequestSize(request, 4096)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
  try {
    if (!await consumeRateLimit(request, 'admin-login', 5, 15 * 60)) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429, headers: { 'Retry-After': '900' } });
    }
  } catch (error) {
    console.error('login_rate_limit_failed', error);
    return NextResponse.json({ error: 'Proteção de acesso temporariamente indisponível.' }, { status: 503 });
  }
  const { password } = await request.json() as { password?: string };
  if (!isValidAdminPassword(password || '')) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, adminSessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12 });
  return response;
}
