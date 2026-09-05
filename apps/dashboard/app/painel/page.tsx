import DashboardClient from '../dashboard-client';
import LoginClient from './login-client';
import { cookies } from 'next/headers';
import { isAdminCookie } from '@/lib/admin-auth';

export default async function PainelPage() {
  const authenticated = isAdminCookie((await cookies()).get('imobflow_admin')?.value);
  return authenticated ? <DashboardClient /> : <LoginClient />;
}
