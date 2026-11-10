const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/property-media-renderer.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const photo = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]).toString('base64');

function environment(options = {}) {
  const state = { requests: [], urls: new Set(), images: [], canvases: [], frames: [], exports: [], tracksStopped: 0, recordersStopped: 0, timers: new Set(), draws: [], pixels: [], progress: [], time: 0 };
  const timers = new Map();
  let nextTimer = 1;
  function schedule(fn, delay = 0) {
    const id = nextTimer++;
    const timer = setTimeout(() => { state.timers.delete(id); timers.delete(id); fn(); }, options.fastTimeout && delay >= 15000 ? 25 : delay);
    timers.set(id, timer); state.timers.add(id); return id;
  }
  function cancel(id) { clearTimeout(timers.get(id)); timers.delete(id); state.timers.delete(id); }
  class BrowserURL extends URL {
    static createObjectURL() { const value = `blob:test-${state.urls.size}`; state.urls.add(value); return value; }
    static revokeObjectURL(value) { state.urls.delete(value); }
  }
  class BrowserImage {
    constructor() { this.naturalWidth = options.width || 24; this.naturalHeight = options.height || 12; state.images.push(this); }
    set src(value) { this.value = value; if (!value) { cancel(this.timer); return; } this.timer = schedule(() => { if (options.imageError) this.onerror?.(); else this.onload?.(); }); }
    get src() { return this.value; }
  }
  class Canvas {
    constructor() { this.width = 300; this.height = 150; state.canvases.push(this); }
    getContext() {
      if (options.noContext) return null;
      return { canvas: this, fillRect() {}, save() {}, restore() {},
        drawImage: (...args) => state.draws.push(args),
        getImageData: () => { const pixels = new Uint8ClampedArray(this.width * this.height * 4); for (let i = 0; i < pixels.length; i += 4) pixels.set([90, 120, 160, 255], i); return { data: pixels }; },
        putImageData: pixels => state.pixels.push(pixels.data.slice(0, 4)),
        createLinearGradient: () => ({ addColorStop() {} }),
        measureText: text => ({ width: text.length * 14 }),
        fillText: (...args) => state.frames.push(args),
      };
    }
    toDataURL(type, quality) {
      state.exports.push({ width: this.width, height: this.height, type, quality });
      if (options.oversizedPhoto && state.exports.length === 1) return 'data:image/jpeg;base64,' + 'a'.repeat(2_000_001);
      return photo;
    }
    captureStream(fps) { state.capture = { fps, width: this.width, height: this.height }; return { getTracks: () => [{ stop: () => state.tracksStopped++ }] }; }
  }
  class Recorder {
    static isTypeSupported(type) { return !options.unsupported && type.startsWith(options.mp4 ? 'video/mp4' : 'video/webm'); }
    constructor(stream, settings) { if (options.startFailure) throw new Error('unsupported encoder'); this.state = 'inactive'; this.mimeType = settings.mimeType; }
    start() { this.state = 'recording'; if (options.recordError) schedule(() => this.onerror?.(), 1); }
    stop() {
      if (this.state === 'inactive') return;
      state.recordersStopped++; this.state = 'inactive';
      schedule(() => { this.ondataavailable?.({ data: new Blob([options.oversizedVideo ? new Uint8Array(30_000_001) : 'encoded-video'], { type: this.mimeType }) }); this.onstop?.(); });
    }
  }
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, window: options.noBrowser ? undefined : {}, document: options.noBrowser ? undefined : { createElement: tag => { assert.equal(tag, 'canvas'); return new Canvas(); } },
    HTMLCanvasElement: Canvas, Image: BrowserImage, MediaRecorder: Recorder, URL: BrowserURL, Blob, Uint8Array, Uint8ClampedArray, AbortController, DOMException, TypeError,
    setTimeout: schedule, clearTimeout: cancel, performance: { now: () => state.time },
    requestAnimationFrame: callback => schedule(() => { if (!options.freezeFrames) { state.time += 250; callback(state.time); } }, 1), cancelAnimationFrame: cancel,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    fetch: async (url, settings) => {
      state.requests.push({ url, settings });
      if (options.corsError) throw new TypeError('CORS blocked');
      return new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': options.svg ? 'image/svg+xml' : 'image/jpeg' } });
    },
  };
  vm.runInNewContext(compiled, context, { filename: 'property-media-renderer.ts' });
  state.dispose = () => { for (const id of [...state.timers]) cancel(id); };
  return { ...module.exports, state };
}

