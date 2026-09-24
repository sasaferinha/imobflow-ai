import type { Metadata } from 'next';
import Presentation from './presentation';

export const metadata: Metadata = {
  title: 'Apresentação interativa — ImobFlow',
  description: 'Conheça a organização e o atendimento da ImobFlow, na prática.',
  robots: { index: false, follow: false },
};

export default function PresentationPage() { return <Presentation />; }
