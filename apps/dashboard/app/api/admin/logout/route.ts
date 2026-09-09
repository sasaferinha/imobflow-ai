import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/admin-auth';
import { hasSameOrigin } from '@/lib/request-security';
import { ACCOUNT_COOKIE, cookieOptions, tokenHash } from '@/lib/accounts';
import { supabaseRequest } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  const token = request.cookies.get(ACCOUNT_COOKIE)?.value;
  if (token && /^[a-f0-9]{64}$/.test(token)) await supabaseRequest(`account_sessions?token_hash=eq.${tokenHash(token)}`, { method: 'DELETE' });
  response.cookies.set(ACCOUNT_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
