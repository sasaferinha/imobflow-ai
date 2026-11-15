/** Browser-only photo adjustments and slideshow export. No AI or server upload. */
export type PhotoAdjustments = { brightness: number; contrast: number; saturation: number };
export type PropertySlideshowOptions = {
  images: string[];
  title: string;
  brand: string;
  format: 'landscape' | 'portrait';
  /** 2–6 seconds per photo. The input list determines the photo order. */
  secondsPerPhoto?: number;
  /** Optical movement of the original photo; no generated scene or invented details. */
  motion?: 'gentle' | 'pan' | 'none';
  signal?: AbortSignal;
  /** Progress from 0 to 100, including photo loading. */
  onProgress?: (value: number) => void;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_PHOTO_DATA_URL = 2_000_000;
const MAX_VIDEO_BYTES = 30_000_000;
const PHOTO_EDGE = 1600;
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function abortError() { return new DOMException('Geração cancelada.', 'AbortError'); }
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
function requireBrowser() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('Abra esta função no navegador para preparar a mídia.');
}

function validateSource(source: string) {
  if (typeof source !== 'string' || !source || source.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) throw new Error('Escolha uma foto JPEG, PNG ou WebP de até 12 MB.');
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (!/^data:image\/(jpeg|png|webp);base64,$/.test(source.slice(0, comma + 1))) throw new Error('Use somente fotos JPEG, PNG ou WebP.');
    return;
  }
  let url: URL;
  try { url = new URL(source, typeof window === 'undefined' ? undefined : window.location?.origin); } catch { throw new Error('O endereço da foto é inválido.'); }
  const localDemo = typeof window !== 'undefined' && url.origin === window.location?.origin && /^\/demo-media\/[a-z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname) && !url.search;
  const remoteDemo = url.protocol === 'https:' && url.hostname === 'images.unsplash.com' && !url.port;
  if (source.length > 4096 || !(localDemo || remoteDemo) || url.username || url.password || url.hash) {
    throw new Error('Neste modelo, use as fotos de exemplo ou uma imagem JPEG, PNG ou WebP carregada na página.');
  }
}

function validRasterHeader(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (type === 'image/webp') return [82, 73, 70, 70].every((byte, index) => bytes[index] === byte) && [87, 69, 66, 80].every((byte, index) => bytes[index + 8] === byte);
  return false;
}

function rasterBlob(source: string) {
  const match = DATA_IMAGE.exec(source);
  if (!match || match[2].length % 4 !== 0) throw new Error('A foto está incompleta ou em formato inválido.');
  let binary: string;
  try { binary = atob(match[2]); } catch { throw new Error('A foto está em formato inválido.'); }
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) throw new Error('Escolha uma foto de até 12 MB.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (!validRasterHeader(bytes, `image/${match[1]}`)) throw new Error('O conteúdo da foto não corresponde ao formato informado.');
  return new Blob([bytes], { type: `image/${match[1]}` });
}

