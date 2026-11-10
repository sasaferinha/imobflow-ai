'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import PublicSite from '../website/public-site';
import { DEMO_COMPANY, DEMO_STORAGE_KEY, demoContent, demoProperties, normalizeDemoProperties, safeDemoImageUrl } from '@/lib/website/demo';
import { validateSiteContent, type PublicProperty, type SiteContent } from '@/lib/website/model';
import { DEMO_PROPERTY_MEDIA_EVENT, DEMO_PROPERTY_MEDIA_PING, loadDemoPropertyMedia, type DemoPropertyMediaMap } from '@/lib/website/demo-property-media';
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
  const [media, setMedia] = useState<{ items: DemoPropertyMediaMap; videos: Record<string, string> }>({ items: {}, videos: {} });
  useEffect(() => {
    let stopped = false, sequence = 0;
    let objectUrls: string[] = [];
    async function reloadMedia() {
      const request = ++sequence;
      try {
        const items = await loadDemoPropertyMedia();
        if (stopped || request !== sequence) return;
        const nextUrls: string[] = [], videos: Record<string, string> = {};
        try {
          for (const [id, item] of Object.entries(items)) if (item.video) {
            const url = URL.createObjectURL(item.video); nextUrls.push(url); videos[id] = url;
          }
        } catch { nextUrls.forEach(url => URL.revokeObjectURL(url)); return; }
        const previous = objectUrls;
        objectUrls = nextUrls;
        setMedia({ items, videos });
        previous.forEach(url => URL.revokeObjectURL(url));
      } catch { /* An unavailable local store never removes the original demo catalogue. */ }
    }
    const onChange = () => { void reloadMedia(); };
    const onStorage = (event: StorageEvent) => { if (event.key === DEMO_PROPERTY_MEDIA_PING || event.key === null) onChange(); };
    void reloadMedia();
    window.addEventListener(DEMO_PROPERTY_MEDIA_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onChange);
    return () => {
      stopped = true; sequence++;
      window.removeEventListener(DEMO_PROPERTY_MEDIA_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onChange);
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);
  const properties = useMemo(() => current.properties.map(property => ({ ...property, images: property.images.map((image, index) => media.items[property.id]?.photos[String(index)] || image) })), [current.properties, media.items]);
  if (!current.content) return <main className={s.site}><div className={s.notice}>Modelo demonstrativo · nenhuma empresa real foi alterada</div><section className={s.empty}><h1>Site da demonstração fora do ar</h1><p>Você retirou este site de demonstração do ar. Volte ao editor para publicar novamente.</p><a href="/modelo-imobiliaria/editor" className={s.primary}>Abrir painel do site</a></section></main>;
  return <PublicSite content={current.content} properties={properties} companySlug={DEMO_COMPANY.slug} demo demoPropertyVideos={media.videos} />;
}
