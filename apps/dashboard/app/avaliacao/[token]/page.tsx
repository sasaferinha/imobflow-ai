import type { Metadata } from 'next';
import FeedbackForm from './feedback-form';

export const metadata: Metadata = { title: 'Avaliação do imóvel', description: 'Compartilhe sua opinião com a imobiliária que realizou seu atendimento.', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function PropertyFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FeedbackForm token={token} />;
}
