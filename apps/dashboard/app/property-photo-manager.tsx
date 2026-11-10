'use client';
/* eslint-disable @next/next/no-img-element -- local upload previews */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import s from './property-photo-manager.module.css';

export default function PropertyPhotoManager({ title, images, busy, saving, preparing, error, onAdd, onRemove, onCover, onClose, onSave }: {
  title: string; images: string[]; busy: boolean; saving: boolean; preparing: boolean; error: string;
  onAdd: (files: FileList | null) => void; onRemove: (index: number) => void; onCover: (index: number) => void; onClose: () => void; onSave: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const canAdd = !busy && images.length < 5;
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<div className={s.backdrop} onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()} onKeyDown={event => {
    if (event.key === 'Escape' && !busy) onClose();
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') || []).filter(node => node.offsetParent !== null);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }}>
    <section ref={dialog} tabIndex={-1} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="property-photos-title">
      <header className={s.header}><div className={s.icon} aria-hidden="true">▧</div><div><span className={s.eyebrow}>CATÁLOGO DO IMÓVEL</span><h2 id="property-photos-title">Organize suas fotos</h2><p>{title}</p></div><button type="button" className={s.close} aria-label="Fechar fotos" disabled={busy} onClick={onClose}>×</button></header>
      <div className={s.body}>
        <input ref={input} className={s.hidden} type="file" accept="image/jpeg,image/png,image/webp" multiple tabIndex={-1} aria-label="Selecionar fotos" disabled={busy || images.length >= 5} onChange={event => { onAdd(event.target.files); event.target.value = ''; }}/>
        <div className={dragging && canAdd ? s.dropActive : undefined}
          onDragOver={event => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.types).includes('Files');
            event.dataTransfer.dropEffect = canAdd && files ? 'copy' : 'none';
            setDragging(canAdd && files);
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={event => {
            event.preventDefault(); event.stopPropagation(); setDragging(false);
            if (canAdd && event.dataTransfer.files.length) onAdd(event.dataTransfer.files);
          }}>
        <button type="button" className={s.upload} disabled={busy || images.length >= 5} onClick={() => input.current?.click()}><span className={s.uploadIcon} aria-hidden="true">＋</span><strong>{preparing ? 'Preparando imagens…' : images.length >= 5 ? 'Sua galeria está completa' : dragging && canAdd ? 'Solte as fotos aqui' : 'Adicionar fotos do imóvel'}</strong><span>Arraste as fotos aqui ou clique para selecionar</span><small>JPG, PNG ou WebP · até 5 fotos</small></button>
        </div>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.mediaDemo}><div><strong>Fotos e vídeos para valorizar seu imóvel</strong><span>Conheça o adicional com imóveis fictícios, sem alterar esta galeria.</span></div><a href="/modelo-imobiliaria/midias" target="_blank" rel="noopener noreferrer">Experimentar estúdio ↗</a></div>
        <div className={s.galleryHeading}><strong>Galeria</strong><span>{images.length} de 5 fotos</span></div>
        {images.length ? <div className={s.grid}>{images.map((image,index) => <article className={s.photo} key={image + index}><div className={s.preview}><img src={image} alt={`Foto ${index + 1} de ${title}`}/>{index === 0 && <span className={s.cover}>Capa do imóvel</span>}<button type="button" className={s.remove} aria-label={`Remover foto ${index + 1}`} disabled={busy} onClick={() => onRemove(index)}>×</button></div><div className={s.photoFooter}><span>Foto {index + 1}</span>{index > 0 ? <button type="button" disabled={busy} onClick={() => onCover(index)}>Usar como capa</button> : <span>Foto principal</span>}</div></article>)}</div> : <p className={s.empty}>Suas fotos aparecerão aqui. A primeira será a capa do imóvel.</p>}
      </div>
      <footer className={s.footer}><span>As alterações são aplicadas ao salvar.</span><div><button type="button" className={s.cancel} disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className={s.save} disabled={busy} onClick={onSave}>{saving ? 'Salvando…' : 'Salvar fotos'}</button></div></footer>
    </section>
  </div>, document.body);
}
