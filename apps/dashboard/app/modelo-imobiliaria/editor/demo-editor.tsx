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
  useEffect(() => {
    const frame = requestAnimationFrame(() => setData(readDemo()));
    return () => cancelAnimationFrame(frame);
  }, []);
  const transport = useMemo<WebsiteTransport>(() => ({
    load: async () => readDemo().snapshot,
    mutate: async command => { const current = readDemo(); const snapshot = applyDemoWebsiteMutation(current.snapshot, command); storeDemo({ ...current, snapshot }); return snapshot; },
    upload: async dataUrl => dataUrl,
  }), []);
  if (!data) return <main className={s.entry}><h1>Preparando a imobiliária fictícia…</h1><p role="status">A demonstração usa somente dados deste navegador.</p></main>;
  return <SiteEditor initial={data.snapshot} transport={transport} demo catalog={data.snapshot.properties} onSnapshot={snapshot => setData(current => ({ snapshot, unavailable: current?.unavailable || [] }))} />;
}
