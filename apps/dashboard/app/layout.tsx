import type { Metadata } from 'next';
import './globals.css';

const siteOrigin = process.env.SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: 'ImobFlow — Seu próximo imóvel começa com uma boa conversa',
  description: 'Conte o que você procura e receba um atendimento imobiliário personalizado pelo WhatsApp.',
  openGraph: {
    title: 'ImobFlow AI',
    description: 'Encontre seu próximo imóvel com atendimento inteligente pelo WhatsApp.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'ImobFlow AI — Atendimento inteligente para imobiliárias' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ImobFlow AI',
    description: 'Encontre seu próximo imóvel com atendimento inteligente pelo WhatsApp.',
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

