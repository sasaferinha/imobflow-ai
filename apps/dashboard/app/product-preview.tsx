'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import s from './product-preview.module.css';

const sections = [
  { title: 'Atende e entende o cliente', view: 'conversations', label: 'Atendimento com contexto', copy: 'A conversa começa no WhatsApp. A ImobFlow reúne o que o cliente procura para o corretor continuar com contexto.', status: 'Preferências na conversa', target: '.full-chat-head' },
  { title: 'Cataloga e organiza os leads', view: 'leads', label: 'Cada lead no seu lugar', copy: 'Compra ou aluguel, região, orçamento e responsável ficam organizados. Sua equipe encontra o perfil sem procurar em conversas antigas.', status: 'Leads catalogados', target: '.captured-profile dl' },
  { title: 'Encontra o match com o imóvel', view: 'opportunities', label: 'Perfil + imóvel = oportunidade', copy: 'O perfil do lead é cruzado com os imóveis disponíveis. A equipe visualiza as opções compatíveis e decide o próximo contato.', status: 'Oportunidades identificadas', target: 'article[id^="opportunity-"]' },
  { title: 'Mostra a operação em números', view: 'overview', label: 'Clareza para decidir', copy: 'Acompanhe leads, vendas e o desempenho da equipe em um só painel. Menos tempo reunindo informações, mais foco nos próximos passos.', status: 'Resultados reunidos', target: '.performance-kpis' },
];
const DURATION = 8500;
const FRAME_WIDTH = 1440;
const FRAME_HEIGHT = 960;

function subscribeMotion(notify: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}
function subscribeVisibility(notify: () => void) {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
}

