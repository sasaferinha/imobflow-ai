import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { readInstagramInbox } from '@/lib/instagram-inbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

const read = protectedRoute(async (request: NextRequest) => {
  if (request.nextUrl.searchParams.size > 0) {
    return NextResponse.json({ error: 'Esta consulta não aceita parâmetros.' }, { status: 400, headers });
  }
  try {
    return NextResponse.json({ data: await readInstagramInbox(request.signal) }, { headers });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar as mensagens do Instagram. Tente novamente.' }, { status: 503, headers });
  }
});

export async function GET(request: NextRequest) {
  const response = await read(request, undefined);
  // protectedRoute also returns early for invalid/unavailable sessions.
  response.headers.set('Cache-Control', headers['Cache-Control']);
  return response;
}
