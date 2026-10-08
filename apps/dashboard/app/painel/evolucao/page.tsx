import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCOUNT_COOKIE, readAccount } from '@/lib/accounts';
import { evolutionEnabled } from '@/lib/evolution/feature';
import EvolutionEntry from '../../evolution/live-entry';

export default async function EvolutionPage() {
  const account = await readAccount((await cookies()).get(ACCOUNT_COOKIE)?.value);
  if (!account) redirect('/painel');
  if (!evolutionEnabled(account.companyId)) notFound();
  return <EvolutionEntry actor={account} />;
}
