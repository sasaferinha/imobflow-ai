'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicProperty, WebsiteSnapshot } from '@/lib/website/model';
import { DEMO_COMPANY, DEMO_STORAGE_KEY, demoContent, demoProperties, normalizeDemoProperties } from '@/lib/website/demo';
import SiteEditor, { validatedEditorContent, WebsiteRequestError, type WebsiteMutation, type WebsiteTransport } from '../../website/site-editor';
import s from '../../website/site-editor.module.css';

type DemoState = { snapshot: WebsiteSnapshot; unavailable: PublicProperty[] };
export function initialDemoSnapshot(): WebsiteSnapshot {
  return { company: { ...DEMO_COMPANY }, role: 'owner', properties: structuredClone(demoProperties), marketingAccounts: [], site: { version: 0, draft: structuredClone(demoContent), published: structuredClone(demoContent), publishedAt: null, updatedAt: null, previous: null } };
}
export function applyDemoWebsiteMutation(current: WebsiteSnapshot, command: WebsiteMutation, now = new Date().toISOString()): WebsiteSnapshot {
  if (command.expectedVersion !== current.site.version) throw new WebsiteRequestError('O site foi alterado em outra aba. Carregue a versão atual.', 409);
  const next = structuredClone(current);
  const previous = current.site.published;
  if (command.action === 'save' || command.action === 'publish') {
    const content = validatedEditorContent(command.content!, true);
    next.site.draft = content;
    if (command.action === 'publish') { next.site.previous = previous; next.site.published = structuredClone(content); next.site.publishedAt = now; }
  } else if (command.action === 'unpublish') {
    next.site.previous = previous || current.site.previous; next.site.published = null; next.site.publishedAt = null;
  } else if (command.action === 'restore') {
    if (!current.site.previous) throw new WebsiteRequestError('Ainda não há uma publicação anterior.', 400);
    next.site.previous = previous; next.site.published = structuredClone(current.site.previous); next.site.draft = structuredClone(current.site.previous); next.site.publishedAt = now;
  } else throw new WebsiteRequestError('Ação desconhecida.', 400);
  next.site.version++; next.site.updatedAt = now;
  return next;
}
export function readDemo(): DemoState {
  const fallback = { snapshot: initialDemoSnapshot(), unavailable: [] };
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    if (!saved.site || !Number.isSafeInteger(saved.site.version) || saved.site.version < 0 || !Array.isArray(saved.properties)) return fallback;
    const properties = normalizeDemoProperties(saved.properties);
    if (saved.properties.length !== properties.length || properties.length > 12) return fallback;
    const draft = validatedEditorContent(saved.site.draft, true);
    const published = saved.site.published ? validatedEditorContent(saved.site.published, true) : null;
    const previous = saved.site.previous ? validatedEditorContent(saved.site.previous, true) : null;
    const unavailable = normalizeDemoProperties(saved.unavailable);
    const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
    return { snapshot: { ...fallback.snapshot, site: { version: saved.site.version, draft, published, previous, publishedAt: timestamp(saved.site.publishedAt), updatedAt: timestamp(saved.site.updatedAt) }, properties }, unavailable: unavailable.slice(0, 12 - properties.length) };
  } catch { return fallback; }
}
function storeDemo(state: DemoState) {
  try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ site: state.snapshot.site, properties: state.snapshot.properties, unavailable: state.unavailable })); }
  catch { throw new Error('O navegador não conseguiu guardar a demonstração. Reduza as imagens ou libere espaço e tente novamente.'); }
  window.dispatchEvent(new Event('imobflow:website-demo'));
}

