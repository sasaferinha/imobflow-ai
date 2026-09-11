import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { hasSameOrigin } from '@/lib/request-security';
import { listOpportunities, opportunityAction } from '@/lib/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = protectedRoute(async (request: NextRequest) => {
  const offset = Number(request.nextUrl.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) return NextResponse.json({ error: 'Página inválida.' }, { status: 400 });
  try { return NextResponse.json({ data: await listOpportunities(offset) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Não foi possível carregar as oportunidades.' }, { status: 503 }); }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    const body = raw as Record<string, unknown>;
    if (typeof body.id !== 'string' || typeof body.action !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || !['draft','read','dismissed','contacted','converted'].includes(body.action))
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    return NextResponse.json({ data: await opportunityAction(body.id, body.action) });
  } catch { return NextResponse.json({ error: 'Oportunidade indisponível. Atualize a lista e confira o cadastro do lead.' }, { status: 409 }); }
});
