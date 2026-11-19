import type { Metadata } from 'next';
import BusinessLanding from './business-landing';

export const metadata: Metadata = {
  title: 'ImobFlow — Boas conversas. Novos negócios.',
  description: 'Conecte atendimento, leads e imóveis em um só CRM. Conheça o Match de imóveis, acompanhe sua equipe e mantenha o site da imobiliária conectado.',
  openGraph: {title: 'ImobFlow — Boas conversas. Novos negócios.', description: 'Atendimento, clientes e imóveis conectados à rotina da sua imobiliária.', images: [{url:'/og.png',width:1200,height:630,alt:'ImobFlow — Gestão imobiliária'}]},
  twitter: {card:'summary_large_image',title:'ImobFlow — Boas conversas. Novos negócios.',description:'Atendimento, clientes e imóveis conectados à rotina da sua imobiliária.',images:['/og.png']},
};

export default function Home() {
  return <BusinessLanding />;
}

