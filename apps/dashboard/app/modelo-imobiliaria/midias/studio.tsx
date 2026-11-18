'use client';
/* eslint-disable @next/next/no-img-element -- Local photo comparisons and fictional property examples. */

import { useEffect, useRef, useState } from 'react';
import { demoContent, demoProperties } from '@/lib/website/demo';
import type { PublicProperty } from '@/lib/website/model';
import { loadDemoPropertyMedia, saveDemoPropertyPhoto, saveDemoPropertyVideo, clearDemoPropertyMedia } from '@/lib/website/demo-property-media';
import { enhancePropertyPhoto, createPropertySlideshow, canRecordPropertyVideo, preparePropertyPhotoFile } from '@/lib/property-media-renderer';
import { createMediaAiJob, followMediaAiJob, getMediaAiStatus, loadMediaAiResult, MediaAiRequestError, readMediaAiJob, refreshMediaAiJob, type MediaAiInput, type MediaAiJob, type MediaAiKind, type MediaAiStatus } from '@/lib/media-studio/client';
import s from './studio.module.css';

type Media = { photos: Record<string, string>; video: Blob | null };
type Format = 'landscape' | 'portrait';
type Motion = 'gentle' | 'pan' | 'none';
const emptyMedia = (): Media => ({ photos: {}, video: null });
const jobLabels: Record<MediaAiJob['status'], string> = { reserved: 'Na fila', submitting: 'Enviando à IA', processing: 'Gerando', completed: 'Pronto', failed: 'Não concluído', unknown: 'Precisa de verificação' };

function downloadMedia(url: string, name: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
}
function preparedPhotoFormat(source: string, signal: AbortSignal): Promise<Format> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Preparação interrompida.', 'AbortError')); return; }
    if (!source.startsWith('data:image/jpeg;base64,')) { reject(new Error('A foto preparada é inválida.')); return; }
    const image = new Image();
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); image.src = ''; reject(new DOMException('Preparação interrompida.', 'AbortError')); };
    image.onload = () => { const width = image.naturalWidth, height = image.naturalHeight; cleanup(); if (!width || !height) reject(new Error('Não foi possível ler a orientação da foto.')); else resolve(height > width ? 'portrait' : 'landscape'); };
    image.onerror = () => { cleanup(); reject(new Error('Não foi possível preparar esta foto.')); };
    signal.addEventListener('abort', abort, { once: true });
    // Read the already-prepared data URL; this does not fetch the original again.
    image.src = source;
  });
}
function useVideoUrl(blob: Blob | null) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = blob ? URL.createObjectURL(blob) : '';
    const frame = requestAnimationFrame(() => setUrl(next));
    return () => { cancelAnimationFrame(frame); if (next) URL.revokeObjectURL(next); };
  }, [blob]);
  return url;
}

