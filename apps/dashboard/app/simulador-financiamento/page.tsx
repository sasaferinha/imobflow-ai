import type { Metadata } from 'next';
import FinancingCalculator from './calculator';
import { publicCompany } from '@/lib/public-company';

export const metadata: Metadata = {
  title:'Simulador de financiamento imobiliário | ImobFlow',
  description:'Simule seu financiamento imobiliário com renda familiar, entrada e valor do imóvel. Veja parcelas e uma estimativa para seu planejamento.',
};
export default async function FinancingPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams;
  let company: {name:string;slug:string} | null = null;
  if (empresa) {
    try { const found = await publicCompany(empresa); if (found) company = { name:found.name, slug:found.slug }; }
    catch { /* A public calculation remains available without sending personal data. */ }
  }
  return <FinancingCalculator company={company}/>;
}
