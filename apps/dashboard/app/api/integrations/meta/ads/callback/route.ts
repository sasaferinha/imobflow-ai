import { NextRequest, NextResponse } from 'next/server';
import { ADS_COOKIE, finishAdsOAuth } from '@/lib/meta-ads';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  let status = 'connected';
  try { await finishAdsOAuth(request.nextUrl.searchParams.get('state') || '', request.cookies.get(ADS_COOKIE)?.value, request.nextUrl.searchParams.get('code') || ''); }
  catch { status = 'failed'; }
  // A public document ends the cross-site redirect chain without relaxing the
  // CRM's SameSite=Strict session or issuing a session from an OAuth result.
  const destination = new URL('/integracoes/retorno', request.nextUrl.origin);
  destination.searchParams.set('fluxo', 'ads');
  destination.searchParams.set('resultado', status);
  const response = NextResponse.redirect(destination);
  response.cookies.set(ADS_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/integrations/meta/ads/callback', maxAge: 0 });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
