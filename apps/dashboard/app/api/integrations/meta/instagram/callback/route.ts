import { NextRequest, NextResponse } from 'next/server';
import { finishInstagramOAuth, INSTAGRAM_COOKIE, INSTAGRAM_CALLBACK } from '@/lib/instagram-login';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
export async function GET(request: NextRequest) {
  let status = 'connected';
  try { await finishInstagramOAuth(request.nextUrl.searchParams.get('state') || '', request.cookies.get(INSTAGRAM_COOKIE)?.value, request.nextUrl.searchParams.get('code') || ''); }
  catch { status = 'failed'; }
  // A public intermediary starts a fresh same-site navigation so the Strict
  // CRM session is restored without exposing the authorization code.
  const destination = new URL('/integracoes/retorno', request.nextUrl.origin);
  destination.searchParams.set('fluxo', 'social');
  destination.searchParams.set('resultado', status);
  if (status === 'connected') destination.searchParams.set('canal', 'instagram');
  const response = NextResponse.redirect(destination);
  response.cookies.set(INSTAGRAM_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: INSTAGRAM_CALLBACK, maxAge: 0 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
