import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { assertPublicWebsiteHost } from '@/lib/website/domains-routing';
import { isCoreWebsiteHost, requestHostname } from '@/lib/website/domains-host';
import { publicCompany } from '@/lib/public-company';
import { getPublicWebsite, hasWebsitePublication } from '@/lib/website/server';
import LandingClient from '../../landing-client';
import PublicSite from '../../website/public-site';
import s from '../../website/public-site.module.css';

export const dynamic = 'force-dynamic';
const loadSite = cache(getPublicWebsite);
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    await assertPublicWebsiteHost(await headers(), slug);
    const site = await loadSite(slug);
    const company = site?.company || await publicCompany(slug);
    if (!company) return { title: 'Imobiliária não encontrada', robots: { index: false } };
    const title = site?.content.brandName || company.name;
    const description = site?.content.heroText || `Encontre seu próximo imóvel com a ${company.name}.`;
    const images = site?.content.heroImageUrl ? [{ url: site.content.heroImageUrl, alt: title }] : [];
    const withdrawn = !site && (!isCoreWebsiteHost(requestHostname(await headers())) || await hasWebsitePublication(company.id));
    return { title, description, ...(withdrawn ? { robots: { index: false, follow: false } } : {}), openGraph: { title, description, images }, twitter: { title, description, images } };
  } catch { return { title: 'Site da imobiliária', robots: { index: false } }; }
}

export default async function CompanyContactPage({ params }: Props) {
  const { slug } = await params;
  try { await assertPublicWebsiteHost(await headers(), slug); } catch { notFound(); }
  const site = await loadSite(slug);
  if (site) return <PublicSite content={site.content} properties={site.properties} companySlug={site.company.slug} />;
  const company = await publicCompany(slug);
  if (!company) notFound();
  if (!isCoreWebsiteHost(requestHostname(await headers())) || await hasWebsitePublication(company.id)) return <main className={s.site}><section className={s.empty}><p className={s.eyebrow}>{company.name}</p><h1>Site temporariamente indisponível</h1><p>A imobiliária está atualizando este espaço. Tente novamente mais tarde.</p></section></main>;
  // Preserve the pre-existing contact page until this company's owner publishes its website.
  return <LandingClient companySlug={company.slug} companyName={company.name}/>;
}
