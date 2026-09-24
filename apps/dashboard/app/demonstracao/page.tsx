import type { Metadata } from 'next';
import ProductDemo from './product-demo';

export const metadata: Metadata = {
  title: 'Conheça o painel — ImobFlow',
  robots: { index: false, follow: false },
};

export default function DemonstrationPage() {
  return <ProductDemo />;
}
