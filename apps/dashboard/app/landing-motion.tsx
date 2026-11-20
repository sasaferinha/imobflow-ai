'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import s from './landing-motion.module.css';

function subscribeMotionPreference(notify: () => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener('change', notify);
  return () => preference.removeEventListener('change', notify);
}

export default function LandingMotion({ children, className }: { children: ReactNode; className?: string }) {
  const shell = useRef<HTMLDivElement>(null);
  const [userPaused, setUserPaused] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeMotionPreference,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
  const paused = reduced || userPaused;

  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    if (paused) {
      // Pausing an entrance must leave its content fully readable.
      element.querySelectorAll(`.${s.entering}`).forEach(target => target.classList.remove(s.entering));
      return;
    }
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const target = entry.target as HTMLElement;
        target.dataset.revealed = 'true';
        target.classList.add(s.entering);
        observer.unobserve(target);
      }
    }, { threshold: 0.08 });
    const finishEntrance = (event: AnimationEvent) => {
      if (event.target instanceof HTMLElement && event.target.classList.contains(s.entering)) {
        event.target.classList.remove(s.entering);
      }
    };
    element.addEventListener('animationend', finishEntrance);
    // All sections are visible before JavaScript; only entering sections animate.
    element.querySelectorAll('[data-reveal]:not([data-revealed])').forEach(target => observer.observe(target));
    return () => {
      observer.disconnect();
      element.removeEventListener('animationend', finishEntrance);
    };
  }, [paused]);

  return <div ref={shell} className={[s.shell, className].filter(Boolean).join(' ')} data-motion={paused ? 'paused' : 'running'}>
    {children}
    <button
      className={s.motionButton}
      type="button"
      aria-pressed={paused}
      disabled={reduced}
      title={reduced ? 'Efeitos reduzidos conforme a preferência do seu dispositivo.' : 'Pausa os efeitos visuais da página. A demonstração possui seu próprio controle.'}
      onClick={() => setUserPaused(value => !value)}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {paused ? <path d="m6 3 6 5-6 5Z" /> : <path d="M5 3v10M11 3v10" />}
      </svg>
      {reduced ? 'Efeitos reduzidos' : paused ? 'Retomar efeitos' : 'Pausar efeitos'}
    </button>
  </div>;
}
