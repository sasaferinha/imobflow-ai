import type { Metadata } from 'next';
import FeedbackForm from './feedback-form';

export const metadata: Metadata = { title: 'Avalie sua experiência | ImobFlow', description: 'Compartilhe sua opinião sobre a visita e o imóvel.', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function PropertyFeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FeedbackForm token={token} />;
}
