import { NextRequest, NextResponse } from 'next/server';
import { finishInstagramOAuth, instagramOAuthFailure, INSTAGRAM_COOKIE, INSTAGRAM_CALLBACK } from '@/lib/instagram-login';
import type { InstagramConnectionIssue } from '@/lib/instagram-connection-feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
export async function GET(request: NextRequest) {
  let status = 'connected';
  let issue: InstagramConnectionIssue | null = null;
  const state = request.nextUrl.searchParams.get('state') || '';
  const cookie = request.cookies.get(INSTAGRAM_COOKIE)?.value;
  const code = request.nextUrl.searchParams.get('code') || '';
  // Provider query values never become messages. Cancellation is presentation
  // only and must belong to this browser's pending attempt.
  if (!code && request.nextUrl.searchParams.get('error') === 'access_denied' && /^[a-f\d]{64}$/.test(state) && state === cookie) {
    status = 'failed'; issue = 'authorization_cancelled';
  } else {
    try { await finishInstagramOAuth(state, cookie, code); }
    catch (error) { status = 'failed'; issue = instagramOAuthFailure(error); }
  }
  // A public intermediary starts a fresh same-site navigation so the Strict
  // CRM session is restored without exposing the authorization code.
  const destination = new URL('/integracoes/retorno', request.nextUrl.origin);
  destination.searchParams.set('fluxo', 'social');
  destination.searchParams.set('resultado', status);
  destination.searchParams.set('canal', 'instagram');
  if (issue) destination.searchParams.set('motivo', issue);
  const response = NextResponse.redirect(destination);
  response.cookies.set(INSTAGRAM_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: INSTAGRAM_CALLBACK, maxAge: 0 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
