import type { Metadata } from 'next';
import MarketingLogin from './marketing-login';

export const metadata: Metadata = { title: 'Acesso ao site | ImobFlow', robots: { index: false, follow: false } };
export default function MarketingLoginPage() { return <MarketingLogin />; }
