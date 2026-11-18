const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = fs.readFileSync(path.join(__dirname, '../app/modelo-imobiliaria/midias/studio.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const imported = 'data:image/jpeg;base64,/9j/aW1wb3J0ZWQ=';
const upload = 'data:image/jpeg;base64,/9j/dXBsb2Fk';
const property = { id: 'demo-casa-jardim', code: 'HZ001', title: 'Imóvel fictício de teste', images: ['https://images.unsplash.com/photo-one', 'https://images.unsplash.com/photo-two', 'https://images.unsplash.com/photo-three'] };
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(node) { if (node === null || node === undefined || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); if (Array.isArray(node)) return node.map(text).join(''); return text(node.props?.children); }

class MediaAiRequestError extends Error { constructor(message, ambiguous = false) { super(message); this.ambiguous = ambiguous; } }
const makeJob = (patch = {}) => ({ id: 'job-1', kind: 'photo', propertyId: property.id, photoIndex: 0, format: 'landscape', status: 'completed', createdAt: '2026-11-17T12:00:00Z', expiresAt: '2026-11-18T12:00:00Z', resultAvailable: true, ...patch });
function fixture({ storageFail = false, pendingVideo = false, access = 'ready', available = true, aiNetworkFailure = false, aiProviderFailure = false, pendingAiResult = false, photoOrientation = 'landscape', jobPatch = {}, jobs = [] } = {}) {
  const hooks = [], listeners = new Map(), calls = { enhanced: [], imported: [], videos: [], savedPhotos: [], savedVideos: [], urls: [], revoked: [], locked: [], downloads: [], aiRequests: [], aiResults: [], aiRead: [], access: 0 };
  const store = { [property.id]: { photos: {}, video: null } };
  let cursor = 0, effects = [], component, props, tree, allowConfirm = true;
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: { current: initial } }; return hooks[index].value; },
    useEffect(fn, deps) { const index = cursor++; const previous = hooks[index]; if (!previous || !deps || deps.some((item, i) => !Object.is(item, previous.deps?.[i]))) { hooks[index] = { ...previous, deps }; effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = fn(); }); } },
  };
  class BrowserURL extends URL { static createObjectURL(blob) { const url = `blob:https://imobflow.test/${calls.urls.length}`; calls.urls.push({ blob, url }); return url; } static revokeObjectURL(url) { calls.revoked.push(url); } }
  class BrowserImage { naturalWidth = photoOrientation === 'portrait' ? 700 : 1000; naturalHeight = photoOrientation === 'portrait' ? 1000 : 700; set src(value) { if (value) { assert.equal(value, upload, 'Orientation is read from the already-prepared photo'); queueMicrotask(() => this.onload?.()); } } }
  const renderer = {
    canRecordPropertyVideo: () => true,
    preparePropertyPhotoFile: async (file, signal) => { calls.imported.push({ file, signal }); if (file.name === 'bad.svg') throw new Error('Formato de foto inválido.'); return file.name === 'foto-ia.jpg' ? photo : imported; },
    enhancePropertyPhoto: async (source, adjustments, signal) => { calls.enhanced.push({ source, adjustments, signal }); return upload; },
    createPropertySlideshow: async options => { calls.videos.push(options); if (pendingVideo) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); options.onProgress(100); return new Blob(['video-test'], { type: 'video/mp4' }); },
  };
  let currentJob, releaseAi;
  const ai = {
    MediaAiRequestError,
    getMediaAiStatus: async () => { calls.access++; return { access, photo: { available }, video: { available }, jobs }; },
    createMediaAiJob: async input => { calls.aiRequests.push(input); if (aiNetworkFailure && calls.aiRequests.length === 1) throw new MediaAiRequestError('Confirmação interrompida.', true); if (aiProviderFailure) throw new MediaAiRequestError('Fornecedor indisponível.'); currentJob = makeJob({ ...input, ...jobPatch }); return currentJob; },
    followMediaAiJob: async (job, signal, onUpdate) => { onUpdate(job); return job; },
    readMediaAiJob: async id => { calls.aiRead.push(id); return jobs.find(job => job.id === id) || currentJob; },
    refreshMediaAiJob: async id => { calls.aiRead.push(id); return jobs.find(job => job.id === id) || currentJob; },
    loadMediaAiResult: async (job, signal) => { calls.aiResults.push(job); const result = new Blob(['real-provider-result-mock'], { type: job.kind === 'photo' ? 'image/jpeg' : 'video/mp4' }); if (pendingAiResult) return new Promise((resolve, reject) => { releaseAi = () => resolve(result); signal.addEventListener('abort', () => reject(new Error('Monitoring stopped')), { once: true }); }); return result; },
  };
  const storage = {
    loadDemoPropertyMedia: async () => { if (storageFail) throw new Error('quota'); return structuredClone(store); },
    saveDemoPropertyPhoto: async (id, index, value) => { assert.equal(id, property.id); calls.savedPhotos.push({ id, index, value }); if (value === null) delete store[id].photos[index]; else store[id].photos[index] = value; },
    saveDemoPropertyVideo: async (id, value) => { assert.equal(id, property.id); calls.savedVideos.push({ id, value }); store[id].video = value; },
    clearDemoPropertyMedia: async id => { assert.equal(id, property.id); store[id] = { photos: {}, video: null }; },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, Error, DOMException, Blob, File, Image: BrowserImage, URL: BrowserURL, AbortController, crypto: require('node:crypto').webcrypto,
    requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {},
    fetch: () => assert.fail('The UI uses the authenticated media client, never calls a provider directly'),
    window: { confirm: () => allowConfirm, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    document: { createElement(tag) { assert.equal(tag, 'a'); const anchor = { click() { calls.downloads.push({ href: anchor.href, name: anchor.download }); }, remove() {} }; return anchor; }, body: { appendChild() {} } },
    require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.css')) return { __esModule: true, default: {} };
      if (id === '@/lib/website/demo') return { demoContent: { brandName: 'Horizonte Imobiliária' }, demoProperties: [property] };
      if (id === '@/lib/website/demo-property-media') return storage;
      if (id === '@/lib/property-media-renderer') return renderer;
      if (id === '@/lib/media-studio/client') return ai;
      assert.fail(`Unexpected dependency: ${id}`);
    },
  });
  // Obtain the real nested component from the public page, not a copy of its logic.
  const initial = module.exports.default();
  const child = nodes(initial).find(node => typeof node.type === 'function');
  assert(child); component = child.type; props = { ...child.props, onBusy: value => calls.locked.push(value) }; hooks.length = 0; cursor = 0;
  const render = () => { cursor = 0; effects = []; tree = component(props); effects.forEach(fn => fn()); return tree; };
  function find(predicate) { const matches = nodes(tree).filter(predicate); assert.equal(matches.length, 1, `Expected one node; found ${matches.length}`); return matches[0]; }
  const button = label => find(node => node.type === 'button' && text(node) === label);
  const byLabel = label => find(node => node.props?.['aria-label'] === label);
  const select = label => { const wrapping = find(node => node.type === 'label' && text(node).startsWith(label)); return nodes(wrapping).find(node => node.type === 'select'); };
  const file = () => find(node => node.type === 'input' && node.props.type === 'file');
  const settle = async () => { await tick(); render(); await tick(); render(); };
  const dispose = () => hooks.forEach(hook => hook.cleanup?.());
  render();
  const radio = label => { const wrapping = find(node => node.type === 'label' && text(node).startsWith(label)); return nodes(wrapping).find(node => node.type === 'input'); };
  return { calls, store, render, settle, button, byLabel, select, file, radio, text: () => text(tree), confirm: value => { allowConfirm = value; }, releaseAi: () => releaseAi(), dispose };
}

