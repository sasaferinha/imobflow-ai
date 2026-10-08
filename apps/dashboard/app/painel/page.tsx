import DashboardClient from '../dashboard-client';
import LoginClient from './login-client';
import { cookies } from 'next/headers';
import { ACCOUNT_COOKIE, readAccount } from '@/lib/accounts';
import { evolutionEnabled } from '@/lib/evolution/feature';
import { evolutionIntegrated } from '@/lib/evolution/server';
import EvolutionEntry from '../evolution/live-entry';

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ experiencia?: string }> }) {
  const jar = await cookies();
  const account = await readAccount(jar.get(ACCOUNT_COOKIE)?.value);
  const params = await searchParams;
  if (account && evolutionEnabled(account.companyId) && evolutionIntegrated() && params.experiencia !== 'classica') return <EvolutionEntry actor={account} />;
  return account ? <DashboardClient account={account} /> : <LoginClient />;
}
