import DashboardClient from '../dashboard-client';
import LoginClient from './login-client';
import { cookies } from 'next/headers';
import { isAdminCookie } from '@/lib/admin-auth';
import { ACCOUNT_COOKIE, readAccount } from '@/lib/accounts';

export default async function PainelPage() {
  const jar = await cookies();
  const account = await readAccount(jar.get(ACCOUNT_COOKIE)?.value);
  return account ? <DashboardClient account={account} /> : <LoginClient legacy={isAdminCookie(jar.get('imobflow_admin')?.value)} />;
}
