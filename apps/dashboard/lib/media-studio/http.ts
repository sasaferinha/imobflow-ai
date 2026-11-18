import { NextRequest, NextResponse } from 'next/server';
import { hasSameOrigin } from '../request-security';
import { MediaError } from './model';

export function requireMediaOrigin(request: NextRequest) {
  if (!request.headers.get('origin') || !hasSameOrigin(request)) throw new MediaError('media_origin', 403);
}
export async function mediaResponse(action: () => Promise<unknown>) {
  try {
    const result = await action();
    return result instanceof Response ? result : NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const known = error instanceof MediaError;
    return NextResponse.json({ error: known ? error.message : 'O estúdio está temporariamente indisponível.', ...(known ? { code: error.code } : {}) }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
