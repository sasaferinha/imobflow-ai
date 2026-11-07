import type { Metadata } from 'next';
import { LiveWebsiteEditor } from '../../website/site-editor';

export const metadata: Metadata = { title: 'Editar site | ImobFlow', robots: { index: false, follow: false } };
export default function MarketingWebsitePage() { return <LiveWebsiteEditor marketing />; }
