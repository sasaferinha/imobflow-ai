'use client';
/* eslint-disable @next/next/no-img-element -- Local photo comparisons and fictional property examples. */

import { useEffect, useRef, useState } from 'react';
import { demoContent, demoProperties } from '@/lib/website/demo';
import type { PublicProperty } from '@/lib/website/model';
import { loadDemoPropertyMedia, saveDemoPropertyPhoto, saveDemoPropertyVideo, clearDemoPropertyMedia } from '@/lib/website/demo-property-media';
import { enhancePropertyPhoto, createPropertySlideshow, canRecordPropertyVideo, type PhotoAdjustments } from '@/lib/property-media-renderer';
import s from './studio.module.css';

type Media = { photos: Record<string, string>; video: Blob | null };
const emptyMedia = (): Media => ({ photos: {}, video: null });
const defaults: PhotoAdjustments = { brightness: 108, contrast: 104, saturation: 103 };
function downloadMedia(url: string, name: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
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
      <div><a href="/painel#properties" className={s.back}>← Voltar aos imóveis</a><div className={s.titleLine}><h1>Estúdio de mídias</h1><span className={s.badge}>Adicional · demonstração</span></div><p>Valorize a apresentação. Preserve o imóvel como ele é.</p></div>
      <a className={s.secondary} href="/modelo-imobiliaria" target="_blank" rel="noopener noreferrer">Ver site de demonstração ↗</a>
    </header>
    <div className={s.demoNote}><strong>Experimente com a Horizonte Imobiliária.</strong><span>Imóveis fictícios. Aprovações ficam neste navegador, sem cobrança. Planos e valores serão definidos depois.</span></div>
    <section className={s.propertyBar} aria-label="Imóvel da demonstração"><label>Imóvel<select value={propertyId} disabled={locked} onChange={event => setPropertyId(event.target.value)}>{demoProperties.map(item => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</select></label><span>Fotos e vídeos são preparados aqui.<br/>Preço e disponibilidade continuam no CRM.</span></section>
    <PropertyStudio key={property.id} property={property} onBusy={setLocked} />
  </main>;
}

function PropertyStudio({ property, onBusy }: { property: PublicProperty; onBusy: (busy: boolean) => void }) {
  const [tab, setTab] = useState<'photo' | 'video'>('photo');
  const [media, setMedia] = useState<Media>(emptyMedia);
  const [loaded, setLoaded] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [adjustments, setAdjustments] = useState<PhotoAdjustments>(defaults);
  const [candidatePhoto, setCandidatePhoto] = useState('');
  const [videoKind, setVideoKind] = useState<'slides' | 'camera'>('slides');
  const [format, setFormat] = useState<'landscape' | 'portrait'>('landscape');
  const [displayedFormat, setDisplayedFormat] = useState<'landscape' | 'portrait'>('landscape');
  const [candidateVideo, setCandidateVideo] = useState<Blob | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(false);
  const [recordingSupported, setRecordingSupported] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const active = useRef(true);
  const candidateUrl = useVideoUrl(candidateVideo);
  const savedVideoUrl = useVideoUrl(media.video);
  const displayedVideo = candidateUrl || savedVideoUrl;
  const previewFormat = videoKind === 'slides' && displayedVideo ? displayedFormat : format;
  const original = property.images[photoIndex];
  const savedPhoto = media.photos[String(photoIndex)];
  const locked = Boolean(busy) || !loaded;
  const images = property.images.map((image, index) => media.photos[String(index)] || image);
  const unapproved = Boolean(candidatePhoto || candidateVideo);

  useEffect(() => {
    active.current = true;
    void loadDemoPropertyMedia().then(all => {
      if (active.current) { setMedia(all[property.id] || emptyMedia()); setLoaded(true); setRecordingSupported(canRecordPropertyVideo()); }
    }).catch(() => {
      if (active.current) { setLoaded(true); setRecordingSupported(canRecordPropertyVideo()); setError('Não foi possível abrir o armazenamento desta demonstração. Você pode preparar e baixar mídias; para aprovar no site, permita o armazenamento do navegador e atualize a página.'); }
    });
    return () => { active.current = false; operation.current?.abort(); };
  }, [property.id]);
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
        if (controller.signal.aborted) setNotice('Preparação cancelada. As mídias aprovadas continuam salvas.');
        else setError(issue instanceof Error ? issue.message : 'Não foi possível concluir. Tente novamente.');
      }
    } finally { operation.current = null; if (active.current) setBusy(''); }
  }
  function changePhoto(index: number) {
    if (candidatePhoto && !window.confirm('Descartar a prévia desta foto e escolher outra?')) return;
    setPhotoIndex(index); setCandidatePhoto(''); setAdjustments(defaults); setNotice(''); setError('');
  }
  async function refresh() {
    const all = await loadDemoPropertyMedia();
    if (active.current) setMedia(all[property.id] || emptyMedia());
  }
  function clearPreview() { setCandidatePhoto(''); setCandidateVideo(null); setNotice('Prévia descartada. As mídias aprovadas foram mantidas.'); }

  return <>
    <nav className={s.tabs} aria-label="Ferramentas de mídia">
      <button type="button" aria-pressed={tab === 'photo'} disabled={locked} onClick={() => setTab('photo')}>01 <strong>Melhorar foto</strong><span>Luz, cor e comparação</span></button>
      <button type="button" aria-pressed={tab === 'video'} disabled={locked} onClick={() => setTab('video')}>02 <strong>Criar vídeo</strong><span>Apresentação ou câmera com IA</span></button>
    </nav>
    {error && <p className={s.error} role="alert">{error}</p>}
    {notice && <p className={s.success} role="status">{notice}</p>}
    {!loaded ? <p role="status">Preparando a galeria…</p> : <div className={s.workspace}>
      <section className={s.preview} aria-label={tab === 'photo' ? 'Comparação da foto' : 'Prévia do vídeo'}>
        <div className={s.previewHeading}><span>{property.code} · {tab === 'photo' ? 'Comparar antes de aprovar' : videoKind === 'slides' ? 'Vídeo de apresentação' : 'Movimento ilustrativo'}</span><span>{tab === 'photo' ? `${photoIndex + 1} de ${property.images.length} fotos` : previewFormat === 'landscape' ? 'Horizontal · 16:9' : 'Vertical · 9:16'}</span></div>
        {tab === 'photo' ? <>
          <div className={s.comparison}>
            <figure><div><img src={original} alt="Foto original do imóvel fictício" /></div><figcaption>Original preservada</figcaption></figure>
            <figure><div><img src={candidatePhoto || original} style={candidatePhoto ? undefined : { filter: `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%)` }} alt={candidatePhoto ? 'Melhoria preparada para aprovação' : 'Prévia dos ajustes de iluminação e cor'} /></div><figcaption>{candidatePhoto ? 'Pronta para aprovar' : 'Prévia dos ajustes'}</figcaption></figure>
          </div>
          <div className={s.thumbnails} aria-label="Escolher foto">{property.images.map((image, index) => <button type="button" aria-label={`Editar foto ${index + 1}`} aria-pressed={photoIndex === index} disabled={locked} key={image} onClick={() => changePhoto(index)}><img src={image} alt="" /><span>Foto {index + 1}{media.photos[String(index)] ? ' · aprovada' : ''}</span></button>)}</div>
        </> : <div className={`${s.videoStage} ${previewFormat === 'portrait' ? s.portrait : ''}`}>
          {videoKind === 'slides' && displayedVideo ? <video key={displayedVideo} src={displayedVideo} controls playsInline preload="metadata" aria-label="Vídeo de apresentação do imóvel" onLoadedMetadata={event => setDisplayedFormat(event.currentTarget.videoHeight > event.currentTarget.videoWidth ? 'portrait' : 'landscape')} /> : <div className={`${s.motionPhoto} ${playing ? s.playing : ''}`}><img src={images[0]} alt="Foto ilustrativa usada na prévia de movimento" /><div className={s.videoOverlay}><span>{demoContent.brandName}</span><h2>{property.title}</h2><p>{videoKind === 'camera' ? 'Prévia ilustrativa · movimento sobre uma foto' : 'Suas fotos, em uma apresentação'}</p></div></div>}
          {videoKind === 'camera' && <span className={s.simulationLabel}>Simulação visual · não gerada por IA</span>}
        </div>}
        <div className={s.previewFoot}><span className={s.statusDot} /><span>{tab === 'photo' ? savedPhoto ? 'Esta foto já tem uma versão aprovada no site de demonstração.' : 'Só a versão aprovada aparece no site.' : media.video ? 'Há um vídeo aprovado neste imóvel.' : 'Crie, confira e aprove o vídeo antes de usar.'}</span></div>
      </section>
      <aside className={s.controls}>
        {tab === 'photo' ? <>
          <span className={s.eyebrow}>MELHORAR FOTO</span><h2>Mais luz. O mesmo imóvel.</h2><p>Ajuste a foto, compare os detalhes e decida se quer usar o resultado.</p>
          <fieldset className={s.sliders} disabled={locked}>{([{ key: 'brightness', label: 'Iluminação' }, { key: 'contrast', label: 'Contraste' }, { key: 'saturation', label: 'Cores' }] as const).map(item => <label key={item.key}><span>{item.label}<output>{adjustments[item.key]}%</output></span><input type="range" min={80} max={125} step={1} value={adjustments[item.key]} aria-label={item.label} onChange={event => { setAdjustments(current => ({ ...current, [item.key]: Number(event.target.value) })); setCandidatePhoto(''); }} /></label>)}</fieldset>
          <button type="button" className={s.secondary} disabled={locked} onClick={() => { setAdjustments(defaults); setCandidatePhoto(''); }}>Restaurar ajuste sugerido</button>
          <p className={s.small}>Nesta demonstração, a melhoria ajusta luz e cor. Restauração por IA ainda depende da ativação do adicional.</p>
          {!candidatePhoto ? <button type="button" className={s.primary} disabled={locked} onClick={() => void run('Preparando foto…', async signal => { const result = await enhancePropertyPhoto(original, adjustments, signal); if (active.current && !signal.aborted) setCandidatePhoto(result); })}>{busy || 'Preparar melhoria'}</button> : <>
            <button type="button" className={s.primary} disabled={locked} onClick={() => void run('Aprovando foto…', async () => { await saveDemoPropertyPhoto(property.id, photoIndex, candidatePhoto); await refresh(); if (active.current) { setCandidatePhoto(''); setNotice('Foto aprovada e aplicada ao imóvel no site de demonstração deste navegador. A original foi preservada.'); } })}>Aprovar e usar na demonstração</button>
            <button type="button" className={s.secondary} disabled={locked} onClick={() => downloadMedia(candidatePhoto, `${property.code}-foto-${photoIndex + 1}.jpg`)}>Baixar prévia da foto</button>
          </>}
          {savedPhoto && <div className={s.savedActions}><button type="button" disabled={locked} onClick={() => downloadMedia(savedPhoto, `${property.code}-foto-aprovada-${photoIndex + 1}.jpg`)}>Baixar foto aprovada</button><button type="button" disabled={locked} onClick={() => void run('Restaurando original…', async () => { await saveDemoPropertyPhoto(property.id, photoIndex, null); await refresh(); if (active.current) setNotice('A foto original voltou ao site de demonstração.'); })}>Usar original no site</button></div>}
        </> : <>
          <span className={s.eyebrow}>CRIAR VÍDEO</span><h2>Escolha como apresentar.</h2><p>Prepare uma versão para o site e para baixar e compartilhar nas redes sociais.</p>
          <fieldset className={s.choices} disabled={locked}><legend>Tipo de vídeo</legend><label><input type="radio" name="video-kind" checked={videoKind === 'slides'} onChange={() => { setVideoKind('slides'); setPlaying(false); }} /><span><strong>Apresentação com fotos</strong><small>Movimento suave, título e marca. Disponível para testar.</small></span></label><label><input type="radio" name="video-kind" checked={videoKind === 'camera'} onChange={() => setVideoKind('camera')} /><span><strong>Câmera com IA</strong><small>Modelo de experiência. Geração ainda não ativada.</small></span></label></fieldset>
          <label className={s.format}>Formato<select value={format} disabled={locked || Boolean(candidateVideo)} onChange={event => setFormat(event.target.value as 'landscape' | 'portrait')}><option value="landscape">Horizontal · site e redes</option><option value="portrait">Vertical · stories e reels</option></select></label>
          {videoKind === 'slides' ? <>
            <p className={s.small}>{images.length} fotos · cerca de {images.length * 3} segundos · sem áudio. As fotos aprovadas são usadas na apresentação.</p>
            {!recordingSupported && <p className={s.error}>Este navegador não permite criar vídeos. Experimente uma versão atual do Chrome ou Edge.</p>}
            {!candidateVideo ? <button type="button" className={s.primary} disabled={locked || !recordingSupported} onClick={() => void run('Criando apresentação…', async signal => { setProgress(0); const blob = await createPropertySlideshow({ images, title: property.title, brand: demoContent.brandName, format, signal, onProgress: value => { if (active.current) setProgress(value); } }); if (active.current && !signal.aborted) { setCandidateVideo(blob); setNotice('Apresentação criada. Reproduza o vídeo e aprove quando estiver satisfeito.'); } })}>{busy || 'Criar apresentação'}</button> : <><button type="button" className={s.primary} disabled={locked} onClick={() => void run('Aprovando vídeo…', async () => { await saveDemoPropertyVideo(property.id, candidateVideo); await refresh(); if (active.current) { setCandidateVideo(null); setNotice('Vídeo aprovado. Abra este imóvel no site de demonstração para assistir.'); } })}>Aprovar e usar na demonstração</button><button type="button" className={s.secondary} disabled={locked || !candidateUrl} onClick={() => downloadMedia(candidateUrl, `${property.code}-apresentacao.${candidateVideo.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)}>Baixar prévia do vídeo</button></>}
            {busy === 'Criando apresentação…' && <div className={s.progress} role="status"><progress max={100} value={progress} /><span>{Math.round(progress)}% · mantenha esta aba aberta</span><button type="button" onClick={() => operation.current?.abort()}>Cancelar criação</button></div>}
            {media.video && <div className={s.savedActions}><button type="button" disabled={locked || !savedVideoUrl} onClick={() => downloadMedia(savedVideoUrl, `${property.code}-video-aprovado.${media.video!.type.startsWith('video/mp4') ? 'mp4' : 'webm'}`)}>Baixar vídeo aprovado</button><button type="button" disabled={locked} onClick={() => void run('Retirando vídeo…', async () => { await saveDemoPropertyVideo(property.id, null); await refresh(); if (active.current) setNotice('Vídeo retirado do site de demonstração. As fotos continuam disponíveis.'); })}>Retirar vídeo do site</button></div>}
          </> : <>
            <div className={s.aiNote}><strong>Como será a opção com IA</strong><p>A proposta é gerar movimento de câmera a partir das fotos, com revisão antes de aprovar. Aqui você vê apenas um movimento ilustrativo sobre a foto.</p><p>O serviço de IA, os limites e o preço serão definidos depois. Esta prévia não gera cobrança nem vídeo de IA.</p></div>
            <button type="button" className={s.primary} disabled={locked} onClick={() => setPlaying(current => !current)}>{playing ? 'Pausar prévia ilustrativa' : 'Ver movimento ilustrativo'}</button>
          </>}
        </>}
        {unapproved && <button className={s.textButton} type="button" disabled={locked} onClick={clearPreview}>Descartar prévias não aprovadas</button>}
      </aside>
    </div>}
    <footer className={s.footer}><div><strong>Você decide o que vai para o site.</strong><p>Aprovar → conferir no imóvel → baixar para as redes. Este modelo salva somente neste navegador.</p></div><button type="button" className={s.textButton} disabled={locked} onClick={() => { if (window.confirm('Restaurar as fotos originais e remover o vídeo de demonstração deste imóvel?')) void run('Restaurando demonstração…', async () => { await clearDemoPropertyMedia(property.id); await refresh(); if (active.current) { setCandidatePhoto(''); setCandidateVideo(null); setNotice('Demonstração deste imóvel restaurada.'); } }); }}>Restaurar este imóvel</button></footer>
  </>;
}