async function run() {
  const ui = fixture(); await ui.settle();
  assert.equal(ui.calls.aiRequests.length, 0, 'Opening a public demo only checks access; it never starts a paid generation');
  assert(!/Escolha o ajuste|Ajustar manualmente|Contraste|Iluminação|Clarear|Natural|Equilibrad/.test(ui.text()), 'Photo enhancement is a single action without manual or preset choices');
  ui.button('Aprimorar foto').props.onClick(); await ui.settle();
  assert.equal(ui.calls.enhanced[0].source, property.images[0]);
  assert(ui.calls.enhanced[0].signal instanceof AbortSignal);
  assert.deepEqual({ ...ui.calls.enhanced[0].adjustments }, { brightness: 100, contrast: 100, saturation: 100 }, 'Local rendering is neutral upload preparation');
  assert.equal(ui.calls.aiRequests[0].imageDataUrl, upload);
  assert.equal(ui.calls.aiResults.length, 1, 'A candidate is fetched from the completed authenticated job');
  assert.notEqual(photo, upload, 'A neutral input is never passed off as the AI output');
  assert.equal(ui.calls.savedPhotos.length, 0, 'Preparing never changes the public demonstration');
  assert.equal(ui.button('Criar vídeo').props.disabled, true, 'A photo draft must be approved or discarded before changing tools');
  ui.button('Aprovar e usar no site de demonstração').props.onClick(); await ui.settle();
  assert.equal(ui.calls.savedPhotos[0].index, 0); assert.equal(ui.store[property.id].photos[0], photo);
  assert(ui.text().includes('Versão aprovada'));

  ui.button('Sala clara').props.onClick(); ui.render();
  ui.button('Aprimorar foto').props.onClick(); await ui.settle();
  assert.equal(ui.calls.enhanced.at(-1).source, '/demo-media/sala-clara.jpg');
  ui.confirm(false); ui.byLabel('Editar foto 2').props.onClick(); ui.render();
  assert.equal(ui.calls.savedPhotos.length, 1, 'Declining discard does not approve a new example');
  ui.confirm(true); ui.byLabel('Editar foto 2').props.onClick(); ui.render();
  ui.button('Aprimorar foto').props.onClick(); await ui.settle();
  assert.equal(ui.calls.enhanced.at(-1).source, property.images[1], 'Changing photo discards the temporary example source');
  ui.button('Descartar prévia').props.onClick(); ui.render();
  const event = { target: { files: [{ name: 'minha-foto.jpg' }], value: 'chosen-file' } };
  ui.file().props.onChange(event); await ui.settle(); assert.equal(event.target.value, '');
  ui.button('Aprimorar foto').props.onClick(); await ui.settle();
  assert.equal(ui.calls.enhanced.at(-1).source, imported);
  ui.button('Aprovar e usar no site de demonstração').props.onClick(); await ui.settle();
  assert.equal(ui.calls.savedPhotos.at(-1).index, 1, 'An upload can replace only the selected fictional photo slot');
  ui.button('Aprimorar foto').props.onClick(); await ui.settle();
  assert.equal(ui.calls.enhanced.at(-1).source, photo, 'Editing an approved replacement keeps that photo, never silently returns to a different catalogue original');
  ui.button('Descartar prévia').props.onClick(); ui.render();

  ui.button('Criar vídeo').props.onClick(); ui.render();
  ui.byLabel('Incluir foto 2 no vídeo').props.onChange({ target: { checked: false } }); ui.render();
  ui.byLabel('Mover foto 3 para antes').props.onClick(); ui.render();
  ui.select('Tempo por foto').props.onChange({ target: { value: '5' } }); ui.render();
  ui.select('Movimento').props.onChange({ target: { value: 'pan' } }); ui.render();
  ui.select('Formato').props.onChange({ target: { value: 'portrait' } }); ui.render();
  ui.button('Criar apresentação').props.onClick(); await ui.settle();
  const options = ui.calls.videos[0];
  assert.deepEqual(Array.from(options.images), [property.images[2], photo], 'Only selected photos, in chosen order; approved photo overlays are used');
  assert.equal(options.secondsPerPhoto, 5); assert.equal(options.motion, 'pan'); assert.equal(options.format, 'portrait');
  assert.equal(ui.select('Formato').props.disabled, true, 'A completed preview cannot silently change its export settings');
  assert.equal(ui.calls.savedVideos.length, 0);
  ui.button('Baixar vídeo').props.onClick(); assert(ui.calls.downloads.at(-1).name.endsWith('.mp4'));
  ui.button('Aprovar e usar no site de demonstração').props.onClick(); await ui.settle(); assert.equal(ui.calls.savedVideos.length, 1);
  ui.byLabel('Incluir foto 1 no vídeo').props.onChange({ target: { checked: false } }); ui.render();
  ui.byLabel('Incluir foto 3 no vídeo').props.onChange({ target: { checked: false } }); ui.render();
  assert.equal(ui.button('Criar apresentação').props.disabled, true, 'An empty selection cannot be generated');
  ui.dispose(); assert.equal(ui.calls.revoked.length, ui.calls.urls.length, 'Every generated video URL is released');

  const unavailable = fixture({ storageFail: true }); await unavailable.settle();
  unavailable.button('Aprimorar foto').props.onClick(); await unavailable.settle();
  assert.equal(unavailable.button('Aprovar e usar no site de demonstração').props.disabled, true);
  assert.equal(unavailable.button('Baixar foto').props.disabled, false, 'Downloads still work if browser storage is unavailable'); unavailable.dispose();

  const cancelled = fixture({ pendingVideo: true }); await cancelled.settle(); cancelled.button('Criar vídeo').props.onClick(); cancelled.render(); cancelled.button('Criar apresentação').props.onClick(); await cancelled.settle();
  cancelled.button('Cancelar preparação').props.onClick(); await cancelled.settle();
  assert.equal(cancelled.calls.videos[0].signal.aborted, true); assert.equal(cancelled.calls.savedVideos.length, 0); assert(cancelled.text().includes('Preparação cancelada')); cancelled.dispose();

  for (const options of [{ access: 'login_required' }, { access: 'forbidden' }, { access: 'not_enabled' }, { available: false }]) {
    const blocked = fixture(options); await blocked.settle(); assert.equal(blocked.button('Aprimorar foto').props.disabled, true); blocked.button('Aprimorar foto').props.onClick(); await blocked.settle();
    assert.equal(blocked.calls.aiRequests.length, 0); assert.equal(blocked.calls.enhanced.length, 0, 'No silent local fallback when real AI is not permitted'); blocked.dispose();
  }
  const retry = fixture({ aiNetworkFailure: true }); await retry.settle(); retry.button('Aprimorar foto').props.onClick(); await retry.settle();
  assert.equal(retry.button('Aprimorar foto').props.disabled, true); retry.button('Verificar a mesma solicitação').props.onClick(); await retry.settle();
  assert.equal(retry.calls.aiRequests.length, 2); assert.deepEqual(retry.calls.aiRequests[0], retry.calls.aiRequests[1], 'Ambiguous failures reuse the exact idempotency key and input');
  assert.equal(retry.calls.enhanced.length, 1, 'Retry does not regenerate or change the source'); retry.dispose();

  const failed = fixture({ aiProviderFailure: true }); await failed.settle(); failed.button('Aprimorar foto').props.onClick(); await failed.settle();
  assert.equal(failed.calls.aiResults.length, 0); assert.equal(failed.calls.savedPhotos.length, 0); assert(failed.text().includes('Fornecedor indisponível')); assert(!failed.text().includes('Aprovar e usar')); failed.dispose();

  const recovery = fixture({ jobs: [makeJob({ id: 'same-property', photoIndex: 2 }), makeJob({ id: 'another-property', propertyId: 'demo-other' })] }); await recovery.settle();
  assert.equal(recovery.calls.aiResults.length, 0, 'Existing jobs are never loaded or approved automatically'); recovery.button('Abrir resultado').props.onClick(); await recovery.settle();
  assert.equal(recovery.calls.aiRead[0], 'same-property'); assert(recovery.text().includes('Resultado recuperado')); recovery.button('Aprovar e usar no site de demonstração').props.onClick(); await recovery.settle();
  assert.equal(recovery.calls.savedPhotos[0].index, 2, 'Recovered result is restored into its original slot'); recovery.dispose();

  const camera = fixture(); await camera.settle(); camera.button('Criar vídeo').props.onClick(); camera.render(); camera.radio('Câmera com IA').props.onChange(); camera.render();
  camera.byLabel('Gerar vídeo da foto 2').props.onClick(); camera.render(); camera.select('Formato').props.onChange({ target: { value: 'portrait' } }); camera.render();
  camera.button('Gerar vídeo com IA').props.onClick(); await camera.settle();
  assert.equal(camera.calls.aiRequests[0].kind, 'video'); assert.equal(camera.calls.aiRequests[0].photoIndex, 1); assert.equal(camera.calls.aiRequests[0].format, 'portrait'); assert.equal(camera.calls.videos.length, 0, 'AI camera never falls back to a local slideshow');
  assert.equal(camera.calls.savedVideos.length, 0); camera.button('Baixar vídeo').props.onClick(); assert(camera.calls.downloads[0].name.endsWith('.mp4'));
  camera.button('Aprovar e usar no site de demonstração').props.onClick(); await camera.settle(); camera.button('Baixar vídeo aprovado').props.onClick(); assert.equal(camera.calls.savedVideos.length, 1);
  camera.button('Retirar vídeo do site').props.onClick(); await camera.settle(); assert.equal(camera.store[property.id].video, null, 'Approved AI video is downloadable/removable without changing video type'); camera.dispose();

  const vertical = fixture({ photoOrientation: 'portrait' }); await vertical.settle(); vertical.button('Aprimorar foto').props.onClick(); await vertical.settle();
  assert.equal(vertical.calls.aiRequests[0].format, 'portrait', 'Photo enhancement follows the actual input orientation instead of the default video selector'); vertical.dispose();
  const horizontal = fixture(); await horizontal.settle(); horizontal.button('Criar vídeo').props.onClick(); horizontal.render(); horizontal.select('Formato').props.onChange({ target: { value: 'portrait' } }); horizontal.render(); horizontal.button('Melhorar foto').props.onClick(); horizontal.render(); horizontal.button('Aprimorar foto').props.onClick(); await horizontal.settle();
  assert.equal(horizontal.calls.aiRequests[0].format, 'landscape', 'The last video format cannot change a horizontal photo'); horizontal.dispose();

  const pending = fixture({ pendingAiResult: true }); await pending.settle(); const generate = pending.button('Aprimorar foto').props.onClick; generate(); generate(); await pending.settle();
  assert.equal(pending.calls.aiRequests.length, 1, 'A double click cannot start duplicate jobs'); pending.button('Parar acompanhamento').props.onClick(); await pending.settle();
  assert(pending.text().includes('A geração pode continuar e consumir a cota')); assert(!pending.text().includes('Preparação cancelada')); assert.equal(pending.calls.savedPhotos.length, 0); pending.dispose();

  const stale = fixture({ pendingAiResult: true }); await stale.settle(); stale.button('Aprimorar foto').props.onClick(); await stale.settle();
  assert.equal(stale.byLabel('Editar foto 2').props.disabled, true); stale.byLabel('Editar foto 2').props.onClick(); stale.render(); stale.releaseAi(); await stale.settle();
  assert(!stale.text().includes('Aprovar e usar'), 'An asynchronous result cannot attach to a changed photo slot'); assert.equal(stale.calls.savedPhotos.length, 0); stale.dispose();

  const mismatch = fixture({ jobPatch: { propertyId: 'demo-other-company' } }); await mismatch.settle(); mismatch.button('Aprimorar foto').props.onClick(); await mismatch.settle();
  assert.equal(mismatch.calls.aiResults.length, 0, 'A mismatched job never downloads or exposes another property result'); assert(mismatch.text().includes('não corresponde')); mismatch.dispose();
  console.log('PASS media studio UI: authenticated AI photo/video contracts; no unpaid simulation fallback; exact retry; account gating; explicit result recovery, demo approval and property-slot isolation; unchanged local slideshow, cancellation and URL cleanup. Mocked providers only.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
