'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { chapters, cleanCopies, isChapter, storageKey, type ChapterId, type Copy } from './content';
import s from './presentation.module.css';

export default function Presentation() {
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [active, setActive] = useState<ChapterId>('overview');
  const [copies, setCopies] = useState<Partial<Record<ChapterId, Copy>>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Copy | null>(null);
  const [shown, setShown] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const [status, setStatus] = useState('');
  const index = chapters.findIndex(chapter => chapter.id === active);
  const chapter = chapters[index];
  const copy = copies[active] ?? chapter;
  // Keep the real desktop breakpoints inside the frame; shrink the entire
  // interface rather than switching the embedded panel to tablet/mobile layout.
  const panelWidth = Math.max(1440, width);
  const scale = width > 0 ? width / panelWidth : 1;

  function navigate(id: ChapterId) {
    frame.current?.contentWindow?.postMessage({ type: 'imobflow-demo-view', view: id }, window.location.origin);
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { setCopies(cleanCopies(JSON.parse(localStorage.getItem(storageKey) ?? '{}'))); } catch { setStatus('Os textos salvos não puderam ser carregados. Usando o roteiro original.'); }
    });
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (stage.current) observer.observe(stage.current);
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== 'imobflow-demo-active' || !isChapter(event.data.view)) return;
      setReady(true);
      if (!initialized.current) { initialized.current = true; navigate('overview'); return; }
      setActive(event.data.view);
      setEditing(false);
    };
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === root.current);
    window.addEventListener('message', receive);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => { active = false; observer.disconnect(); window.removeEventListener('message', receive); document.removeEventListener('fullscreenchange', syncFullscreen); };
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen();
      else setStatus('Use a opção de tela cheia do seu navegador.');
    } catch { setStatus('Não foi possível abrir a tela cheia. Use a opção do navegador.'); }
  }

  function save(reset = false) {
    const next = { ...copies };
    if (reset) delete next[active];
    else if (draft) next[active] = draft;
    setCopies(next); setEditing(false);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStatus(reset ? 'Texto original restaurado nesta seção.' : 'Texto salvo neste navegador.'); }
    catch { setStatus('Texto aplicado, mas o navegador não permitiu salvá-lo. Ele será perdido ao fechar.'); }
  }

  return <div className={s.root} ref={root}>
    <header className={s.header}>
      <Link href="/" className={s.brand} aria-label="ImobFlow — página inicial"><svg viewBox="0 0 32 44" width="24" height="33" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 41V24l8-4v21M11 20V7l12-5v39M23 16h6v25"/></svg><strong>ImobFlow</strong></Link>
      <span className={s.mode}>Apresentação interativa</span>
      <div className={s.actions}><button type="button" aria-expanded={shown} aria-controls="presentation-copy" onClick={() => setShown(!shown)}>{shown ? 'Ocultar explicação' : 'Mostrar explicação'}</button><button type="button" onClick={toggleFullscreen}>{fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}</button></div>
    </header>
    <div className={s.workspace}>
      <section className={s.product} aria-label="Explore o painel de administrador">
        <div className={s.toolbar}><span><i aria-hidden="true"/> Painel de administrador</span><span>Dados fictícios · sem envios reais</span></div>
        <div ref={stage} className={s.stage}>
          {!ready && <p className={s.loading} role="status">Carregando o painel…</p>}
          <iframe ref={frame} src="/demonstracao" title="Painel de administrador demonstrativo da ImobFlow" sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'" className={s.frame} style={{ width: panelWidth, height: `${100 / scale}%`, transform: `scale(${scale})` }} />
        </div>
      </section>
      {shown && <aside id="presentation-copy" className={s.explanation} aria-label="Explicação da área selecionada">
        <div className={s.sectionHeading}><span>{String(index + 1).padStart(2, '0')} / {chapters.length} — {chapter.label}</span><button type="button" onClick={() => { setDraft({ ...copy, steps: [...copy.steps] }); setEditing(!editing); }}>{editing ? 'Cancelar' : 'Editar texto'}</button></div>
        {editing && draft ? <form className={s.editor} onSubmit={event => { event.preventDefault(); save(); }}>
          <label>Título<input value={draft.title} maxLength={120} required onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
          <label>Explicação<textarea value={draft.summary} maxLength={350} required onChange={event => setDraft({ ...draft, summary: event.target.value })}/></label>
          {draft.steps.map((step, stepIndex) => <label key={stepIndex}>Passo {stepIndex + 1}<textarea value={step} maxLength={220} required onChange={event => setDraft({ ...draft, steps: draft.steps.map((value, i) => i === stepIndex ? event.target.value : value) })}/></label>)}
          <label>Mensagem final<textarea value={draft.benefit} maxLength={350} required onChange={event => setDraft({ ...draft, benefit: event.target.value })}/></label>
          <small>Altera apenas a apresentação. Os textos ficam salvos neste navegador.</small><div className={s.editorActions}><button className={s.primary} type="submit">Salvar texto</button><button type="button" onClick={() => save(true)}>Restaurar original</button></div>
        </form> : <div className={s.copy} key={active} aria-live="polite"><h1>{copy.title}</h1><p className={s.summary}>{copy.summary}</p><h2>Na prática</h2><ol>{copy.steps.map((step, i) => <li key={i}><span>{i + 1}</span><p>{step}</p></li>)}</ol><p className={s.benefit}>{copy.benefit}</p></div>}
        <div className={s.pager}><button type="button" disabled={index === 0 || !ready} onClick={() => navigate(chapters[index - 1].id)}>← Anterior</button><button type="button" disabled={index === chapters.length - 1 || !ready} onClick={() => navigate(chapters[index + 1].id)}>Próxima área →</button></div>
      </aside>}
    </div>
    <footer className={s.footer}><span>Clique nos menus do painel para explorar. A explicação acompanha você.</span><span role="status">{status}</span></footer>
  </div>;
}