export default function DemoWebsiteEditor() {
  const [data, setData] = useState<DemoState | null>(null);
  const [generation, setGeneration] = useState(0);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const frame = requestAnimationFrame(() => setData(readDemo()));
    return () => cancelAnimationFrame(frame);
  }, []);
  const transport = useMemo<WebsiteTransport>(() => ({
    load: async () => readDemo().snapshot,
    mutate: async command => { const current = readDemo(); const snapshot = applyDemoWebsiteMutation(current.snapshot, command); storeDemo({ ...current, snapshot }); return snapshot; },
    upload: async dataUrl => dataUrl,
  }), []);
  function changeCatalog(action: 'price' | 'sold' | 'restore' | 'add', id?: string, price?: number) {
    if (!data) return;
    const current = readDemo(); const next = structuredClone(current);
    if (action === 'price') { const property = next.snapshot.properties.find(item => item.id === id); if (!property || price === undefined || !Number.isFinite(price) || price < 0) { setFeedback('Informe um preço válido.'); return; } property.price = price; }
    if (action === 'sold') { const property = next.snapshot.properties.find(item => item.id === id); if (!property) return; next.unavailable.push(property); next.snapshot.properties = next.snapshot.properties.filter(item => item.id !== id); }
    if (action === 'restore') { const property = next.unavailable.find(item => item.id === id); if (!property) return; next.snapshot.properties.push(property); next.unavailable = next.unavailable.filter(item => item.id !== id); }
    if (action === 'add') { if (next.snapshot.properties.length + next.unavailable.length >= 12) { setFeedback('A demonstração comporta até 12 imóveis. Reinicie para testar novamente.'); return; } const property = structuredClone(demoProperties[0]); const number = next.snapshot.properties.length + next.unavailable.length + 101; property.id = `demo-added-${number}`; property.code = `HOR-${number}`; property.title = 'Novo imóvel de demonstração'; next.snapshot.properties.push(property); }
    try { storeDemo(next); setData(next); setFeedback(action === 'sold' ? 'Vendido: o imóvel saiu do catálogo. O histórico da demonstração foi preservado.' : action === 'restore' ? 'Imóvel disponível novamente no catálogo.' : action === 'add' ? 'Novo imóvel disponível no catálogo.' : 'Preço atualizado no catálogo. Não é preciso publicar o conteúdo novamente.'); }
    catch (issue) { setFeedback(issue instanceof Error ? issue.message : 'Não foi possível atualizar a demonstração.'); }
  }
  if (!data) return <main className={s.entry}><h1>Preparando a imobiliária fictícia…</h1><p role="status">A demonstração usa somente dados deste navegador.</p></main>;
  return <>
    <SiteEditor key={generation} initial={data.snapshot} transport={transport} demo catalog={data.snapshot.properties} onSnapshot={snapshot => setData(current => ({ snapshot, unavailable: current?.unavailable || [] }))} />
    <section className={s.demoControls} aria-label="Testar sincronização do catálogo"><h2>Experimente o catálogo conectado</h2><p>Simule o que acontece no CRM. Altere um preço ou marque um imóvel como vendido e abra o site de demonstração para conferir.</p><div className={s.demoProperties}>{data.snapshot.properties.map(property => <DemoProperty key={`${property.id}-${property.price}`} property={property} onPrice={price => changeCatalog('price', property.id, price)} onSold={() => changeCatalog('sold', property.id)} />)}</div>{data.unavailable.length > 0 && <details><summary>Imóveis vendidos na demonstração ({data.unavailable.length})</summary>{data.unavailable.map(property => <div className={s.demoProperty} key={property.id}><strong>{property.title}</strong><button type="button" onClick={() => changeCatalog('restore', property.id)}>Voltar a disponibilizar</button></div>)}</details>}<div className={s.demoActions}><button type="button" onClick={() => changeCatalog('add')}>Cadastrar imóvel fictício</button><button type="button" onClick={() => { if (!window.confirm('Reiniciar o site fictício e descartar os testes deste navegador?')) return; const next = { snapshot: initialDemoSnapshot(), unavailable: [] }; try { storeDemo(next); setData(next); setGeneration(value => value + 1); setFeedback('Demonstração reiniciada.'); } catch (issue) { setFeedback(issue instanceof Error ? issue.message : 'Não foi possível reiniciar.'); } }}>Reiniciar demonstração</button></div>{feedback && <p className={s.demoFeedback} role="status">{feedback}</p>}</section>
  </>;
}
function DemoProperty({ property, onPrice, onSold }: { property: PublicProperty; onPrice: (price: number) => void; onSold: () => void }) {
  const [price, setPrice] = useState(String(property.price));
  return <article className={s.demoProperty}><strong>{property.title}</strong><form onSubmit={event => { event.preventDefault(); if (price.trim()) onPrice(Number(price)); }}><label>Preço (R$)<input aria-label={`Preço de ${property.title}`} type="number" min="0" step="0.01" required value={price} onChange={event => setPrice(event.target.value)} /></label><button type="submit">Atualizar preço</button><button type="button" onClick={onSold}>Marcar vendido</button></form></article>;
}
