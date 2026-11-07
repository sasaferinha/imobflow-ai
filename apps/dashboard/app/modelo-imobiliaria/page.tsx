import type { Metadata } from 'next';
import DemoWebsite from './demo-client';

export const metadata: Metadata = {
  title: 'Horizonte Imobiliária · Modelo de site ImobFlow',
  description: 'Experimente um site de imobiliária com catálogo, conteúdo editável e publicação. Empresa e imóveis fictícios.',
  robots: { index: false, follow: false },
  openGraph: { title: 'Horizonte Imobiliária · Demonstração', description: 'Modelo demonstrativo de site conectado à ImobFlow.', images: [] },
  twitter: { title: 'Horizonte Imobiliária · Demonstração', description: 'Modelo demonstrativo de site conectado à ImobFlow.', images: [] },
};

export default function ModelPage() {
  return <DemoWebsite />;
}