export default function MediaStudioDemo() {
  const [propertyId, setPropertyId] = useState(demoProperties[0].id);
  const [locked, setLocked] = useState(false);
  const property = demoProperties.find(item => item.id === propertyId)!;
  return <main className={s.studio}>
    <header className={s.header}>
      <div><a href="/painel#properties" className={s.back}>← Voltar aos imóveis</a><div className={s.titleLine}><h1>Estúdio de mídias</h1><span className={s.badge}>Demonstração</span></div></div>
      <a className={s.secondary} href="/modelo-imobiliaria" target="_blank" rel="noopener noreferrer">Ver no site ↗</a>
    </header>
    <section className={s.propertyBar} aria-label="Imóvel da demonstração">
      <label>Imóvel<select value={propertyId} disabled={locked} onChange={event => setPropertyId(event.target.value)}>{demoProperties.map(item => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</select></label>
      <span>Escolha uma foto. Aprimore. Aprove.</span>
    </section>
    <p className={s.demoNote}>Modelo da Horizonte Imobiliária. As aprovações ficam neste navegador e aparecem apenas no site de demonstração.</p>
    <PropertyStudio key={property.id} property={property} onBusy={setLocked} />
  </main>;
}

function PropertyStudio({ property, onBusy }: { property: PublicProperty; onBusy: (busy: boolean) => void }) {
  const [tab, setTab] = useState<'photo' | 'video'>('photo');
  const [media, setMedia] = useState<Media>(emptyMedia);
  const [loaded, setLoaded] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [importedPhoto, setImportedPhoto] = useState<{ source: string; name: string } | null>(null);
  const [candidatePhoto, setCandidatePhoto] = useState('');
  const [recoveredPhoto, setRecoveredPhoto] = useState(false);
  const [comparison, setComparison] = useState<'beside' | 'slider'>('slider');
  const [divider, setDivider] = useState(50);
  const [videoKind, setVideoKind] = useState<'slides' | 'camera'>('slides');
  const [photoOrder, setPhotoOrder] = useState(() => property.images.map((_, index) => index).slice(0, 5));
  const [secondsPerPhoto, setSecondsPerPhoto] = useState(3);
  const [motion, setMotion] = useState<Motion>('gentle');
  const [format, setFormat] = useState<Format>('landscape');
  const [displayedFormat, setDisplayedFormat] = useState<Format>('landscape');
  const [candidateVideo, setCandidateVideo] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recordingSupported, setRecordingSupported] = useState(false);
  const [aiStatus, setAiStatus] = useState<MediaAiStatus | null>(null);
  const [accessError, setAccessError] = useState('');
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [aiJob, setAiJob] = useState<MediaAiJob | null>(null);
  const [pendingRequest, setPendingRequest] = useState<MediaAiInput | null>(null);
  const [followingAi, setFollowingAi] = useState(false);
  const [aiWorking, setAiWorking] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const aiOperation = useRef(false);
  const revision = useRef(0);
  const accessRequest = useRef<AbortController | null>(null);
  const active = useRef(true);
  const candidateUrl = useVideoUrl(candidateVideo);
  const savedVideoUrl = useVideoUrl(media.video);
  const displayedVideo = candidateUrl || savedVideoUrl;
  const previewFormat = displayedVideo ? displayedFormat : format;
  const original = property.images[photoIndex];
  const savedPhoto = media.photos[String(photoIndex)];
  // Continue editing the approved photo, including an imported replacement.
  // The catalogue original is used again only through the explicit restore action.
  const photoSource = importedPhoto?.source || savedPhoto || original;
  const sourceLabel = importedPhoto ? 'Sua foto' : savedPhoto ? 'Foto atual' : 'Original';
  const resultPhoto = candidatePhoto || photoSource;
  const resultLabel = candidatePhoto ? 'Foto aprimorada' : savedPhoto && !importedPhoto ? 'Versão aprovada' : 'Foto original';
  const locked = Boolean(busy) || !loaded || Boolean(pendingRequest);
  const videoOptionsLocked = locked || Boolean(candidateVideo);
  const images = photoOrder.map(index => media.photos[String(index)] || property.images[index]);
  const unapproved = Boolean(candidatePhoto || candidateVideo || importedPhoto || pendingRequest);
  const aiKind: MediaAiKind = tab === 'photo' ? 'photo' : 'video';
  const aiAvailable = aiStatus?.access === 'ready' && aiStatus[aiKind].available;
  const recentJobs = (aiStatus?.jobs || []).filter(job => job.propertyId === property.id && job.photoIndex >= 0 && job.photoIndex < property.images.length);

  async function checkAiAccess() {
    accessRequest.current?.abort();
    const controller = new AbortController(); accessRequest.current = controller;
    setCheckingAccess(true);
    try {
      const next = await getMediaAiStatus(controller.signal);
      if (active.current && !controller.signal.aborted) { setAiStatus(next); setAccessError(''); }
    } catch {
      if (active.current && !controller.signal.aborted) { setAiStatus(null); setAccessError('Não foi possível verificar o acesso à IA.'); }
    } finally { if (active.current && !controller.signal.aborted) setCheckingAccess(false); }
  }

  useEffect(() => {
    active.current = true;
    void loadDemoPropertyMedia().then(all => {
      if (active.current) { setMedia(all[property.id] || emptyMedia()); setLoaded(true); setRecordingSupported(canRecordPropertyVideo()); }
    }).catch(() => {
      if (active.current) { setLoaded(true); setStorageAvailable(false); setRecordingSupported(canRecordPropertyVideo()); setError('O navegador não permitiu salvar a demonstração. Você ainda pode preparar e baixar as mídias. Para aprovar no site, libere o armazenamento e recarregue a página.'); }
    });
    return () => { active.current = false; operation.current?.abort(); accessRequest.current?.abort(); };
  }, [property.id]);
  useEffect(() => {
    const focus = () => { void checkAiAccess(); };
    focus(); window.addEventListener('focus', focus);
    return () => { window.removeEventListener('focus', focus); accessRequest.current?.abort(); };
  }, []);
  useEffect(() => { onBusy(locked || unapproved); }, [locked, unapproved, onBusy]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (busy || unapproved) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy, unapproved]);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(label); setError(''); setNotice('');
    try { await action(controller.signal); }
    catch (issue) {
      if (active.current) {
        if (controller.signal.aborted) setNotice(aiOperation.current ? 'Acompanhamento interrompido. A geração pode continuar e consumir a cota. Retome em Gerações recentes.' : 'Preparação cancelada. As mídias aprovadas continuam salvas.');
        else setError(issue instanceof Error ? issue.message : 'Não foi possível concluir. Tente novamente.');
      }
    } finally { operation.current = null; aiOperation.current = false; if (active.current) { setBusy(''); setFollowingAi(false); setAiWorking(false); } }
  }
  function resetPhotoDraft() { revision.current += 1; setCandidatePhoto(''); setImportedPhoto(null); setRecoveredPhoto(false); }
  function changePhoto(index: number) {
    if ((candidatePhoto || importedPhoto) && !window.confirm('Descartar a prévia desta foto e escolher outra?')) return;
    setPhotoIndex(index); resetPhotoDraft(); setNotice(''); setError('');
  }
  async function refresh() {
    const all = await loadDemoPropertyMedia();
    if (active.current) setMedia(all[property.id] || emptyMedia());
  }
  function clearPreview() { resetPhotoDraft(); setCandidateVideo(null); setNotice('Prévia descartada. As mídias aprovadas foram mantidas.'); }
  function movePhoto(position: number, offset: number) {
    const target = position + offset;
    if (target < 0 || target >= photoOrder.length) return;
    setPhotoOrder(current => { const next = [...current]; [next[position], next[target]] = [next[target], next[position]]; return next; });
  }
  async function importPhoto(file: File) {
    if ((candidatePhoto || importedPhoto) && !window.confirm('Substituir a prévia atual pela foto escolhida?')) return;
    await run('Abrindo sua foto…', async signal => {
      const source = await preparePropertyPhotoFile(file, signal);
      if (active.current && !signal.aborted) { setImportedPhoto({ source, name: file.name }); setCandidatePhoto(''); setNotice('Foto aberta só neste navegador. Ao aprovar, ela substituirá a foto selecionada neste imóvel fictício.'); }
    });
  }
  function chooseExample(source: string, name: string) {
    if ((candidatePhoto || importedPhoto) && !window.confirm('Substituir a prévia atual pela foto de exemplo?')) return;
    setImportedPhoto({ source, name }); setCandidatePhoto(''); setError('');
    setNotice('Exemplo aberto. Aprimore e aprove para testar esta foto no imóvel fictício.');
  }

  function rememberJob(job: MediaAiJob) {
    if (!active.current) return;
    setAiJob(job);
    setAiStatus(current => current ? { ...current, jobs: [job, ...current.jobs.filter(item => item.id !== job.id)] } : current);
  }
  async function showAiResult(job: MediaAiJob, signal: AbortSignal, expectedRevision: number, recovered: boolean) {
    if (job.propertyId !== property.id || job.photoIndex < 0 || job.photoIndex >= property.images.length) throw new Error('Esta geração pertence a outro imóvel.');
    const blob = await loadMediaAiResult(job, signal);
    if (job.kind === 'photo') {
      // Display and approve this exact normalized file; never substitute a local enhancement.
      const result = await preparePropertyPhotoFile(new File([blob], 'foto-ia.jpg', { type: blob.type }), signal);
      if (active.current && !signal.aborted && revision.current === expectedRevision) { setCandidatePhoto(result); setRecoveredPhoto(recovered); }
    } else if (active.current && !signal.aborted && revision.current === expectedRevision) {
      setDisplayedFormat(job.format); setFormat(job.format); setCandidateVideo(blob);
    }
    if (active.current && !signal.aborted && revision.current === expectedRevision) setNotice('Resultado da IA pronto. Confira os detalhes antes de aprovar.');
  }
  async function followAndShow(job: MediaAiJob, signal: AbortSignal, expectedRevision: number, recovered: boolean) {
    setFollowingAi(true);
    const finished = await followMediaAiJob(job, signal, next => { rememberJob(next); if (active.current && !signal.aborted) setBusy(`${jobLabels[next.status]}…`); });
    if (signal.aborted || !active.current) return;
    if (finished.status === 'failed') throw new Error(finished.error || 'A IA não concluiu esta geração.');
    if (finished.status === 'unknown') throw new Error('O fornecedor ainda não confirmou o resultado. Verifique esta geração em Gerações recentes antes de iniciar outra.');
    setBusy('Abrindo resultado…');
    await showAiResult(finished, signal, expectedRevision, recovered);
  }
  async function generateAi(kind: MediaAiKind, retry?: MediaAiInput) {
    if (operation.current || (!retry && (!aiStatus || aiStatus.access !== 'ready' || !aiStatus[kind].available || pendingRequest))) return;
    await run('Preparando foto para a IA…', async signal => {
      aiOperation.current = true; setAiWorking(true);
      const expectedRevision = revision.current;
      // Neutral rendering only prepares a size-limited upload. It is never the AI result.
      const imageDataUrl = retry?.imageDataUrl || await enhancePropertyPhoto(photoSource, { brightness: 100, contrast: 100, saturation: 100 }, signal);
      const input = retry || { requestId: crypto.randomUUID(), kind, propertyId: property.id, photoIndex, format: kind === 'photo' ? await preparedPhotoFormat(imageDataUrl, signal) : format, imageDataUrl };
      if (signal.aborted || !active.current) return;
      setPendingRequest(input); setAiJob(null); setBusy(kind === 'photo' ? 'Aprimorando com IA…' : 'Enviando à IA…');
      let job: MediaAiJob;
      try { job = await createMediaAiJob(input, signal); }
      catch (issue) {
        if (!(issue instanceof MediaAiRequestError && issue.ambiguous) && active.current) setPendingRequest(null);
        throw issue;
      }
      if (!active.current || signal.aborted) return;
      if (job.propertyId !== input.propertyId || job.photoIndex !== input.photoIndex || job.kind !== input.kind || job.format !== input.format) {
        throw new Error('A confirmação não corresponde à foto selecionada. Verifique a mesma solicitação.');
      }
      setPendingRequest(null); rememberJob(job);
      await followAndShow(job, signal, expectedRevision, false);
    });
  }
  async function resumeAi(job: MediaAiJob) {
    if (operation.current || pendingRequest) return;
    if ((candidatePhoto || candidateVideo || importedPhoto) && !window.confirm('Descartar a prévia atual e abrir esta geração?')) return;
    resetPhotoDraft(); setCandidateVideo(null); setPhotoIndex(job.photoIndex); setTab(job.kind === 'photo' ? 'photo' : 'video');
    if (job.kind === 'video') setVideoKind('camera');
    const expectedRevision = revision.current;
    await run('Consultando geração…', async signal => {
      aiOperation.current = true; setAiWorking(true);
      const latest = job.kind === 'video' && job.status !== 'completed' ? await refreshMediaAiJob(job.id, signal) : await readMediaAiJob(job.id, signal);
      await followAndShow(latest, signal, expectedRevision, true);
    });
  }

  const accessPanel = aiAvailable && !accessError && !checkingAccess ? null : <div className={s.aiAccess}>
    {checkingAccess ? <p role="status">Verificando acesso à IA…</p> : accessError ? <p role="status">{accessError}</p> : aiStatus?.access === 'login_required' ? <><p>Entre com seu acesso de administrador para usar a IA.</p><a href="/painel?acesso=administrador" target="_blank" rel="noopener noreferrer">Entrar no painel ↗</a></> : aiStatus?.access === 'forbidden' ? <p>Esta conta não tem permissão para gerar mídias com IA.</p> : aiStatus?.access === 'not_enabled' ? <p>O adicional de IA ainda não foi liberado para sua imobiliária.</p> : !aiAvailable ? <p>{aiStatus?.[aiKind].message || 'A geração com IA ainda não está disponível.'}</p> : <p>IA disponível para sua conta.</p>}
    <button type="button" className={s.textButton} disabled={checkingAccess || locked} onClick={() => void checkAiAccess()}>Verificar acesso</button>
  </div>;

  return <>
    <nav className={s.tabs} aria-label="Ferramentas de mídia">
      <button type="button" aria-pressed={tab === 'photo'} disabled={locked || (tab !== 'photo' && unapproved)} onClick={() => setTab('photo')}>Melhorar foto</button>
      <button type="button" aria-pressed={tab === 'video'} disabled={locked || (tab !== 'video' && unapproved)} onClick={() => setTab('video')}>Criar vídeo</button>
    </nav>
    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.success} role="status">{notice}</p>}
    {!loaded ? <p role="status">Preparando a galeria…</p> : <div className={s.workspace}>
      <section className={s.preview} aria-label={tab === 'photo' ? 'Comparação da foto' : 'Prévia do vídeo'}>
        <div className={s.previewHeading}><span>{property.code} · {tab === 'photo' ? `Foto ${photoIndex + 1} de ${property.images.length}` : displayedVideo && !candidateVideo ? 'Vídeo aprovado' : videoKind === 'slides' ? 'Vídeo de apresentação' : 'Vídeo com IA · 5 segundos'}</span>
          {tab === 'photo' ? !recoveredPhoto && <div className={s.viewModes} aria-label="Modo de comparação"><button type="button" aria-pressed={comparison === 'slider'} onClick={() => setComparison('slider')}>Deslizar</button><button type="button" aria-pressed={comparison === 'beside'} onClick={() => setComparison('beside')}>Lado a lado</button></div> : <span>{previewFormat === 'landscape' ? 'Horizontal · 16:9' : 'Vertical · 9:16'}</span>}
        </div>
        {tab === 'photo' ? <>
          {recoveredPhoto && candidatePhoto ? <figure className={s.recoveredPhoto}><img src={candidatePhoto} alt="Resultado da IA recuperado" /><figcaption>Resultado recuperado. A foto enviada originalmente não é carregada nesta comparação.</figcaption></figure> : comparison === 'beside' ? <div className={s.comparison}>
            <figure><div><img src={photoSource} alt={`${sourceLabel} antes dos ajustes`} /></div><figcaption>{sourceLabel}</figcaption></figure>
            <figure><div><img src={resultPhoto} alt={resultLabel} /></div><figcaption>{resultLabel}</figcaption></figure>
          </div> : <div className={s.compareArea}>
            <div className={s.compareSlider}>
              <img src={photoSource} alt={`${sourceLabel} antes dos ajustes`} />
              <img className={s.afterImage} src={resultPhoto} style={{ clipPath: `inset(0 0 0 ${divider}%)` }} alt={resultLabel} />
              <span className={s.beforeLabel}>{sourceLabel}</span><span className={s.afterLabel}>{resultLabel}</span>
              <span aria-hidden="true" className={s.compareDivider} style={{ left: `${divider}%` }}><span>↔</span></span>
              <input type="range" min={0} max={100} value={divider} aria-label="Comparar foto antes e depois" aria-valuetext={`${divider}% antes, ${100 - divider}% resultado`} onChange={event => setDivider(Number(event.target.value))} />
            </div>
            <p>{candidatePhoto ? 'Arraste para comparar os detalhes.' : 'Clique em Aprimorar foto para ver o resultado.'}</p>
          </div>}
          <div className={s.thumbnails} aria-label="Escolher foto">{property.images.map((image, index) => <button type="button" aria-label={`Editar foto ${index + 1}`} aria-pressed={photoIndex === index} disabled={locked} key={index} onClick={() => changePhoto(index)}><img src={media.photos[String(index)] || image} alt="" /><span>Foto {index + 1}{media.photos[String(index)] ? ' · aprovada' : ''}</span></button>)}</div>
        </> : <>
          <div className={`${s.videoStage} ${previewFormat === 'portrait' ? s.portrait : ''}`}>
            {displayedVideo ? <video key={displayedVideo} src={displayedVideo} controls playsInline preload="metadata" aria-label="Vídeo do imóvel" onLoadedMetadata={event => setDisplayedFormat(event.currentTarget.videoHeight > event.currentTarget.videoWidth ? 'portrait' : 'landscape')} /> : <div className={s.motionPhoto}><img src={videoKind === 'camera' ? photoSource : images[0] || property.images[0]} alt="Foto de origem do vídeo" /><div className={s.videoOverlay}><span>{demoContent.brandName}</span><h2>{property.title}</h2><p>{videoKind === 'camera' ? 'Foto de origem · o vídeo aparece após a geração' : 'Suas fotos, em uma apresentação'}</p></div></div>}
          </div>
          {videoKind === 'slides' && <fieldset className={s.sequence} disabled={videoOptionsLocked}><legend>Fotos do vídeo <span>{photoOrder.length} selecionadas</span></legend>
            <div className={s.photoChoices}>{property.images.map((image, index) => <label key={index}><input type="checkbox" checked={photoOrder.includes(index)} aria-label={`Incluir foto ${index + 1} no vídeo`} onChange={event => setPhotoOrder(current => event.target.checked ? [...current, index].slice(0, 5) : current.filter(item => item !== index))} /><img src={media.photos[String(index)] || image} alt="" /><span>Foto {index + 1}</span></label>)}</div>
            {photoOrder.length > 0 && <ol className={s.orderList} aria-label="Ordem das fotos do vídeo">{photoOrder.map((index, position) => <li key={index}><span>{position + 1}. Foto {index + 1}</span><button type="button" disabled={videoOptionsLocked || position === 0} aria-label={`Mover foto ${index + 1} para antes`} onClick={() => movePhoto(position, -1)}>←</button><button type="button" disabled={videoOptionsLocked || position === photoOrder.length - 1} aria-label={`Mover foto ${index + 1} para depois`} onClick={() => movePhoto(position, 1)}>→</button></li>)}</ol>}
          </fieldset>}
          {videoKind === 'camera' && <div className={s.thumbnails} aria-label="Foto de origem do vídeo">{property.images.map((image, index) => <button type="button" key={index} aria-label={`Gerar vídeo da foto ${index + 1}`} aria-pressed={photoIndex === index} disabled={videoOptionsLocked} onClick={() => changePhoto(index)}><img src={media.photos[String(index)] || image} alt="" /><span>Foto {index + 1}</span></button>)}</div>}
        </>}
        <div className={s.previewFoot}><span className={s.statusDot} /><span>{tab === 'photo' ? savedPhoto ? 'Foto aprovada no site de demonstração.' : 'A original é preservada. Só a aprovação altera o site de demonstração.' : candidateVideo ? 'Prévia pronta. Assista antes de aprovar.' : media.video ? 'Vídeo aprovado no site de demonstração.' : 'As fotos aprovadas serão usadas no vídeo.'}</span></div>
      </section>
      <aside className={s.controls}>
        {tab === 'photo' ? <>
          <div><span className={s.eyebrow}>FOTO</span><h2>Aprimore em um toque.</h2></div>
          <p>Aprimore com IA e confira o resultado antes de aprovar.</p>
          {!candidatePhoto ? <><button type="button" className={s.primary} disabled={locked || !aiAvailable || checkingAccess} onClick={() => void generateAi('photo')}>{busy || 'Aprimorar foto'}</button>{accessPanel}</> : <>
            <button type="button" className={s.primary} disabled={locked || !storageAvailable} onClick={() => void run('Aprovando foto…', async () => { await saveDemoPropertyPhoto(property.id, photoIndex, candidatePhoto); await refresh(); if (active.current) { resetPhotoDraft(); setNotice('Foto aprovada. Ela já aparece neste imóvel no site de demonstração.'); } })}>Aprovar e usar no site de demonstração</button>
            <button type="button" className={s.secondary} disabled={locked} onClick={() => downloadMedia(candidatePhoto, `${property.code}-foto-${photoIndex + 1}.jpg`)}>Baixar foto</button>
          </>}
          <p className={s.small}>Ao gerar, esta foto será enviada à OpenAI. A IA pode alterar detalhes; confira a fidelidade ao imóvel antes de usar.</p>
          <details className={s.details}><summary>Experimentar com outra foto</summary><div className={s.examplePhotos}>{[{ source: '/demo-media/sala-clara.jpg', name: 'Sala clara' }, { source: '/demo-media/sala-aconchegante.jpg', name: 'Sala aconchegante' }].map(example => <button type="button" key={example.source} disabled={locked} onClick={() => chooseExample(example.source, example.name)}><img src={example.source} alt="" /><span>{example.name}</span></button>)}</div><label className={s.fileInput}>Escolher arquivo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importPhoto(file); }} /></label><p className={s.small}>JPEG, PNG ou WebP · até 12 MB. Escolher o arquivo só abre a prévia; o envio acontece ao gerar.</p>{importedPhoto && <p className={s.fileName}>{importedPhoto.name}</p>}</details>
          {savedPhoto && <div className={s.savedActions}><button type="button" disabled={locked} onClick={() => downloadMedia(savedPhoto, `${property.code}-foto-aprovada-${photoIndex + 1}.jpg`)}>Baixar foto aprovada</button><button type="button" disabled={locked || !storageAvailable} onClick={() => void run('Restaurando original…', async () => { await saveDemoPropertyPhoto(property.id, photoIndex, null); await refresh(); if (active.current) { resetPhotoDraft(); setNotice('Foto original restaurada no site de demonstração.'); } })}>Restaurar foto original no site</button></div>}
        </> : <>
          <div><span className={s.eyebrow}>VÍDEO</span><h2>Pronto para apresentar.</h2></div>
          <fieldset className={s.choices} disabled={locked || Boolean(candidateVideo)}><legend>Tipo de vídeo</legend><label><input type="radio" name="video-kind" checked={videoKind === 'slides'} onChange={() => setVideoKind('slides')} /><span><strong>Apresentação com fotos</strong><small>Montagem neste navegador, sem geração por IA.</small></span></label><label><input type="radio" name="video-kind" checked={videoKind === 'camera'} onChange={() => setVideoKind('camera')} /><span><strong>Câmera com IA</strong><small>Uma foto · vídeo de 5 segundos.</small></span></label></fieldset>
          {videoKind === 'slides' ? <>
            <label className={s.format}>Formato<select value={format} disabled={videoOptionsLocked} onChange={event => setFormat(event.target.value as Format)}><option value="landscape">Horizontal · site e redes</option><option value="portrait">Vertical · stories e reels</option></select></label>
            <details className={s.details}><summary>Duração e movimento</summary><label className={s.format}>Tempo por foto<select value={secondsPerPhoto} disabled={videoOptionsLocked} onChange={event => setSecondsPerPhoto(Number(event.target.value))}><option value={2}>2 segundos · rápido</option><option value={3}>3 segundos · recomendado</option><option value={5}>5 segundos · detalhado</option></select></label><label className={s.format}>Movimento<select value={motion} disabled={videoOptionsLocked} onChange={event => setMotion(event.target.value as Motion)}><option value="gentle">Aproximação suave</option><option value="pan">Deslocamento suave</option><option value="none">Sem movimento</option></select></label></details>
            <p className={s.small}>{images.length} fotos · {images.length * secondsPerPhoto} segundos · sem áudio</p>
            {!recordingSupported && <p className={s.error}>Este navegador não permite criar vídeos. Use Chrome ou Edge atualizado.</p>}
            {!candidateVideo ? <button type="button" className={s.primary} disabled={locked || !recordingSupported || !images.length} onClick={() => void run('Criando apresentação…', async signal => { setProgress(0); const blob = await createPropertySlideshow({ images, title: property.title, brand: demoContent.brandName, format, secondsPerPhoto, motion, signal, onProgress: value => { if (active.current) setProgress(value); } }); if (active.current && !signal.aborted) { setDisplayedFormat(format); setCandidateVideo(blob); setNotice('Vídeo pronto. Assista à prévia antes de aprovar.'); } })}>{busy || 'Criar apresentação'}</button> : <>
              <button type="button" className={s.primary} disabled={locked || !storageAvailable} onClick={() => void run('Aprovando vídeo…', async () => { await saveDemoPropertyVideo(property.id, candidateVideo); await refresh(); if (active.current) { setCandidateVideo(null); setNotice('Vídeo aprovado. Abra este imóvel no site de demonstração para assistir.'); } })}>Aprovar e usar no site de demonstração</button>
              <button type="button" className={s.secondary} disabled={locked || !candidateUrl} onClick={() => downloadMedia(candidateUrl, `${property.code}-apresentacao.${candidateVideo.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)}>Baixar vídeo</button>
              <p className={s.small}>Formato gerado: {candidateVideo.type.startsWith('video/mp4') ? 'MP4' : 'WebM. Algumas redes sociais exigem conversão para MP4'}.</p>
            </>}
            {busy === 'Criando apresentação…' && <div className={s.progress} role="status"><progress max={100} value={progress} aria-label="Progresso da criação do vídeo" /><span>{Math.round(progress)}% · mantenha esta aba visível</span></div>}
          </> : <>
            <label className={s.format}>Formato<select value={format} disabled={videoOptionsLocked} onChange={event => setFormat(event.target.value as Format)}><option value="landscape">Horizontal · site e redes</option><option value="portrait">Vertical · stories e reels</option></select></label>
            <p>Movimento de câmera gerado a partir da foto {photoIndex + 1}. Vídeo de 5 segundos, sem áudio.</p>
            {!candidateVideo ? <><button type="button" className={s.primary} disabled={locked || !aiAvailable || checkingAccess} onClick={() => void generateAi('video')}>{busy || 'Gerar vídeo com IA'}</button>{accessPanel}</> : <>
              <button type="button" className={s.primary} disabled={locked || !storageAvailable} onClick={() => void run('Aprovando vídeo…', async () => { await saveDemoPropertyVideo(property.id, candidateVideo); await refresh(); if (active.current) { setCandidateVideo(null); setNotice('Vídeo aprovado. Abra este imóvel no site de demonstração para assistir.'); } })}>Aprovar e usar no site de demonstração</button>
              <button type="button" className={s.secondary} disabled={locked || !candidateUrl} onClick={() => downloadMedia(candidateUrl, `${property.code}-video-ia.mp4`)}>Baixar vídeo</button>
            </>}
            <p className={s.small}>Ao gerar, esta foto será enviada à Runway. A IA pode inventar movimentos ou detalhes; revise o vídeo antes de usar.</p>
          </>}
          {media.video && <div className={s.savedActions}><button type="button" disabled={locked || !savedVideoUrl} onClick={() => downloadMedia(savedVideoUrl, `${property.code}-video-aprovado.${media.video!.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)}>Baixar vídeo aprovado</button><button type="button" disabled={locked || !storageAvailable} onClick={() => void run('Retirando vídeo…', async () => { await saveDemoPropertyVideo(property.id, null); await refresh(); if (active.current) setNotice('Vídeo retirado do site. As fotos continuam disponíveis.'); })}>Retirar vídeo do site</button></div>}
        </>}
        {aiWorking && busy && <div className={s.aiProgress} role="status"><span>{aiJob ? jobLabels[aiJob.status] : 'Enviando à IA'}. Você pode retomar depois.</span>{followingAi && <button type="button" className={s.textButton} onClick={() => operation.current?.abort()}>Parar acompanhamento</button>}<p className={s.small}>Parar de acompanhar não cancela a geração nem o consumo da cota.</p></div>}
        {pendingRequest && !busy && <button type="button" className={s.secondary} onClick={() => void generateAi(pendingRequest.kind, pendingRequest)}>Verificar a mesma solicitação</button>}
        {busy && !aiWorking && !busy.startsWith('Aprovando') && !busy.startsWith('Restaurando') && !busy.startsWith('Retirando') && <button type="button" className={s.textButton} onClick={() => operation.current?.abort()}>Cancelar preparação</button>}
        {unapproved && <button className={s.textButton} type="button" disabled={locked} onClick={clearPreview}>Descartar prévia</button>}
      </aside>
    </div>}
    {recentJobs.length > 0 && <details className={s.recentJobs}><summary>Gerações recentes <span>{recentJobs.length}</span></summary><p>Resultados desta conta e deste imóvel. Abra uma geração para revisar; ela não altera o site sem sua aprovação.</p><ul>{recentJobs.map(job => <li key={job.id}><div><strong>{job.kind === 'photo' ? 'Foto com IA' : 'Vídeo com IA'} · foto {job.photoIndex + 1}</strong><span>{jobLabels[job.status]} · {new Date(job.createdAt).toLocaleString('pt-BR')}</span>{job.error && <span>{job.error}</span>}{job.status === 'completed' && !job.resultAvailable && <span>Resultado indisponível ou expirado.</span>}</div>{job.status !== 'failed' && (job.status !== 'completed' || job.resultAvailable) && <button type="button" className={s.secondary} disabled={locked} onClick={() => void resumeAi(job)}>{job.status === 'completed' ? 'Abrir resultado' : 'Retomar acompanhamento'}</button>}</li>)}</ul></details>}
    <footer className={s.footer}><p>Preço e disponibilidade continuam na área de Imóveis. Aqui você cuida da apresentação.</p><button type="button" className={s.textButton} disabled={locked || !storageAvailable} onClick={() => { if (window.confirm('Restaurar as fotos originais e remover o vídeo de demonstração deste imóvel?')) void run('Restaurando demonstração…', async () => { await clearDemoPropertyMedia(property.id); await refresh(); if (active.current) { resetPhotoDraft(); setCandidateVideo(null); setNotice('Demonstração deste imóvel restaurada.'); } }); }}>Restaurar este imóvel</button></footer>
  </>;
}
