import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { supabaseRequest } from './supabase';

export function hasSafeRequestSize(request: NextRequest, maximumBytes: number) {
  const length = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(length) && length >= 0 && length <= maximumBytes;
}

export function hasSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

function requestIdentifier(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const raw = forwarded || request.headers.get('x-real-ip') || 'unknown';
  const key = process.env.ADMIN_PANEL_SECRET || process.env.SUPABASE_SECRET_KEY || 'imobflow';
  return createHmac('sha256', key).update(raw).digest('hex');
}

export async function consumeRateLimit(request: NextRequest, bucket: string, limit: number, windowSeconds: number) {
  return supabaseRequest<boolean>('rpc/consume_rate_limit', {
    method: 'POST',
    body: {
      p_bucket: bucket,
      p_identifier_hash: requestIdentifier(request),
      p_window_seconds: windowSeconds,
      p_limit: limit,
    },
  });
}

