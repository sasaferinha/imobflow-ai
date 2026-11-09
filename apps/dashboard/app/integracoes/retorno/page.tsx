import type { Metadata } from 'next';
import s from './return.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Voltar à ImobFlow',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Query = { fluxo?: string | string[]; resultado?: string | string[] };

export default async function IntegrationReturnPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const ads = query.fluxo === 'ads';
  const knownFlow = ads || query.fluxo === 'social';
  const result = knownFlow && (query.resultado === 'connected' || query.resultado === 'failed') ? query.resultado : null;
  const destination = ads ? '/painel?area=campaigns#campaigns' : '/painel?area=integrations#integrations';
  const label = ads ? 'Voltar às campanhas' : 'Voltar às integrações';

  // Query parameters only select presentation. The destination authenticates
  // the existing HttpOnly session; this page never reads or creates a session.
  return <main className={s.page}>
    <section className={s.card} aria-labelledby="integration-return-title">
      <span className={s.brand}>ImobFlow</span>
      <h1 id="integration-return-title">{result === 'failed' ? 'A conexão não foi concluída' : 'Continue na ImobFlow'}</h1>
      <p>{result === 'failed'
        ? 'Volte ao painel para conferir a conexão e tentar novamente.'
        : result === 'connected'
          ? ads
            ? 'A autorização foi recebida. Volte às campanhas para escolher a conta de anúncios e conferir a conexão.'
            : 'A autorização foi recebida. Volte às integrações para escolher a Página e conferir a conexão.'
          : 'Volte ao painel para conferir suas conexões com a Meta.'}</p>
      {/* A native link starts a fresh same-site document request, even without
          JavaScript, rather than reusing a prefetched unauthenticated CRM. */}
      <a className={s.continue} href={destination}>{label}<span aria-hidden="true">→</span></a>
    </section>
  </main>;
}
