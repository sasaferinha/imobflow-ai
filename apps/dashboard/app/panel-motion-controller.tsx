'use client';

import { useEffect } from 'react';

/** Visual-only exits: React keeps ownership of forms, focus and all mutations. */
export default function PanelMotionController() {
  useEffect(() => {
    const selector = 'dialog[open], [role="dialog"], .modal-card, [data-motion-menu], [role="menu"], [role="listbox"]';
    const tracked = new Map<HTMLElement, { rect: DOMRect; style: string; drawer: boolean }>();
    const exits = new Set<HTMLElement>();
    const animations = new Set<Animation>();
    const activeAnimations = new WeakMap<HTMLElement, Animation>();
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    const enabled = () => !preference.matches && !!document.querySelector('[data-panel-view], [data-operational-page], [data-view]');
    const visible = (element: HTMLElement) => element.isConnected && !element.closest('[hidden], [data-motion-exit], details:not([open])') && element.getBoundingClientRect().width > 0 && getComputedStyle(element).display !== 'none';
    const remember = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      tracked.set(element, { rect: element.getBoundingClientRect(), style: Array.from(style).map(key => `${key}:${style.getPropertyValue(key)};`).join(''), drawer: element.dataset.motionMenu === 'drawer' });
    };
    const animate = (element: HTMLElement, frames: Keyframe[], duration: number, done?: () => void) => {
      if (!element.animate || preference.matches) { done?.(); return; }
      activeAnimations.get(element)?.cancel();
      const animation = element.animate(frames, { duration, easing: 'ease', fill: 'none' });
      activeAnimations.set(element, animation);
      animations.add(animation);
      void animation.finished.catch(() => undefined).then(() => { animations.delete(animation); done?.(); });
    };
    const exit = (element: HTMLElement, snapshot: { rect: DOMRect; style: string; drawer: boolean }) => {
      if (!enabled() || !snapshot.rect.width || !snapshot.rect.height) return;
      const copy = element.cloneNode(true) as HTMLElement;
      // The copy cannot focus, submit, execute scripts, or announce stale content.
      copy.querySelectorAll('script, iframe, video, audio, object, embed, input[type="hidden"]').forEach(node => node.remove());
      for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
        node.removeAttribute('id'); node.removeAttribute('name'); node.removeAttribute('autofocus');
        for (const attribute of Array.from(node.attributes)) if (attribute.name.startsWith('on')) node.removeAttribute(attribute.name);
      }
      copy.inert = true;
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('data-motion-exit', '');
      copy.style.cssText = snapshot.style;
      Object.assign(copy.style, { position: 'fixed', inset: 'auto', top: `${snapshot.rect.top}px`, left: `${snapshot.rect.left}px`, width: `${snapshot.rect.width}px`, height: `${snapshot.rect.height}px`, margin: '0', boxSizing: 'border-box', transform: 'none', translate: 'none', opacity: '1', pointerEvents: 'none', animation: 'none', transition: 'none', zIndex: '2147483646' });
      document.body.appendChild(copy);
      exits.add(copy);
      animate(copy, [{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: snapshot.drawer ? '-100% 0' : '0 12px' }], 180, () => { copy.remove(); exits.delete(copy); });
    };
    const scan = () => {
      if (disposed) return;
      if (!enabled()) { tracked.clear(); for (const copy of exits) copy.remove(); exits.clear(); return; }
      const closing = [...tracked].filter(([element]) => !visible(element) || !element.matches(selector));
      for (const [element, snapshot] of closing) {
        tracked.delete(element);
        if (!closing.some(([parent]) => parent !== element && parent.contains(element))) exit(element, snapshot);
      }
      const entering = new Set<HTMLElement>();
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (!visible(element) || tracked.has(element)) continue;
        // A modal-card inside a dialog is one surface, not two animations.
        if (element.matches(".modal-card") && element.parentElement?.closest('dialog, [role="dialog"]')) continue;
        remember(element);
        if ([...entering].some(parent => parent.contains(element))) continue;
        entering.add(element);
        animate(element, [{ opacity: 0, translate: element.dataset.motionMenu === 'drawer' ? '-100% 0' : '0 12px' }, { opacity: 1, translate: '0 0' }], 300);
      }
    };
    const capture = () => { for (const element of tracked.keys()) if (visible(element)) remember(element); };
    const captureKey = (event: KeyboardEvent) => { if (['Escape', 'Enter', ' ', 'Tab'].includes(event.key)) capture(); };
    const captureScroll = () => { for (const [element, snapshot] of tracked) if (visible(element)) snapshot.rect = element.getBoundingClientRect(); };
    const observer = new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        if (record.target instanceof Element && record.target.closest('[data-motion-exit]')) continue;
        if (record.type === 'attributes') {
          const target = record.target as HTMLElement;
          if (['aria-selected', 'aria-pressed', 'aria-current', 'data-panel-view'].includes(record.attributeName || '')) {
            const value = target.getAttribute(record.attributeName!);
            if (enabled() && value !== record.oldValue && value && value !== 'false') {
              const controlled = target.getAttribute('aria-controls');
              const surface = (controlled ? document.getElementById(controlled) : null) || target.closest<HTMLElement>('[data-motion-tabs], dialog, [role="dialog"], main');
              if (surface && !surface.closest('[data-motion-exit]')) animate(surface, [{ opacity: .55 }, { opacity: 1 }], 300);
            }
          } else changed = true;
        } else if ([...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && !node.hasAttribute('data-motion-exit') && (node.matches(selector) || node.querySelector(selector) || [...tracked.keys()].some(element => node.contains(element))))) changed = true;
      }
      if (changed) scan();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['open', 'hidden', 'data-motion-menu', 'aria-selected', 'aria-pressed', 'aria-current', 'data-panel-view'] });
    document.addEventListener('pointerdown', capture, true);
    document.addEventListener('keydown', captureKey, true);
    document.addEventListener('scroll', captureScroll, true);
    const reduce = () => { if (preference.matches) { for (const animation of animations) animation.cancel(); for (const copy of exits) copy.remove(); exits.clear(); } };
    preference.addEventListener('change', reduce);
    scan();
    return () => {
      disposed = true; observer.disconnect();
      document.removeEventListener('pointerdown', capture, true);
      document.removeEventListener('keydown', captureKey, true);
      document.removeEventListener('scroll', captureScroll, true);
      preference.removeEventListener('change', reduce);
      for (const animation of animations) animation.cancel();
      for (const copy of exits) copy.remove();
      tracked.clear();
    };
  }, []);
  return null;
}