async function run() {
  let env = environment();
  try {
    assert(env.canRecordPropertyVideo());
    for (const bad of ['http://images.unsplash.com/photo', 'https://images.unsplash.com.evil.test/photo', 'https://images.unsplash.com@evil.test/photo', 'https://user:password@images.unsplash.com/photo', 'https://images.unsplash.com:444/photo', 'file:///image.jpg', 'blob:foreign', 'data:image/svg+xml;base64,PHN2Zz4=', 'https://127.0.0.1/photo']) {
      await assert.rejects(env.enhancePropertyPhoto(bad, { brightness: 100, contrast: 100, saturation: 100 }));
    }
    await assert.rejects(env.enhancePropertyPhoto(photo, { brightness: NaN, contrast: 100, saturation: 100 }));
    await assert.rejects(env.enhancePropertyPhoto('data:image/jpeg;base64,PHN2Zz4=', { brightness: 100, contrast: 100, saturation: 100 }), /conteúdo/);
    assert.equal(env.state.requests.length, 0, 'Rejected sources do not perform any network request');
    await env.enhancePropertyPhoto(photo, { brightness: 100, contrast: 100, saturation: 100 });
    assert.deepEqual([...env.state.pixels[0]], [90, 120, 160, 255], 'Neutral adjustments preserve the pixels');
    assert.equal(env.state.urls.size, 0, 'Decoded object URLs are revoked');
    assert(env.state.images.every(image => image.src === ''), 'Decoded photos are released after export');
    await env.enhancePropertyPhoto(photo, { brightness: 100, contrast: 100, saturation: 0 });
    const gray = env.state.pixels[1]; assert.equal(gray[0], gray[1]); assert.equal(gray[1], gray[2]); assert.equal(gray[3], 255);
    await env.enhancePropertyPhoto('https://images.unsplash.com/photo-example', { brightness: 108, contrast: 104, saturation: 103 });
    assert.equal(env.state.requests.length, 1);
    assert.deepEqual({ ...env.state.requests[0].settings, signal: undefined }, { mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: undefined }, 'Remote loads are CORS checked and never forward credentials or follow redirects');
  } finally { env.state.dispose(); }

  env = environment({ width: 3200, height: 1600, oversizedPhoto: true });
  try {
    const result = await env.enhancePropertyPhoto(photo, { brightness: 100, contrast: 100, saturation: 100 });
    assert(result.length <= 2_000_000);
    assert.deepEqual(env.state.exports[0], { width: 1600, height: 800, type: 'image/jpeg', quality: .9 });
    assert(env.state.exports[1].quality < env.state.exports[0].quality, 'Oversized JPEG is compressed before returning');
  } finally { env.state.dispose(); }

  for (const failure of [{ corsError: true }, { svg: true }, { imageError: true }, { noContext: true }]) {
    env = environment(failure);
    try { await assert.rejects(env.enhancePropertyPhoto('https://images.unsplash.com/photo-example', { brightness: 100, contrast: 100, saturation: 100 })); assert.equal(env.state.urls.size, 0); }
    finally { env.state.dispose(); }
  }

  const cancelled = new AbortController(); cancelled.abort();
  env = environment();
  try { await assert.rejects(env.enhancePropertyPhoto(photo, { brightness: 100, contrast: 100, saturation: 100 }, cancelled.signal), { name: 'AbortError' }); assert.equal(env.state.images.length, 0); }
  finally { env.state.dispose(); }

  const options = { images: [photo, photo], title: 'Apartamento com varanda e vista', brand: 'Imobiliária de exemplo', format: 'landscape' };
  for (const format of ['landscape', 'portrait']) {
    env = environment({ mp4: format === 'portrait' });
    try {
      const input = { ...options, images: [...options.images], format, onProgress: value => env.state.progress.push(value) };
      const blob = await env.createPropertySlideshow(input);
      assert(blob.size > 0 && blob.size <= 30_000_000);
      assert.equal(blob.type.split(';')[0], format === 'portrait' ? 'video/mp4' : 'video/webm');
      assert.deepEqual(env.state.capture, { fps: 24, width: format === 'portrait' ? 720 : 1280, height: format === 'portrait' ? 1280 : 720 });
      assert.equal(env.state.time, 6000, 'Two photos record for three seconds each');
      assert.equal(env.state.progress[0], 0); assert.equal(env.state.progress.at(-1), 100);
      assert(env.state.progress.every((value, index, values) => index === 0 || value >= values[index - 1]));
      assert.equal(env.state.tracksStopped, 1); assert.equal(env.state.recordersStopped, 1); assert.equal(env.state.urls.size, 0);
      assert.deepEqual(input.images, options.images, 'The original photo list is not mutated');
      assert(env.state.frames.some(([text]) => text === options.title));
      assert(env.state.images.every(image => image.src === ''));
      assert.equal(env.state.timers.size, 0, 'Successful rendering leaves no timer running');
    } finally { env.state.dispose(); }
  }

  for (const failure of [{ unsupported: true }, { startFailure: true }, { recordError: true }, { oversizedVideo: true }, { freezeFrames: true, fastTimeout: true }]) {
    env = environment(failure);
    try {
      await assert.rejects(env.createPropertySlideshow(options));
      assert.equal(env.state.urls.size, 0);
      if (env.state.capture) assert.equal(env.state.tracksStopped, 1, 'Failure releases the canvas stream');
      assert(env.state.images.every(image => image.src === ''));
      await new Promise(resolve => setTimeout(resolve, 3));
      assert.equal(env.state.timers.size, 0, 'Failure clears recording, image and timeout tasks');
    } finally { env.state.dispose(); }
  }

  env = environment();
  try {
    const controller = new AbortController();
    await assert.rejects(env.createPropertySlideshow({ ...options, signal: controller.signal, onProgress: value => { if (value > 20) controller.abort(); } }), { name: 'AbortError' });
    assert.equal(env.state.tracksStopped, 1); assert.equal(env.state.urls.size, 0);
    for (const input of [{ ...options, images: [] }, { ...options, images: Array(6).fill(photo) }, { ...options, format: 'square' }, { ...options, brand: '' }, { ...options, images: ['https://other.example/photo.jpg'] }]) await assert.rejects(env.createPropertySlideshow(input));
    assert.equal(env.state.requests.length, 0);
  } finally { env.state.dispose(); }
  env = environment({ noBrowser: true });
  try { assert.equal(env.canRecordPropertyVideo(), false); await assert.rejects(env.createPropertySlideshow(options), /navegador/); }
  finally { env.state.dispose(); }
  console.log('PASS property media renderer: browser-only raster sources, CORS/redirect isolation, aspect/size bounds, real recorder contract, format fallback, immutable inputs, cancellation, timeouts and resource cleanup.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