export default function ProductPreview() {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const progress = useRef<HTMLSpanElement>(null);
  const elapsed = useRef(0);
  const activeRef = useRef(0);
  const readyRef = useRef(false);
  const [active, setActive] = useState(0);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const [confirmedView, setConfirmedView] = useState('');
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const [focus, setFocus] = useState<{ left: number; top: number; width: number; height: number; view: string } | null>(null);
  const [connector, setConnector] = useState('');
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia('(prefers-reduced-motion: reduce)').matches, () => true);
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => false);
  const running = playing && !reduced && inView && visible && ready && confirmedView === sections[active].view;
  const scale = width / FRAME_WIDTH;
  const section = sections[active];
  const showFocus = focus && focus.view === section.view && confirmedView === section.view;

  useEffect(() => {
    const element = viewport.current;
    const container = root.current;
    if (!element || !container) return;
    const resize = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    resize.observe(element);
    const intersection = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    intersection.observe(container);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== 'imobflow-demo-active') return;
      setConfirmedView(event.data.view);
      if (!readyRef.current) {
        readyRef.current = true;
        setReady(true);
        frame.current?.contentWindow?.postMessage({ type: 'imobflow-demo-view', view: sections[activeRef.current].view }, window.location.origin);
      }
    };
    window.addEventListener('message', receive);
    return () => { resize.disconnect(); intersection.disconnect(); window.removeEventListener('message', receive); };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    elapsed.current = 0;
    if (progress.current) progress.current.style.transform = 'scaleX(0)';
    if (ready) frame.current?.contentWindow?.postMessage({ type: 'imobflow-demo-view', view: sections[active].view }, window.location.origin);
  }, [active, ready]);

  useEffect(() => {
    if (!running) return;
    let previous = performance.now();
    let animation = 0;
    const tick = (now: number) => {
      elapsed.current += now - previous;
      previous = now;
      if (progress.current) progress.current.style.transform = `scaleX(${Math.min(1, elapsed.current / DURATION)})`;
      if (elapsed.current >= DURATION) {
        setActive(index => (index + 1) % sections.length);
        return;
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [running, active]);

  // Use the real panel's geometry, including its own scroll position.
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    const frameWindow = frame.current?.contentWindow;
    if (!ready || !doc || !frameWindow || !width || confirmedView !== section.view) return;
    let animation = 0;
    const measure = () => {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        const target = doc.querySelector(section.target);
        if (!target) { setFocus(null); return; }
        const initial = target.getBoundingClientRect();
        if (!initial.width || !initial.height) { setFocus(null); return; }
        const desiredScroll = section.view === 'opportunities' ? Math.max(0, initial.top + frameWindow.scrollY - 160) : 0;
        frameWindow.scrollTo({ top: desiredScroll, behavior: 'instant' });
        const rect = target.getBoundingClientRect();
        const left = Math.max(0, rect.left * scale);
        const top = Math.max(0, rect.top * scale);
        const right = Math.min(rect.right * scale, width);
        const bottom = Math.min(rect.bottom * scale, FRAME_HEIGHT * scale);
        setFocus(right > left && bottom > top ? { left, top, width: right - left, height: bottom - top, view: section.view } : null);
      });
    };
    const observer = new MutationObserver(measure);
    observer.observe(doc.body, { childList: true, subtree: true });
    const resize = new ResizeObserver(measure);
    resize.observe(doc.body);
    measure();
    return () => { cancelAnimationFrame(animation); observer.disconnect(); resize.disconnect(); };
  }, [ready, width, scale, section, confirmedView]);

  useEffect(() => {
    const container = root.current;
    const button = buttons.current[active];
    const screen = viewport.current;
    if (!container || !button || !screen || !focus) return;
    const update = () => {
      const base = container.getBoundingClientRect();
      const start = button.getBoundingClientRect();
      const end = screen.getBoundingClientRect();
      const x1 = start.right - base.left - 8;
      const y1 = start.top - base.top + start.height / 2;
      const x2 = end.left - base.left + focus.left;
      const y2 = end.top - base.top + focus.top + 18;
      setConnector(`M ${x1} ${y1} C ${x1 + 75} ${y1}, ${x2 - 75} ${y2}, ${x2} ${y2}`);
    };
    const resize = new ResizeObserver(update);
    resize.observe(container);
    update();
    return () => resize.disconnect();
  }, [active, focus]);

  function select(index: number) { setPlaying(false); setActive(index); }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % sections.length : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + sections.length - 1) % sections.length : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(next); buttons.current[next]?.focus();
  }

  return <div ref={root} className={s.showcase}>
    <div className={s.story}>
      <p className={s.eyebrow}>IMOBFLOW EM AÇÃO</p>
      <h2>Da conversa<br/><span>à oportunidade.</span></h2>
      <p className={s.intro}>Acompanhe cada parte da sua operação, etapa por etapa.</p>
      <div className={s.steps} role="tablist" aria-label="Etapas da demonstração">
        {sections.map((step, index) => <button key={step.view} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`demo-tab-${index}`} aria-controls="product-demo-panel" aria-selected={active === index} tabIndex={active === index ? 0 : -1} className={active === index ? s.activeStep : ''} onClick={() => select(index)} onKeyDown={event => navigate(event, index)}><span className={s.number}>0{index + 1}</span><span>{step.title}</span><i aria-hidden="true"/></button>)}
      </div>
      <div className={s.description} aria-live={running ? 'off' : 'polite'} aria-atomic="true"><div key={active} className={s.descriptionContent}><p>{section.copy}</p><span><i aria-hidden="true"/>{section.status}</span></div></div>
    </div>
    <div className={s.presentation}>
      <div className={s.screen}>
        <div className={s.screenBar}><span className={s.dots} aria-hidden="true"><i/><i/><i/></span><span>O painel da ImobFlow</span><span className={s.demoBadge}>Demonstração</span></div>
        <div ref={viewport} id="product-demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${active}`} className={s.viewport} style={{ aspectRatio: `${FRAME_WIDTH} / ${FRAME_HEIGHT}` }}>
          {!ready && <div className={s.loading} role="status"><span/>Preparando o painel…<a href="/demonstracao" target="_blank" rel="noopener noreferrer">Abrir demonstração completa ↗</a></div>}
          <div inert className={s.frameWrap}>
            {width > 0 && <iframe ref={frame} src="/demonstracao" title="Painel real da ImobFlow com dados fictícios" loading="lazy" tabIndex={-1} sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'" className={s.frame} style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `scale(${scale})` }} />}
          </div>
          {showFocus && <div className={s.focus} data-align={focus.left > width / 2 ? 'right' : 'left'} style={{ left: focus.left, top: focus.top, width: focus.width, height: focus.height }} aria-hidden="true"><span key={active}>{section.label}</span></div>}
        </div>
      </div>
      <div className={s.controls}>
        <button type="button" aria-label={playing && !reduced ? 'Pausar demonstração' : reduced ? 'Avançar demonstração' : 'Retomar demonstração'} onClick={() => reduced ? select((active + 1) % sections.length) : setPlaying(value => !value)}><span aria-hidden="true">{playing && !reduced ? 'Ⅱ' : '▶'}</span>{playing && !reduced ? 'Pausar demonstração' : reduced ? 'Próxima etapa' : 'Retomar demonstração'}</button>
        <div className={s.progressGroup} aria-label={`Etapa ${active + 1} de ${sections.length}`}><strong>0{active + 1}</strong><span>/ 04</span><div className={s.progress}><span ref={progress}/></div></div>
      </div>
      <div className={s.caption}><span>Painel real · dados fictícios</span><a href="/demonstracao" target="_blank" rel="noopener noreferrer">Explorar painel completo <span aria-hidden="true">↗</span></a></div>
    </div>
    {showFocus && <svg className={s.connector} aria-hidden="true"><path key={active} d={connector}/></svg>}
  </div>;
}
