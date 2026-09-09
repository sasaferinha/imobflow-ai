import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/admin-auth';
import { hasSameOrigin } from '@/lib/request-security';

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
