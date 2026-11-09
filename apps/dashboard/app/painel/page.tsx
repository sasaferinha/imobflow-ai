import DashboardClient from '../dashboard-client';
import LoginClient from './login-client';
import { cookies } from 'next/headers';
import { ACCOUNT_COOKIE, readAccount } from '@/lib/accounts';
import { evolutionEnabled } from '@/lib/evolution/feature';
import { evolutionIntegrated } from '@/lib/evolution/server';
import EvolutionEntry from '../evolution/live-entry';

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ experiencia?: string; acesso?: string | string[]; area?: string | string[] }> }) {
  const jar = await cookies();
  const account = await readAccount(jar.get(ACCOUNT_COOKIE)?.value);
  const params = await searchParams;
  const initialArea = account?.role === 'owner' && (params.area === 'integrations' || params.area === 'settings' || params.area === 'campaigns') ? params.area : undefined;
  const integratedAvailable = Boolean(account && evolutionEnabled(account.companyId) && evolutionIntegrated());
  if (account && integratedAvailable && params.experiencia !== 'classica') return <EvolutionEntry actor={account} initialPage={initialArea} />;
  const initialMode = params.acesso === 'corretor' ? 'login' : params.acesso === 'administrador' ? 'login-admin' : 'enroll';
  if (account && initialArea === 'campaigns') return <main className="crm-access-surface crm-unavailable"><section>
    <p>ImobFlow · Campanhas</p><h1>Campanhas ficam no painel integrado</h1>
    <p>{integratedAvailable ? 'Abra o painel integrado para escolher a conta de anúncios e acompanhar suas campanhas.' : 'A área de campanhas ainda não está disponível no painel desta empresa. Você pode continuar usando as outras integrações.'}</p>
    <a href={integratedAvailable ? '/painel?area=campaigns#campaigns' : '/painel?area=integrations#integrations'}>{integratedAvailable ? 'Abrir campanhas no painel integrado' : 'Voltar às integrações'}</a>
  </section></main>;
  return account ? <DashboardClient account={account} initialView={initialArea === 'integrations' ? 'integrations' : 'overview'} /> : <LoginClient initialMode={initialMode} />;
}
