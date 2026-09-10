import { notFound } from 'next/navigation';
import { publicCompany } from '@/lib/public-company';
import LandingClient from '../../landing-client';

export const dynamic = 'force-dynamic';
export default async function CompanyContactPage({params}:{params:Promise<{slug:string}>}) {
  const company = await publicCompany((await params).slug);
  if (!company) notFound();
  return <LandingClient companySlug={company.slug} companyName={company.name}/>;
}
