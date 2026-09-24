'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import s from './business-landing.module.css';

const sections = [
  { title: 'Atendimento', view: 'conversations' },
  { title: 'Organização', view: 'leads' },
  { title: 'Resultados', view: 'overview' },
];

export default function ProductPreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(1040);
  const [loaded, setLoaded] = useState(false);
  const desktop = width > 760;
  const scale = desktop ? width / 1440 : 1;

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'imobflow-demo-height' && Number.isFinite(event.data.height)) {
        setHeight(Math.max(740, Math.min(6000, event.data.height)));
        setLoaded(true);
      }
      if (event.data?.type === 'imobflow-demo-active') {
        const view = event.data.view;
        setActive(['conversations', 'integrations'].includes(view) ? 0 : ['overview', 'goals'].includes(view) ? 2 : 1);
      }
    };
    window.addEventListener('message', receive);
    return () => { observer.disconnect(); window.removeEventListener('message', receive); };
  }, []);

  function select(index: number) {
    setActive(index);
    frame.current?.contentWindow?.postMessage({ type: 'imobflow-demo-view', view: sections[index].view }, window.location.origin);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
    if (next === null) return;
    event.preventDefault(); select(next); buttons.current[next]?.focus();
  }
  return <>
    <div className={s.tabStrip} role="tablist" aria-label="Explore a ImobFlow">{sections.map((section, index) =>
      <button key={section.view} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`demo-tab-${index}`} aria-controls="product-demo-panel" aria-selected={active === index} tabIndex={active === index ? 0 : -1} className={active === index ? s.activeTab : ''} onClick={() => select(index)} onKeyDown={event => navigate(event, index)}><span className={s.tabNumber}>0{index + 1}</span>{section.title}</button>
    )}</div>
    <div className={s.productFrame}>
      <div className={s.windowBar}><span className={s.windowDots} aria-hidden="true"><i/><i/><i/></span><span>O painel da ImobFlow</span><a className={s.fullDemo} href="/demonstracao" target="_blank" rel="noopener noreferrer">Abrir demonstração ↗</a></div>
      <div ref={viewport} id="product-demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${active}`} className={s.realPreviewViewport} style={{ height: Math.ceil(height * scale) }}>
        {!loaded && <p className={s.demoLoading} role="status">Carregando a demonstração do painel…</p>}
        {width > 0 && <iframe ref={frame} src="/demonstracao" title="Painel real da ImobFlow com dados fictícios" loading="lazy" sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'" className={s.realPreviewFrame} style={{ width: desktop ? 1440 : width, height, transform: `scale(${scale})` }} />}
      </div>
    </div>
    <p className={s.previewCaption}>Explore os menus do painel. Dados fictícios; envios e alterações desativados nesta demonstração.</p>
  </>;
}
