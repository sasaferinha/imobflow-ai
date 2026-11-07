import type { Metadata } from 'next';
import DemoWebsiteEditor from './demo-editor';

export const metadata: Metadata = { title: 'Experimente o editor de sites | ImobFlow', robots: { index: false, follow: false } };
export default function DemoWebsiteEditorPage() { return <DemoWebsiteEditor />; }
