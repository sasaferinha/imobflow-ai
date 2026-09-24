import type { Metadata } from 'next';
import BusinessLanding from './business-landing';

export const metadata: Metadata = {
  title: 'ImobFlow — Organização e automação para imobiliárias',
  description: 'Organize leads, automatize o atendimento pelo WhatsApp e acompanhe sua equipe em um só lugar.',
  openGraph: {title: 'ImobFlow — Mais tempo para vender', description: 'Organização e automação para imobiliárias.', images: [{url:'/og.png',width:1200,height:630,alt:'ImobFlow — Gestão imobiliária'}]},
  twitter: {card:'summary_large_image',title:'ImobFlow — Mais tempo para vender',description:'Organização e automação para imobiliárias.',images:['/og.png']},
};

export default function Home() {
  return <BusinessLanding />;
}

