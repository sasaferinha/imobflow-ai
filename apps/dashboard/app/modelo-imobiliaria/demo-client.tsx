'use client';

import { useMemo, useSyncExternalStore } from 'react';
import PublicSite from '../website/public-site';
import { DEMO_COMPANY, DEMO_STORAGE_KEY, demoContent, demoProperties, normalizeDemoProperties, safeDemoImageUrl } from '@/lib/website/demo';
import { validateSiteContent, type PublicProperty, type SiteContent } from '@/lib/website/model';
import s from '../website/public-site.module.css';

const read = () => { try { return window.localStorage.getItem(DEMO_STORAGE_KEY); } catch { return null; } };
const serverSnapshot = () => null;
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener('imobflow:website-demo', listener);
  window.addEventListener('pageshow', listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener('imobflow:website-demo', listener); window.removeEventListener('pageshow', listener); };
}
/** Storage is untrusted. Drafts never enter the public demo, and unsafe URLs never reach its DOM. */
export function readDemoPublicState(raw: string | null): { content: SiteContent | null; properties: PublicProperty[] } {
  const fallback = { content: demoContent, properties: demoProperties };
  if (!raw || raw.length > 10_000_000) return fallback;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || !saved.site || !Array.isArray(saved.properties)) return fallback;
    if (saved.site.published === null) return { content: null, properties: [] };
    const published = saved.site.published;
    if (!published || typeof published !== 'object') return fallback;
    const imageFields = { logoUrl: published.logoUrl, heroImageUrl: published.heroImageUrl, promotionImage: published.promotion?.imageUrl };
    const content = validateSiteContent({ ...published, logoUrl: '', heroImageUrl: '', promotion: { ...published.promotion, imageUrl: '' } });
    content.logoUrl = safeDemoImageUrl(imageFields.logoUrl);
    content.heroImageUrl = safeDemoImageUrl(imageFields.heroImageUrl);
    content.promotion.imageUrl = safeDemoImageUrl(imageFields.promotionImage);
    const properties = normalizeDemoProperties(saved.properties);
    return { content, properties };
  } catch { return fallback; }
}

export default function DemoWebsite() {
  const stored = useSyncExternalStore(subscribe, read, serverSnapshot);
  const current = useMemo(() => readDemoPublicState(stored), [stored]);
  if (!current.content) return <main className={s.site}><div className={s.notice}>Modelo demonstrativo · nenhuma empresa real foi alterada</div><section className={s.empty}><h1>Site da demonstração fora do ar</h1><p>Você retirou este site de demonstração do ar. Volte ao editor para publicar novamente.</p><a href="/modelo-imobiliaria/editor" className={s.primary}>Abrir painel do site</a></section></main>;
  return <PublicSite content={current.content} properties={current.properties} companySlug={DEMO_COMPANY.slug} demo />;
}
