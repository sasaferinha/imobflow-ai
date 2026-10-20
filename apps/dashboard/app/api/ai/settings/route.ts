import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { readTenantAISettingsSnapshot } from '@/lib/ai/tenant-settings-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = protectedRoute(async () => {
  const actor = currentAccount()!;
  if (actor.role !== 'owner') return NextResponse.json({ error: 'Somente o gestor pode consultar a configuração da IA.' }, { status: 403 });
  try {
    const { configuration, updatedAt, updatedBy } = await readTenantAISettingsSnapshot(actor.companyId);
    return NextResponse.json({ providerConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()), providerTested: false,
      configuration, updatedAt, updatedBy }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar a configuração da IA. Tente novamente em instantes.' }, { status: 503 });
  }
});
