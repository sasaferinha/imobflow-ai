import { timingSafeEqual } from 'node:crypto';
import { mediaResponse } from '@/lib/media-studio/http';
import { recoverMediaVideos } from '@/lib/media-studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export async function POST(request: Request) {
  const secret = process.env.MESSAGE_RECOVERY_SECRET;
  const expected = Buffer.from(secret ? `Bearer ${secret}` : ''), actual = Buffer.from(request.headers.get('authorization') || '');
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ error: 'Não autorizado.' }, { status: 401 });
  return mediaResponse(recoverMediaVideos);
}