/** Imports a local raster photo without uploading it; export strips metadata and bounds dimensions. */
export async function preparePropertyPhotoFile(file: File, signal?: AbortSignal): Promise<string> {
  requireBrowser(); checkAbort(signal);
  if (!(file instanceof Blob) || !/^image\/(jpeg|png|webp)$/.test(file.type) || !file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Escolha uma foto JPEG, PNG ou WebP de até 12 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAbort(signal);
  if (!validRasterHeader(bytes, file.type)) throw new Error('O conteúdo da foto não corresponde ao formato informado.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return enhancePropertyPhoto(`data:${file.type};base64,${btoa(binary)}`, { brightness: 100, contrast: 100, saturation: 100 }, signal);
}

async function remoteBlob(source: string, signal: AbortSignal) {
  const response = await fetch(source, { mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal });
  if (!response.ok || !/^image\/(jpeg|png|webp|avif)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('A foto não está disponível em um formato compatível.');
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_IMAGE_BYTES) throw new Error('Escolha uma foto de até 12 MB.');
  if (!response.body) {
    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('Escolha uma foto de até 12 MB.');
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      checkAbort(signal);
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error('Escolha uma foto de até 12 MB.');
      chunks.push(new Uint8Array(result.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (!size) throw new Error('A foto recebida está vazia.');
  return new Blob(chunks, { type: response.headers.get('content-type') || 'image/jpeg' });
}

async function loadImage(source: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  validateSource(source); checkAbort(signal);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
  let objectUrl = '';
  try {
    const blob = source.startsWith('data:') ? rasterBlob(source) : await remoteBlob(source, controller.signal);
    checkAbort(controller.signal);
    objectUrl = URL.createObjectURL(blob);
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      const cleanup = () => { image.onload = null; image.onerror = null; controller.signal.removeEventListener('abort', cancel); };
      const fail = (error: Error) => { cleanup(); image.src = ''; reject(error); };
      const cancel = () => fail(abortError());
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 20000 || image.naturalHeight > 20000 || image.naturalWidth * image.naturalHeight > 100_000_000) { fail(new Error('A foto tem dimensões muito grandes ou inválidas.')); return; }
        cleanup(); resolve(image);
      };
      image.onerror = () => fail(new Error('Não foi possível abrir a foto. Use outro arquivo JPEG, PNG ou WebP.'));
      image.decoding = 'async';
      controller.signal.addEventListener('abort', cancel, { once: true });
      image.src = objectUrl;
      if (controller.signal.aborted) cancel();
    });
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error('A foto demorou demais para carregar. Tente outra imagem ou confira a conexão.');
    if (error instanceof TypeError) throw new Error('Não foi possível carregar a foto. A conexão ou a permissão de acesso à imagem (CORS) pode estar bloqueada.');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function pause(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    checkAbort(signal);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, 0);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** Percentages: 100 keeps the original; brightness/contrast 50–150, saturation 0–200. */
export async function enhancePropertyPhoto(source: string, adjustments: PhotoAdjustments, signal?: AbortSignal): Promise<string> {
  requireBrowser(); checkAbort(signal); validateSource(source);
  if (!adjustments || ![adjustments.brightness, adjustments.contrast, adjustments.saturation].every(Number.isFinite) || adjustments.brightness < 50 || adjustments.brightness > 150 || adjustments.contrast < 50 || adjustments.contrast > 150 || adjustments.saturation < 0 || adjustments.saturation > 200) throw new Error('Escolha ajustes de brilho e contraste entre 50 e 150, e saturação entre 0 e 200.');
  const brightness = adjustments.brightness / 100, contrast = adjustments.contrast / 100, saturation = adjustments.saturation / 100;
  return renderPropertyPhoto(source, async (pixels, width) => {
    await transformPhotoPixels(pixels, width, index => {
      const red = (pixels[index] * brightness - 128) * contrast + 128;
      const green = (pixels[index + 1] * brightness - 128) * contrast + 128;
      const blue = (pixels[index + 2] * brightness - 128) * contrast + 128;
      const luminance = red * .2126 + green * .7152 + blue * .0722;
      pixels[index] = luminance + (red - luminance) * saturation;
      pixels[index + 1] = luminance + (green - luminance) * saturation;
      pixels[index + 2] = luminance + (blue - luminance) * saturation;
    }, signal);
  }, signal);
}

async function transformPhotoPixels(pixels: Uint8ClampedArray, width: number, transform: (index: number) => void, signal?: AbortSignal) {
  const chunkSize = width * 64 * 4;
  for (let offset = 0; offset < pixels.length; offset += chunkSize) {
    await pause(signal);
    for (let index = offset; index < Math.min(pixels.length, offset + chunkSize); index += 4) transform(index);
  }
}

/** Automatic, bounded tonal correction of existing pixels. No generated content or AI restoration. */
export async function autoEnhancePropertyPhoto(source: string, signal?: AbortSignal): Promise<string> {
  return renderPropertyPhoto(source, async (pixels, width) => {
    const histogram = new Uint32Array(256);
    await transformPhotoPixels(pixels, width, index => {
      histogram[Math.round(pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722)]++;
    }, signal);
    const middle = Math.ceil(pixels.length / 8);
    let accumulated = 0, median = 0;
    for (; median < 255; median++) { accumulated += histogram[median]; if (accumulated >= middle) break; }
    // Leave already balanced photographs alone. Limit any correction so that
    // a dark room never becomes a different scene and bright interiors stay natural.
    let gamma = 1;
    if (median > 0 && median < 100) gamma = Math.max(.82, Math.log(Math.min(112, median + 24) / 255) / Math.log(median / 255));
    else if (median > 180 && median < 255) gamma = Math.min(1.12, Math.log(Math.max(170, median - 16) / 255) / Math.log(median / 255));
    if (gamma === 1) return;
    await transformPhotoPixels(pixels, width, index => {
      const red = pixels[index], green = pixels[index + 1], blue = pixels[index + 2];
      const luminance = red * .2126 + green * .7152 + blue * .0722;
      if (luminance <= 0) return;
      let corrected = 255 * Math.pow(luminance / 255, gamma);
      if (gamma < 1) {
        const highlight = Math.max(0, Math.min(1, (luminance - 190) / 40));
        const protection = highlight * highlight * (3 - 2 * highlight);
        corrected = corrected * (1 - protection) + luminance * protection;
      }
      // Scale RGB together to retain hue. The gamut limit prevents clipping
      // any channel, including saturated colors inside an otherwise dark room.
      const gain = Math.min(corrected / luminance, 255 / Math.max(red, green, blue));
      pixels[index] = red * gain; pixels[index + 1] = green * gain; pixels[index + 2] = blue * gain;
    }, signal);
  }, signal);
}

async function renderPropertyPhoto(source: string, transform: (pixels: Uint8ClampedArray, width: number) => Promise<void>, signal?: AbortSignal): Promise<string> {
  requireBrowser(); checkAbort(signal); validateSource(source);
  const image = await loadImage(source, signal);
  const canvases: HTMLCanvasElement[] = [];
  try {
    checkAbort(signal);
    let canvas = document.createElement('canvas'); canvases.push(canvas);
    const scale = Math.min(1, PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Este navegador não conseguiu preparar a foto.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    await transform(pixels.data, canvas.width);
    context.putImageData(pixels, 0, 0);
    for (let resize = 0; resize < 6; resize++) {
      for (const quality of [.9, .8, .7, .6]) {
        await pause(signal);
        const result = canvas.toDataURL('image/jpeg', quality);
        if (!result.startsWith('data:image/jpeg;base64,')) throw new Error('Este navegador não conseguiu exportar a foto em JPEG.');
        if (result.length <= MAX_PHOTO_DATA_URL) return result;
      }
      const smaller = document.createElement('canvas'); canvases.push(smaller);
      smaller.width = Math.max(1, Math.round(canvas.width * .8)); smaller.height = Math.max(1, Math.round(canvas.height * .8));
      const smallerContext = smaller.getContext('2d');
      if (!smallerContext) throw new Error('Não foi possível reduzir a foto.');
      smallerContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas.width = 1; canvas.height = 1; canvas = smaller;
    }
    throw new Error('Não foi possível reduzir a foto para 2 MB. Tente outra imagem.');
  } finally {
    image.src = '';
    canvases.forEach(canvas => { canvas.width = 1; canvas.height = 1; });
  }
}

function recordingType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return VIDEO_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || '';
}
export function canRecordPropertyVideo(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function' && Boolean(recordingType());
}

function cleanText(value: string, limit: number) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : ''; }
function textLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let rest = text;
  while (rest && lines.length < maxLines) {
    if (context.measureText(rest).width <= maxWidth) { lines.push(rest); break; }
    const characters = Array.from(rest), finalLine = lines.length === maxLines - 1;
    let count = characters.length;
    while (count > 1 && context.measureText(characters.slice(0, count).join('') + (finalLine ? '…' : '')).width > maxWidth) count--;
    let fragment = characters.slice(0, count).join('');
    if (finalLine) { lines.push(fragment.trimEnd() + '…'); break; }
    const wordBreak = fragment.lastIndexOf(' ');
    if (wordBreak > 0) fragment = fragment.slice(0, wordBreak);
    lines.push(fragment); rest = rest.slice(fragment.length).trimStart();
  }
  return lines;
}

function drawSlide(context: CanvasRenderingContext2D, images: HTMLImageElement[], elapsed: number, title: string, brand: string, portrait: boolean, slideMs: number, motion: NonNullable<PropertySlideshowOptions['motion']>) {
  const width = context.canvas.width, height = context.canvas.height;
  const index = Math.min(images.length - 1, Math.floor(elapsed / slideMs));
  const progress = Math.min(1, (elapsed - index * slideMs) / slideMs), image = images[index];
  const smooth = progress * progress * (3 - 2 * progress);
  context.fillStyle = '#0b182c'; context.fillRect(0, 0, width, height);
  const background = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  context.save(); context.globalAlpha = .23;
  context.drawImage(image, (width - image.naturalWidth * background) / 2, (height - image.naturalHeight * background) / 2, image.naturalWidth * background, image.naturalHeight * background);
  context.restore();
  // The main photo fits completely; the subtle movement never stretches it.
  const fit = Math.min(width / image.naturalWidth, height / image.naturalHeight) * (motion === 'gentle' ? .95 + .04 * (index % 2 ? 1 - smooth : smooth) : .95);
  const photoWidth = image.naturalWidth * fit, photoHeight = image.naturalHeight * fit;
  const pan = motion === 'pan' ? (smooth * 2 - 1) * (index % 2 ? -1 : 1) : 0;
  const x = (width - photoWidth) / 2 + Math.min((width - photoWidth) / 2, width * .025) * pan;
  const y = (height - photoHeight) / 2 + Math.min((height - photoHeight) / 2, height * .015) * pan;
  context.drawImage(image, x, y, photoWidth, photoHeight);
  const gradient = context.createLinearGradient(0, height * .52, 0, height);
  gradient.addColorStop(0, 'rgba(5,16,32,0)'); gradient.addColorStop(1, 'rgba(5,16,32,.95)');
  context.fillStyle = gradient; context.fillRect(0, height * .52, width, height * .48);
  const margin = portrait ? 44 : 56;
  context.font = `600 ${portrait ? 25 : 24}px Arial, sans-serif`;
  const brandText = textLines(context, brand, width - margin * 2 - 100, 1)[0] || '';
  context.fillStyle = 'rgba(5,16,32,.74)'; context.fillRect(margin - 12, 30, Math.min(context.measureText(brandText).width + 24, width - margin * 2), 48);
  context.fillStyle = '#fff'; context.textBaseline = 'middle'; context.fillText(brandText, margin, 54);
  context.textAlign = 'right'; context.font = '600 20px Arial, sans-serif'; context.fillText(`${index + 1} / ${images.length}`, width - margin, 54); context.textAlign = 'left';
  const fontSize = portrait ? 44 : 42, lineHeight = fontSize * 1.2;
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  const lines = textLines(context, title, width - margin * 2, portrait ? 3 : 2);
  const top = height - (portrait ? 100 : 72) - (lines.length - 1) * lineHeight;
  lines.forEach((line, lineIndex) => context.fillText(line, margin, top + lineIndex * lineHeight));
  context.fillStyle = 'rgba(255,255,255,.25)'; context.fillRect(margin, height - 30, width - margin * 2, 3);
  context.fillStyle = '#fff'; context.fillRect(margin, height - 30, (width - margin * 2) * Math.min(1, elapsed / (images.length * slideMs)), 3);
}

function record(canvas: HTMLCanvasElement, images: HTMLImageElement[], title: string, brand: string, portrait: boolean, slideMs: number, motion: NonNullable<PropertySlideshowOptions['motion']>, signal: AbortSignal, onProgress: (value: number) => void): Promise<Blob> {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Este navegador não conseguiu preparar o vídeo.');
  const mimeType = recordingType();
  if (!mimeType) throw new Error('Este navegador não oferece exportação de vídeo. Tente Chrome ou Edge atualizados.');
  checkAbort(signal);
  drawSlide(context, images, 0, title, brand, portrait, slideMs, motion);
  const stream = canvas.captureStream(24);
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_500_000 }); }
  catch { stream.getTracks().forEach(track => track.stop()); throw new Error('Não foi possível iniciar a exportação neste navegador.'); }
  return new Promise<Blob>((resolve, reject) => {
    const chunks: Blob[] = [];
    let size = 0, settled = false, finished = false, frame = 0;
    const duration = images.length * slideMs;
    const started = performance.now();
    const cleanup = () => {
      cancelAnimationFrame(frame); clearTimeout(timeout); signal.removeEventListener('abort', cancel);
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      if (recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* Tracks are stopped below even if the recorder already stopped. */ } }
      stream.getTracks().forEach(track => track.stop());
    };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const cancel = () => fail(abortError());
    const timeout = setTimeout(() => fail(new Error('O navegador demorou demais para gerar o vídeo. Mantenha esta aba visível e tente novamente.')), duration + 15000);
    recorder.ondataavailable = event => {
      if (settled || !event.data.size) return;
      size += event.data.size;
      if (size > MAX_VIDEO_BYTES) { fail(new Error('O vídeo ultrapassou 30 MB. Use menos fotos.')); return; }
      chunks.push(event.data);
    };
    recorder.onerror = () => fail(new Error('O navegador interrompeu a exportação do vídeo. Tente novamente com menos fotos.'));
    recorder.onstop = () => {
      if (settled) return;
      if (!finished || !size) { fail(new Error('A exportação foi interrompida antes de concluir. Nenhum vídeo completo foi gerado.')); return; }
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      settled = true; cleanup(); onProgress(100); resolve(blob);
    };
    const tick = () => {
      if (settled || finished) return;
      try {
        checkAbort(signal);
        const elapsed = Math.min(duration, performance.now() - started);
        drawSlide(context, images, elapsed, title, brand, portrait, slideMs, motion);
        onProgress(10 + Math.floor(elapsed / duration * 89));
        if (settled) return;
        if (elapsed >= duration) { finished = true; recorder.stop(); return; }
        frame = requestAnimationFrame(tick);
      } catch (error) { fail(error instanceof Error ? error : new Error('Não foi possível desenhar o vídeo.')); }
    };
    signal.addEventListener('abort', cancel, { once: true });
    try { recorder.start(250); frame = requestAnimationFrame(tick); if (signal.aborted) cancel(); }
    catch { fail(new Error('Não foi possível iniciar a gravação do vídeo neste navegador.')); }
  });
}

