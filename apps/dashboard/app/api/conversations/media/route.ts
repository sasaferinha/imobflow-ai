import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { readConversationImage } from '@/lib/conversations';
import { privateMediaResponse } from '@/lib/private-media-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET(request: NextRequest) {
  if (!isAdminRequest(request)) return new NextResponse('Não autorizado', { status: 401 });
  const messageId = request.nextUrl.searchParams.get('messageId') || '';
  const index = Number(request.nextUrl.searchParams.get('index'));
  try {
    const image = await readConversationImage(messageId, index);
    return privateMediaResponse(image, request.headers.get('range'));
  } catch {
    return new NextResponse('Mídia indisponível ou expirada', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = protectedRoute(handleGET);
