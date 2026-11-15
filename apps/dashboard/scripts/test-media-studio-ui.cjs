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
const imported = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const property = { id: 'demo-casa-jardim', code: 'HZ001', title: 'Imóvel fictício de teste', images: ['https://images.unsplash.com/photo-one', 'https://images.unsplash.com/photo-two', 'https://images.unsplash.com/photo-three'] };
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(node) { if (node === null || node === undefined || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); if (Array.isArray(node)) return node.map(text).join(''); return text(node.props?.children); }

function fixture({ storageFail = false, pendingVideo = false } = {}) {
  const hooks = [], listeners = new Map(), calls = { enhanced: [], imported: [], videos: [], savedPhotos: [], savedVideos: [], urls: [], revoked: [], locked: [], downloads: [] };
  const store = { [property.id]: { photos: {}, video: null } };
  let cursor = 0, effects = [], component, props, tree, allowConfirm = true;
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[index].value, next => { hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next; }]; },
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { value: { current: initial } }; return hooks[index].value; },
    useEffect(fn, deps) { const index = cursor++; const previous = hooks[index]; if (!previous || !deps || deps.some((item, i) => !Object.is(item, previous.deps?.[i]))) { hooks[index] = { ...previous, deps }; effects.push(() => { previous?.cleanup?.(); hooks[index].cleanup = fn(); }); } },
  };
  class BrowserURL extends URL { static createObjectURL(blob) { const url = `blob:https://imobflow.test/${calls.urls.length}`; calls.urls.push({ blob, url }); return url; } static revokeObjectURL(url) { calls.revoked.push(url); } }
  const renderer = {
    canRecordPropertyVideo: () => true,
    preparePropertyPhotoFile: async (file, signal) => { calls.imported.push({ file, signal }); if (file.name === 'bad.svg') throw new Error('Formato de foto inválido.'); return imported; },
    autoEnhancePropertyPhoto: async (source, signal) => { calls.enhanced.push({ source, signal }); return photo; },
    createPropertySlideshow: async options => { calls.videos.push(options); if (pendingVideo) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); options.onProgress(100); return new Blob(['video-test'], { type: 'video/mp4' }); },
  };
  const storage = {
    loadDemoPropertyMedia: async () => { if (storageFail) throw new Error('quota'); return structuredClone(store); },
    saveDemoPropertyPhoto: async (id, index, value) => { assert.equal(id, property.id); calls.savedPhotos.push({ id, index, value }); if (value === null) delete store[id].photos[index]; else store[id].photos[index] = value; },
    saveDemoPropertyVideo: async (id, value) => { assert.equal(id, property.id); calls.savedVideos.push({ id, value }); store[id].video = value; },
    clearDemoPropertyMedia: async id => { assert.equal(id, property.id); store[id] = { photos: {}, video: null }; },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, Blob, URL: BrowserURL, AbortController,
    requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {},
    fetch: () => assert.fail('The studio never sends a photo to a server or a paid provider'),
    window: { confirm: () => allowConfirm, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    document: { createElement(tag) { assert.equal(tag, 'a'); const anchor = { click() { calls.downloads.push({ href: anchor.href, name: anchor.download }); }, remove() {} }; return anchor; }, body: { appendChild() {} } },
    require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.css')) return { __esModule: true, default: {} };
      if (id === '@/lib/website/demo') return { demoContent: { brandName: 'Horizonte Imobiliária' }, demoProperties: [property] };
      if (id === '@/lib/website/demo-property-media') return storage;
      if (id === '@/lib/property-media-renderer') return renderer;
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
  return { calls, store, render, settle, button, byLabel, select, file, text: () => text(tree), confirm: value => { allowConfirm = value; }, dispose };
}

async function run() {
  const ui = fixture(); await ui.settle();
  assert(!/Escolha o ajuste|Ajustar manualmente|Contraste|Iluminação|Clarear|Natural|Equilibrad/.test(ui.text()), 'Photo enhancement is a single action without manual or preset choices');
  ui.button('Aprimorar foto').props.onClick(); await ui.settle();
  assert.equal(ui.calls.enhanced[0].source, property.images[0]);
  assert(ui.calls.enhanced[0].signal instanceof AbortSignal, 'The automatic enhancement remains cancellable');
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
  console.log('PASS media studio UI: single-action automatic enhancement and explicit approvals, temporary local photo isolation, slot preservation, ordered selected photos with export settings, cancellation, storage fallback and video URL cleanup. No real property, upload or provider calls.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