export async function createPropertySlideshow({ images, title, brand, format, secondsPerPhoto = 3, motion = 'gentle', signal, onProgress }: PropertySlideshowOptions): Promise<Blob> {
  requireBrowser(); checkAbort(signal);
  if (!Array.isArray(images) || images.length < 1 || images.length > 5) throw new Error('Escolha entre uma e cinco fotos para o vídeo.');
  if (format !== 'landscape' && format !== 'portrait') throw new Error('Escolha o formato horizontal ou vertical.');
  if (!Number.isFinite(secondsPerPhoto) || secondsPerPhoto < 2 || secondsPerPhoto > 6) throw new Error('Escolha uma duração entre 2 e 6 segundos por foto.');
  if (!['gentle', 'pan', 'none'].includes(motion)) throw new Error('Escolha um movimento de vídeo válido.');
  const sources = [...images];
  sources.forEach(validateSource);
  const safeTitle = cleanText(title, 200), safeBrand = cleanText(brand, 80);
  if (!safeTitle || !safeBrand) throw new Error('Informe o título do imóvel e o nome da imobiliária.');
  if (!canRecordPropertyVideo()) throw new Error('Este navegador não oferece exportação de vídeo. Tente Chrome ou Edge atualizados.');
  const controller = new AbortController();
  let timedOut = false, lastProgress = -1;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, sources.length * (15000 + secondsPerPhoto * 1000) + 15000);
  const loaded: HTMLImageElement[] = [];
  const canvas = document.createElement('canvas');
  const progress = (value: number) => { const next = Math.max(lastProgress, Math.min(100, Math.floor(value))); if (next !== lastProgress) { lastProgress = next; try { onProgress?.(next); } catch { /* A UI callback must not prevent recorder cleanup. */ } } };
  try {
    progress(0);
    for (let index = 0; index < sources.length; index++) { loaded.push(await loadImage(sources[index], controller.signal)); progress(Math.floor((index + 1) / sources.length * 10)); }
    const portrait = format === 'portrait'; canvas.width = portrait ? 720 : 1280; canvas.height = portrait ? 1280 : 720;
    return await record(canvas, loaded, safeTitle, safeBrand, portrait, secondsPerPhoto * 1000, motion, controller.signal, progress);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new Error('O vídeo demorou demais para ser concluído. Mantenha esta aba visível e tente novamente.');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
    loaded.forEach(image => { image.src = ''; }); canvas.width = 1; canvas.height = 1;
  }
}
