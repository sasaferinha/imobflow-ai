import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { password } = await request.json() as { password?: string };
  const secret = process.env.ADMIN_PANEL_SECRET;
  if (!secret || password !== secret) return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set('imobflow_admin', secret, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 60 * 60 * 12 });
  return response;
}
