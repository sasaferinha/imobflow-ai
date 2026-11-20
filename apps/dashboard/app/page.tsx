import type { Metadata } from 'next';
import BusinessLanding from './business-landing';

export const metadata: Metadata = {
  title: 'ImobFlow — Mais espaço para vender.',
  description: 'Conversas, imóveis e equipe no mesmo fluxo. Explore atendimento com IA, Match, visitas, gestão, campanhas e site conectado no CRM da sua imobiliária.',
  openGraph: {title: 'ImobFlow — Mais espaço para vender.', description: 'Atendimento, clientes e imóveis conectados à rotina da sua imobiliária.', images: [{url:'/og.png',width:1200,height:630,alt:'ImobFlow — Gestão imobiliária'}]},
  twitter: {card:'summary_large_image',title:'ImobFlow — Mais espaço para vender.',description:'Atendimento, clientes e imóveis conectados à rotina da sua imobiliária.',images:['/og.png']},
};

export default function Home() {
  return <BusinessLanding />;
}
