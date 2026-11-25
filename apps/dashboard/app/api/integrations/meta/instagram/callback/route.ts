import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { finishInstagramOAuth, INSTAGRAM_COOKIE, INSTAGRAM_CALLBACK } from '@/lib/instagram-login';
import { classifyInstagramOAuthFailure, type InstagramOAuthFailure } from '@/lib/instagram-oauth-result';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
export async function GET(request: NextRequest) {
  let status = 'connected';
  let reason: InstagramOAuthFailure | null = null;
  let reference: string | null = null;
  const query = request.nextUrl.searchParams;
  const single = (name: string) => { const values = query.getAll(name); return values.length === 1 ? values[0] : ''; };
  try {
    const state = single('state'), cookie = request.cookies.get(INSTAGRAM_COOKIE)?.value, code = single('code');
    if (query.has('error')) await finishInstagramOAuth(state, cookie, '', single('error') === 'access_denied' ? 'cancelled' : 'provider_rejected');
    else await finishInstagramOAuth(state, cookie, code);
  } catch (error) {
    status = 'failed';
    reason = classifyInstagramOAuthFailure(error);
    reference = randomBytes(12).toString('hex');
    // Allowlisted category + locally generated ID only: no exception, URL,
    // request headers, code, cookie, token or provider response in logs.
    console.error('instagram_oauth_failed', { reason, reference });
  }
  // A public intermediary starts a fresh same-site navigation so the Strict
  // CRM session is restored without exposing the authorization code.
  const destination = new URL('/integracoes/retorno', request.nextUrl.origin);
  destination.searchParams.set('fluxo', 'social');
  destination.searchParams.set('resultado', status);
  destination.searchParams.set('canal', 'instagram');
  if (reason && reference) { destination.searchParams.set('motivo', reason); destination.searchParams.set('referencia', reference); }
  const response = NextResponse.redirect(destination);
  response.cookies.set(INSTAGRAM_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: INSTAGRAM_CALLBACK, maxAge: 0 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
