import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { readConversationImage } from '@/lib/conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGET(request: NextRequest) {
  if (!isAdminRequest(request)) return new NextResponse('Não autorizado', { status: 401 });
  const messageId = request.nextUrl.searchParams.get('messageId') || '';
  const index = Number(request.nextUrl.searchParams.get('index'));
  try {
    const image = await readConversationImage(messageId, index);
    return new NextResponse(image.bytes, { headers: { 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=300' } });
  } catch {
    return new NextResponse('Foto não encontrada', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = protectedRoute(handleGET);
