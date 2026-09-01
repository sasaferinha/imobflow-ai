import type { Metadata } from 'next';
import './globals.css';

const siteOrigin = process.env.SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'ImobFlow AI — Atendimento inteligente para imobiliárias',
  description: 'Painel visual de atendimento, qualificação de leads e recomendação de imóveis com inteligência artificial.',
  openGraph: {
    title: 'ImobFlow AI',
    description: 'Atendimento inteligente para imobiliárias',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'ImobFlow AI — Atendimento inteligente para imobiliárias' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ImobFlow AI',
    description: 'Atendimento inteligente para imobiliárias',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
