import type { Metadata } from 'next';
import { LiveWebsiteEditor } from '../../website/site-editor';

export const metadata: Metadata = { title: 'Editor do site | ImobFlow', robots: { index: false, follow: false } };
export default function WebsiteEditorPage() { return <LiveWebsiteEditor />; }
