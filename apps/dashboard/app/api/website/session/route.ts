import type { NextRequest } from 'next/server';
import { tokenHash } from '@/lib/accounts';
import { consumeRateLimit } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';
import { WebsiteError } from '@/lib/website/model';
import { WEBSITE_COOKIE, websiteCookieOptions, authenticateWebsiteMarketing, assertWebsiteOrigin, readWebsiteBody, websiteResponse, websiteFailure } from '@/lib/website/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const body = await readWebsiteBody(request, 4096);
    if (!await consumeRateLimit(request, 'website-login', 10, 900)) throw new WebsiteError('Muitas tentativas. Tente novamente em alguns minutos.', 429);
    if (Object.keys(body).some(k => !['email','password'].includes(k)) || typeof body.email !== 'string' || body.email.length > 160 || typeof body.password !== 'string' || body.password.length > 128) throw new WebsiteError('Confira o email e a senha.');
    const token = await authenticateWebsiteMarketing(body.email, body.password);
    if (!token) throw new WebsiteError('Email ou senha incorretos.', 401);
    const response = websiteResponse({ ok: true }); response.cookies.set(WEBSITE_COOKIE, token, websiteCookieOptions); return response;
  } catch (error) { return websiteFailure(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    assertWebsiteOrigin(request); const token = request.cookies.get(WEBSITE_COOKIE)?.value;
    if (token && /^[a-f0-9]{64}$/.test(token)) await supabaseRequest('rpc/revoke_website_session', { method: 'POST', body: { p_token_hash: tokenHash(token) } });
    const response = websiteResponse({ ok: true }); response.cookies.set(WEBSITE_COOKIE, '', { ...websiteCookieOptions, maxAge: 0 }); return response;
  } catch (error) { return websiteFailure(error); }
}
