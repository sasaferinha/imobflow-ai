import DashboardClient from '../dashboard-client';
import LoginClient from './login-client';
import { cookies } from 'next/headers';

export default async function PainelPage() {
  const authenticated = (await cookies()).get('imobflow_admin')?.value === process.env.ADMIN_PANEL_SECRET && Boolean(process.env.ADMIN_PANEL_SECRET);
  return authenticated ? <DashboardClient /> : <LoginClient />;
}
