import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem inválida.' }, { status: 403 });
  const actor = currentAccount()!;
  try {
    const ok = await supabaseRequest<boolean>('rpc/touch_broker_presence', { method: 'POST', body: { p_company_id: actor.companyId, p_broker_id: actor.brokerId } });
    return NextResponse.json({ ok }, { status: ok ? 200 : 403, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Presença temporariamente indisponível.' }, { status: 503 }); }
});
