import type { Metadata } from 'next';
import { instagramOAuthFailure, instagramOAuthFailureMessage, instagramOAuthReference } from '@/lib/instagram-oauth-result';
import s from './return.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Voltar à ImobFlow',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Query = { fluxo?: string | string[]; resultado?: string | string[]; canal?: string | string[]; motivo?: string | string[]; referencia?: string | string[] };

export default async function IntegrationReturnPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const ads = query.fluxo === 'ads';
  const knownFlow = ads || query.fluxo === 'social';
  const result = knownFlow && (query.resultado === 'connected' || query.resultado === 'failed') ? query.resultado : null;
  const instagramFailed = query.fluxo === 'social' && result === 'failed' && query.canal === 'instagram';
  const reason = instagramFailed ? instagramOAuthFailure(query.motivo) || 'failed' : null;
  const reference = instagramFailed ? instagramOAuthReference(query.referencia) : null;
  const channel = query.fluxo === 'social' && result === 'connected' && (query.canal === 'instagram' || query.canal === 'facebook') ? query.canal : null;
  const destination = ads ? '/painel?area=campaigns#campaigns' : instagramFailed ? '/painel?area=settings&social=instagram#settings' : channel ? `/painel?area=settings&social=${channel}#settings` : '/painel?area=integrations#integrations';
  const label = ads ? 'Voltar às campanhas' : instagramFailed ? 'Rever conexão do Instagram' : channel ? `Concluir conexão do ${channel === 'instagram' ? 'Instagram' : 'Facebook'}` : 'Voltar às integrações';

  // Query parameters only select presentation. The destination authenticates
  // the existing HttpOnly session; this page never reads or creates a session.
  return <main className={s.page}>
    <section className={s.card} aria-labelledby="integration-return-title">
      <span className={s.brand}>ImobFlow</span>
      <h1 id="integration-return-title">{result === 'failed' ? 'A conexão não foi concluída' : 'Continue na ImobFlow'}</h1>
      <p>{result === 'failed'
        ? reason ? instagramOAuthFailureMessage(reason) : 'Volte ao painel para conferir a conexão e tentar novamente.'
        : result === 'connected'
          ? ads
            ? 'A autorização foi recebida. Volte às campanhas para escolher a conta de anúncios e conferir a conexão.'
            : 'A autorização foi recebida. Volte ao painel para conferir a conexão da sua conta.'
          : 'Volte ao painel para conferir suas conexões com a Meta.'}</p>
      {reference && <p>Referência para suporte: <code>{reference}</code></p>}
      {/* A native link starts a fresh same-site document request, even without
          JavaScript, rather than reusing a prefetched unauthenticated CRM. */}
      <a className={s.continue} href={destination}>{label}<span aria-hidden="true">→</span></a>
    </section>
  </main>;
}
