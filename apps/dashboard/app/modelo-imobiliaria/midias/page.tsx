import type { Metadata } from 'next';
import MediaStudioDemo from './studio';

export const metadata: Metadata = { title: 'Estúdio de mídias · Demonstração | ImobFlow', robots: { index: false, follow: false } };
export default function MediaStudioPage() { return <MediaStudioDemo />; }
