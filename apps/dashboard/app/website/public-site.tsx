'use client';

/* A tenant may use its own HTTPS image host. Native images keep that choice independent of Next's host allowlist. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { safeWebsiteUrl, videoEmbedUrl, type PublicProperty, type SiteContent } from '@/lib/website/model';
import s from './public-site.module.css';

type Props = { content: SiteContent; properties: PublicProperty[]; companySlug: string; demo?: boolean; preview?: boolean };
const money = (amount: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(amount);
const searchText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const safeLink = (url: string) => { try { return safeWebsiteUrl(url); } catch { return ''; } };

export function filterPublicProperties(properties: PublicProperty[], filters: { purpose: string; city: string; query: string }) {
  const query = searchText(filters.query.trim());
  return properties.filter(property => (!filters.purpose || property.purpose === filters.purpose)
    && (!filters.city || property.city === filters.city)
    && (!query || searchText([property.title, property.code, property.district, property.city, property.propertyType].join(' ')).includes(query)));
}

function HouseMark() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 15 13-11 13 11M7 12v15h7v-8h5v8h6V12" /><path d="M24 5v5" /></svg>;
}

function PropertyFacts({ property }: { property: PublicProperty }) {
  return <div className={s.facts}>
    {property.area > 0 && <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4M7 7l6 6m0-6-6 6" /></svg>{property.area.toLocaleString('pt-BR')} m²</span>}
    {property.bedrooms > 0 && <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16V7h14v9M3 13h14M5 7V4h10v3M8 4v3" /></svg>{property.bedrooms} quartos</span>}
    {property.parkingSpaces > 0 && <span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 9 2-5h8l2 5M3 9h14v6H3zM5 15v2m10-2v2M5 12h2m6 0h2" /></svg>{property.parkingSpaces} vagas</span>}
  </div>;
}

function Picture({ src, alt, className, priority = false }: { src?: string; alt: string; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState('');
  const image = src && (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length <= 2_900_000 ? src : safeLink(src));
  if (!image || failed === image) return <div className={`${s.placeholder} ${className || ''}`} role="img" aria-label={alt}><HouseMark /><span>Seu próximo lugar</span></div>;
  return <img src={image} alt={alt} className={className} loading={priority ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(image)} />;
}

function PropertyDialog({ property, content, companySlug, demo, preview, close }: { property: PublicProperty; content: SiteContent; companySlug: string; demo: boolean; preview: boolean; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [photo, setPhoto] = useState(0);
  const photoIndex = Math.min(photo, Math.max(0, property.images.length - 1));
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); previousFocus?.focus(); };
  }, []);
  async function inquire(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || sent) return;
    if (demo || preview) { setSent(true); return; }
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams(window.location.search);
    const attribution = Object.fromEntries(Object.entries({ utm_source:100, utm_medium:100, utm_campaign:150, utm_content:150, utm_term:150 }).flatMap(([key,limit]) => { const value = query.get(key); return value && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value) ? [[key,value]] : []; }));
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/site/${encodeURIComponent(companySlug)}/inquiry`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attribution, propertyId: property.id, name: String(data.get('name') || ''), phone: String(data.get('phone') || ''), email: String(data.get('email') || ''), details: String(data.get('details') || '') }),
      });
      const result = await response.json().catch(() => ({})) as { error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Não foi possível enviar seu interesse. Tente novamente.');
      setSent(true);
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Confira sua conexão e tente novamente.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  const features = property.features.split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="property-title" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={s.dialogInner}>
      <button type="button" className={s.close} aria-label="Fechar detalhes do imóvel" onClick={close}>×</button>
      <div className={s.gallery}>
        <Picture key={property.images[photoIndex]} src={property.images[photoIndex]} alt={`${property.title} — foto ${photoIndex + 1}`} className={s.detailPhoto} priority />
        {property.images.length > 1 && <div className={s.thumbnails} aria-label="Fotos do imóvel">{property.images.map((src, index) => <button type="button" key={`${src}-${index}`} aria-label={`Ver foto ${index + 1}`} aria-pressed={photoIndex === index} onClick={() => setPhoto(index)}><Picture src={src} alt="" /></button>)}</div>}
      </div>
      <div className={s.detailBody}>
        <div className={s.detailInfo}>
          <span className={s.eyebrow}>{property.purpose === 'Venda' ? 'À venda' : 'Para alugar'} · Ref. {property.code}</span>
          <h2 id="property-title">{property.title}</h2>
          <p className={s.location}>{[property.district, property.city].filter(Boolean).join(' · ')}</p>
          <PropertyFacts property={property} />
          {content.showPrices && <p className={s.detailPrice}>{money(property.price)}{property.purpose === 'Aluguel' && <small> / mês</small>}</p>}
          {property.description && <div className={s.description}><h3>Conheça este imóvel</h3><p>{property.description}</p></div>}
          {features.length > 0 && <div className={s.description}><h3>O que faz parte</h3><ul className={s.features}>{features.map((feature, index) => <li key={`${feature}-${index}`}>{feature}</li>)}</ul></div>}
        </div>
        <section className={s.inquiry} aria-label="Tenho interesse neste imóvel">
          {sent ? <div role="status" className={s.success}><span>✓</span><h3>{demo || preview ? 'Interesse simulado!' : 'Recebemos seu interesse!'}</h3><p>{demo || preview ? 'Esta é uma demonstração. Nenhum dado foi enviado e nenhum atendimento foi criado.' : `A equipe da ${content.brandName} recebeu seu contato e poderá continuar o atendimento com você.`}</p><button type="button" className={s.secondary} onClick={close}>Voltar aos imóveis</button></div> : <>
            <span className={s.eyebrow}>Vamos conversar?</span><h3>Este pode ser o seu novo lugar.</h3><p>Deixe seu contato para saber mais ou combinar uma visita.</p>
            <form onSubmit={inquire}>
              <fieldset className={s.inquiryFields} disabled={busy}>
              <label>Seu nome<input name="name" autoComplete="name" required maxLength={120} placeholder="Como podemos chamar você?" /></label>
              <label>Telefone / WhatsApp<input name="phone" type="tel" autoComplete="tel" required minLength={8} maxLength={30} placeholder="(00) 00000-0000" /></label>
              <label>E-mail <small>(opcional)</small><input name="email" type="email" autoComplete="email" maxLength={160} placeholder="voce@exemplo.com" /></label>
              <label>Mensagem <small>(opcional)</small><textarea name="details" rows={3} maxLength={1000} placeholder="Conte o que gostaria de saber." /></label>
              {error && <p className={s.error} role="alert">{error}</p>}
              <button type="submit" className={s.primary} disabled={busy}>{busy ? 'Enviando…' : demo || preview ? 'Simular interesse' : 'Quero saber mais'} <span aria-hidden="true">↗</span></button>
              <small className={s.formNote}>{demo || preview ? 'Use dados fictícios. Esta demonstração não envia contatos.' : 'Seus dados serão usados pela imobiliária para responder a esta solicitação.'}</small>
              </fieldset>
            </form>
          </>}
        </section>
      </div>
    </div>
  </dialog>;
}

export default function PublicSite(props: Props) {
  const [live, setLive] = useState<{ slug: string; content: SiteContent; properties: PublicProperty[] } | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  useEffect(() => {
    if (props.demo || props.preview) return;
    let stopped = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/site/${encodeURIComponent(props.companySlug)}`, { cache: 'no-store', signal: controller.signal });
        if (stopped) return;
        if (response.status === 404) { setUnavailable(props.companySlug); setLive(null); return; }
        if (!response.ok) return;
        const data = await response.json() as { content?: SiteContent; properties?: PublicProperty[] };
        if (!stopped && data?.content && Array.isArray(data.properties)) { setLive({ slug: props.companySlug, content: data.content, properties: data.properties }); setUnavailable(null); }
      } catch { /* Preserve the last confirmed catalogue during a temporary network failure. */ }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [props.companySlug, props.demo, props.preview]);
  if (unavailable === props.companySlug && !props.demo && !props.preview) return <div className={s.site}><div className={s.empty}><HouseMark /><h1>Site temporariamente indisponível</h1><p>A imobiliária está atualizando este espaço. Tente novamente mais tarde.</p></div></div>;
  const current = !props.demo && !props.preview && live?.slug === props.companySlug ? live : props;
  return <SiteView {...props} content={current.content} properties={current.properties} />;
}

