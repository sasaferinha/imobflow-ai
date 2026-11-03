import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { getEvolutionSnapshot, EvolutionServerError } from '@/lib/evolution/server';
import { buildBuyerReport } from '@/lib/evolution/buyer-report';
import { readScheduledBuyerReports } from '@/lib/evolution/buyer-report-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  const actor = currentAccount()!;
  // Reject before loading any customer records. No caller-supplied tenant or role.
  if (actor.role !== 'owner') return NextResponse.json({ error: 'Relatório disponível somente ao administrador.' }, { status: 403 });
  try {
    const { state } = await getEvolutionSnapshot(actor);
    if (state.companyId !== actor.companyId || !state.members.some(member => member.id === actor.brokerId && member.role === 'owner')) {
      return NextResponse.json({ error: 'Seu acesso mudou. Entre novamente.' }, { status: 403 });
    }
    const frequency = state.settings.buyerReportFrequency === 'weekly' ? 'weekly' : 'monthly';
    const scheduled = await readScheduledBuyerReports(actor.companyId, frequency).catch(() => null);
    return NextResponse.json({ ...buildBuyerReport(state, frequency), scheduled: scheduled || [], scheduleReady: scheduled !== null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof EvolutionServerError ? error.message : 'Não foi possível carregar o relatório de compradores.' }, { status: error instanceof EvolutionServerError ? error.status : 503 });
  }
});
