import { NextRequest, NextResponse } from 'next/server';
import { adminSessionToken, COOKIE_NAME, isValidAdminPassword } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const { password } = await request.json() as { password?: string };
  if (!isValidAdminPassword(password || '')) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, adminSessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12 });
  return response;
}