function SiteView({ content, properties, companySlug, demo = false, preview = false }: Props) {
  const [purpose, setPurpose] = useState('');
  const [city, setCity] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const filtered = filterPublicProperties(properties, { purpose, city, query });
  const selected = properties.find(property => property.id === selectedId);
  const cities = [...new Set(properties.map(property => property.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const phone = content.contactPhone.replace(/\D/g, '');
  let video = '';
  try { if (content.video.enabled) video = videoEmbedUrl(content.video.url); } catch { /* An editor can preview an incomplete video URL safely. */ }
  const fileVideo = /\.(mp4|webm)(?:\?|$)/i.test(content.video.url);
  const hasContact = Boolean(content.contactPhone || content.contactEmail || content.contactAddress || content.instagramUrl);
  // Old published documents and already-open previews remain on the original layout.
  const layout = content.layout === 'modern' || content.layout === 'catalog' ? content.layout : 'classic';
  const layoutClass = layout === 'modern' ? s.modern : layout === 'catalog' ? s.catalogLayout : '';
  const style = { '--site-brand': /^#[a-f0-9]{6}$/i.test(content.primaryColor) ? content.primaryColor : '#184D42' } as CSSProperties;
  return <div className={`${s.site}${layoutClass ? ` ${layoutClass}` : ''}`} data-site-layout={layout} style={style}>
    {(demo || preview) && <div className={s.notice} role="note"><span>{preview ? 'Prévia do site · alterações ainda não publicadas' : 'Modelo demonstrativo · empresa, imóveis e valores fictícios'}</span>{demo && !preview && <a href="/modelo-imobiliaria/editor">Experimentar painel do site <span aria-hidden="true">↗</span></a>}</div>}
    <header className={s.header}>
      <a href="#inicio" className={s.brand} aria-label={`${content.brandName} — início`}>
        {content.logoUrl ? <Picture src={content.logoUrl} alt="" className={s.logo} /> : <span className={s.brandMark}><HouseMark /></span>}
        <span><strong>{content.brandName}</strong>{content.tagline && <small>{content.tagline}</small>}</span>
      </a>
      <button type="button" className={s.menuButton} aria-label="Menu do site" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>☰</button>
      <nav className={menuOpen ? s.navOpen : s.nav} aria-label="Navegação do site">
        <a href="#imoveis" onClick={() => setMenuOpen(false)}>Encontre seu imóvel</a>
        {content.aboutText && <a href="#sobre" onClick={() => setMenuOpen(false)}>Sobre nós</a>}
        <a href={hasContact ? '#contato' : '#imoveis'} className={s.headerContact} onClick={() => setMenuOpen(false)}>Fale com a gente <span aria-hidden="true">↗</span></a>
      </nav>
    </header>

    <main>
      <section className={s.hero} id="inicio">
        <div className={s.heroCopy}><p className={s.eyebrow}><span className={s.smallLine} /> O seu próximo capítulo</p><h1>{content.heroTitle}</h1><p>{content.heroText}</p><a href="#imoveis" className={s.heroLink}>Descubra seu próximo imóvel <span aria-hidden="true">↓</span></a></div>
        <div className={s.heroVisual}><Picture key={content.heroImageUrl} src={content.heroImageUrl} alt={`Encontre seu próximo imóvel com a ${content.brandName}`} priority /><span className={s.photoCaption}>{content.tagline || 'Um lugar para viver novas histórias.'}</span></div>
      </section>

      <section className={s.catalog} id="imoveis" aria-labelledby="catalog-title">
        <div className={s.sectionHeading}><div><p className={s.eyebrow}>Encontre o que combina com você</p><h2 id="catalog-title">Seu próximo endereço.</h2></div><span className={s.resultCount} aria-live="polite">{filtered.length} {filtered.length === 1 ? 'imóvel disponível' : 'imóveis disponíveis'}</span></div>
        <form className={s.search} onSubmit={event => event.preventDefault()} role="search" aria-label="Buscar imóveis">
          <label><span>Eu quero</span><select value={purpose} onChange={event => setPurpose(event.target.value)}><option value="">Comprar ou alugar</option><option value="Venda">Comprar</option><option value="Aluguel">Alugar</option></select></label>
          <label><span>Onde?</span><select value={city} onChange={event => setCity(event.target.value)}><option value="">Todas as cidades</option>{cities.map(item => <option key={item}>{item}</option>)}</select></label>
          <label className={s.searchText}><span>O que você procura?</span><input value={query} maxLength={160} onChange={event => setQuery(event.target.value)} placeholder="Bairro, tipo de imóvel ou código" /></label>
          <button type="button" className={s.reset} onClick={() => { setPurpose(''); setCity(''); setQuery(''); }} disabled={!purpose && !city && !query}>Limpar filtros</button>
        </form>
        {filtered.length > 0 ? <div className={s.grid}>{filtered.map(property => <article className={s.card} key={property.id}>
          <button type="button" className={s.cardPhoto} onClick={() => setSelectedId(property.id)} aria-label={`Ver detalhes: ${property.title}`}><Picture src={property.images[0]} alt={property.title} /><span className={s.purpose}>{property.purpose === 'Venda' ? 'À venda' : 'Para alugar'}</span><span className={s.photoAction} aria-hidden="true">↗</span></button>
          <div className={s.cardBody}><p className={s.location}>{[property.district, property.city].filter(Boolean).join(' · ') || property.propertyType}</p><h3><button type="button" onClick={() => setSelectedId(property.id)}>{property.title}</button></h3><PropertyFacts property={property} /><div className={s.cardBottom}><strong>{content.showPrices ? money(property.price) : 'Consulte o valor'}{content.showPrices && property.purpose === 'Aluguel' && <small> / mês</small>}</strong><span>Ref. {property.code}</span></div></div>
        </article>)}</div> : <div className={s.empty}><HouseMark /><h3>{properties.length ? 'Ainda não encontramos essa combinação.' : 'Novas oportunidades estão chegando.'}</h3><p>{properties.length ? 'Experimente outro bairro ou limpe os filtros para ver todos os imóveis.' : 'Fale com a nossa equipe e conte o que você procura.'}</p>{properties.length > 0 && <button type="button" className={s.secondary} onClick={() => { setPurpose(''); setCity(''); setQuery(''); }}>Ver todos os imóveis</button>}</div>}
      </section>

      {content.promotion.enabled && <section className={s.promotion} aria-labelledby="promotion-title"><div><p className={s.eyebrow}>Em destaque</p><h2 id="promotion-title">{content.promotion.title}</h2><p>{content.promotion.text}</p><a className={s.primary} href={safeLink(content.promotion.linkUrl) || '#imoveis'}>{content.promotion.linkLabel || 'Saiba mais'} <span aria-hidden="true">↗</span></a></div>{content.promotion.imageUrl && <Picture key={content.promotion.imageUrl} src={content.promotion.imageUrl} alt={content.promotion.title} />}</section>}

      {content.video.enabled && video && <section className={s.videoSection} aria-labelledby="video-title"><div className={s.sectionHeading}><div><p className={s.eyebrow}>Conheça de perto</p><h2 id="video-title">{content.video.title || 'Um novo olhar para o seu próximo lugar.'}</h2></div></div><div className={s.video}>{fileVideo ? <video controls preload="metadata" src={content.video.url} aria-label={content.video.title || 'Vídeo da imobiliária'} /> : <iframe src={video} title={content.video.title || 'Vídeo da imobiliária'} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />}</div></section>}

      {content.aboutText && <section className={s.about} id="sobre"><div><span className={s.brandMark}><HouseMark /></span><p className={s.eyebrow}>{content.brandName}</p></div><div><h2>{content.aboutTitle || 'Perto de você em cada etapa.'}</h2><p>{content.aboutText}</p></div></section>}
    </main>
    <footer className={s.footer} id="contato"><div className={s.footerTop}><div><a href="#inicio" className={s.brand}><span className={s.brandMark}><HouseMark /></span><strong>{content.brandName}</strong></a><p>{content.tagline}</p></div><div className={s.contact}><h2>Vamos encontrar seu próximo lugar?</h2>{content.contactPhone && <a href={demo || preview ? '#imoveis' : `tel:+${phone}`}>{content.contactPhone}</a>}{content.contactEmail && <a href={demo || preview ? '#imoveis' : `mailto:${content.contactEmail}`}>{content.contactEmail}</a>}{content.contactAddress && <p>{content.contactAddress}</p>}{content.instagramUrl && safeLink(content.instagramUrl) && <a href={safeLink(content.instagramUrl)} target="_blank" rel="noopener noreferrer">Instagram ↗</a>}{!hasContact && <a href="#imoveis">Escolha um imóvel para falar com a equipe ↗</a>}</div></div><div className={s.footerBottom}><span>{demo ? 'Empresa e imóveis fictícios. Fotografias ilustrativas.' : `${content.brandName} · Imóveis sujeitos à disponibilidade.`}</span><a href="https://www.imobflow.net.br" target="_blank" rel="noopener noreferrer">Site conectado à <strong>ImobFlow ↗</strong></a></div></footer>
    {selected && <PropertyDialog key={selected.id} property={selected} content={content} companySlug={companySlug} demo={demo} preview={preview} close={() => setSelectedId(null)} />}
  </div>;
}
