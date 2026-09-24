import { NextRequest, NextResponse } from 'next/server';
import { adminSessionToken, COOKIE_NAME, isValidAdminPassword } from '@/lib/admin-auth';
import { consumeRateLimit, hasSafeRequestSize, hasSameOrigin } from '@/lib/request-security';

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!hasSafeRequestSize(request, 4096)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
  try {
    if (!await consumeRateLimit(request, 'admin-management', 5, 900)) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429, headers: { 'Retry-After': '900' } });
    }
  } catch {
    return NextResponse.json({ error: 'Não foi possível verificar o acesso. Tente novamente.' }, { status: 503 });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('password' in body) || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'Informe uma senha válida.' }, { status: 400 });
  }
  if (!isValidAdminPassword(body.password)) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, adminSessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12 });
  return response;
}
