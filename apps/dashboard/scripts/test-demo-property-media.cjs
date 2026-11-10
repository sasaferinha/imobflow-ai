const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l6kAAAAASUVORK5CYII=';
const video = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'video/webm;codecs=vp9' });

// A serial readwrite transaction fixture, including abort/rollback. This tests
// storage boundaries, not a browser's codec support or a provider generation.
function storageFixture() {
  const rows = new Map(), queue = [], names = [];
  let failWrite = false, created = false;
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore(name, options) { assert.equal(name, 'properties'); assert.equal(options.keyPath, 'propertyId'); created = true; },
    close() {},
    transaction(name, mode) {
      assert.equal(name, 'properties');
      assert(['readonly', 'readwrite'].includes(mode));
      let active = false, finished = false, pending = 0, staged;
      const tasks = [];
      const transaction = {
        abort() { if (!finished) { finished = true; setImmediate(() => { transaction.onabort?.(); advance(); }); } },
        start() { active = true; staged = new Map([...rows].map(([key, value]) => [key, structuredClone(value)])); tasks.splice(0).forEach(task => setImmediate(task)); },
        objectStore() {
          const operation = fn => {
            pending++;
            const request = {};
            const run = () => {
              if (finished) return;
              try { request.result = fn(); request.onsuccess?.(); }
              catch { transaction.abort(); }
              pending--;
              setImmediate(() => {
                if (finished || pending) return;
                finished = true;
                if (mode === 'readwrite') { rows.clear(); staged.forEach((value, key) => rows.set(key, value)); }
                transaction.oncomplete?.(); advance();
              });
            };
            if (active) setImmediate(run); else tasks.push(run);
            return request;
          };
          const write = fn => operation(() => { assert.equal(mode, 'readwrite'); if (failWrite) { failWrite = false; throw Error('Synthetic quota error'); } return fn(); });
          return {
            get: id => operation(() => structuredClone(staged.get(id))),
            getAll: () => operation(() => structuredClone([...staged.values()])),
            put: row => write(() => staged.set(row.propertyId, structuredClone(row))),
            delete: id => write(() => staged.delete(id)),
          };
        },
      };
      function advance() { assert.equal(queue.shift(), transaction); queue[0]?.start(); }
      queue.push(transaction); if (queue.length === 1) transaction.start();
      return transaction;
    },
  };
  return { rows, names, fail() { failWrite = true; },
    indexedDB: { open(name, version) { names.push(name); assert.equal(name, 'imobflow-property-media-demo'); assert.equal(version, 1); const request = { result: database }; setImmediate(() => { if (!created) request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; } },
  };
}
function load(relative, environment = {}, modules = new Map()) {
  if (modules.has(relative)) return modules.get(relative);
  const module = { exports: {} };
  const file = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, Blob, Event, Uint8Array, atob, structuredClone, console,
    fetch: () => assert.fail('A media demonstration must not contact a tenant or paid provider'),
    require(id) {
      if (environment.dependencies && Object.hasOwn(environment.dependencies, id)) return environment.dependencies[id];
      if (id === 'react') return environment.react || React;
      if (id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.css')) return { __esModule: true, default: {} };
      const base = id.startsWith('@/') ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const found = ['.ts', '.tsx'].map(ext => base + ext).find(fs.existsSync);
      assert(found, id);
      return load(path.relative(root, found), environment, modules);
    },
    ...environment,
  }, { filename: file });
  modules.set(relative, module.exports); return module.exports;
}
const clean = value => JSON.parse(JSON.stringify(value));

async function main() {
  const fixture = storageFixture(), pings = [], events = [];
  const media = load('lib/website/demo-property-media.ts', {
    indexedDB: fixture.indexedDB,
    window: { dispatchEvent: event => events.push(event.type), localStorage: { setItem: (key, value) => pings.push({ key, value }) } },
  });
  const id = 'demo-casa-jardim';
  for (const bad of ['real-company-property', '__proto__', '', 1, null]) {
    await assert.rejects(media.saveDemoPropertyPhoto(bad, 0, image));
    await assert.rejects(media.saveDemoPropertyVideo(bad, video));
    await assert.rejects(media.clearDemoPropertyMedia(bad));
  }
  for (const index of [-1, 3, 1.5, NaN, '0', null]) await assert.rejects(media.saveDemoPropertyPhoto(id, index, image));
  for (const bad of ['blob:https://example.test/photo', 'https://example.test/photo.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', image.replace('png', 'jpeg'), 'data:image/png;base64,' + 'A'.repeat(2_666_700), image.replace('base64,', 'base64,@@'), {}, undefined]) await assert.rejects(media.saveDemoPropertyPhoto(id, 0, bad));
  for (const bad of ['blob:https://example.test/video', {}, new Blob(['invalid data!'], { type: 'video/mp4' }), new Blob([new Uint8Array(30_000_001)], { type: 'video/webm' }), new Blob([await video.arrayBuffer()], { type: 'text/html' })]) await assert.rejects(media.saveDemoPropertyVideo(id, bad));
  assert.equal(fixture.names.length, 0, 'Invalid inputs never even open browser storage');
  assert.deepEqual(clean(await media.loadDemoPropertyMedia()), {});
  await Promise.all([media.saveDemoPropertyPhoto(id, 0, image), media.saveDemoPropertyPhoto(id, 1, image), media.saveDemoPropertyVideo(id, video)]);
  let stored = await media.loadDemoPropertyMedia();
  assert.deepEqual(clean(stored[id].photos), { 0: image, 1: image }, 'Concurrent approvals retain every photo slot');
  assert(stored[id].video instanceof Blob);
  assert.deepEqual(new Uint8Array(await stored[id].video.arrayBuffer()), new Uint8Array(await video.arrayBuffer()));
  assert.equal(pings.length, 3); assert.equal(events.length, 3);
  assert(pings.every(ping => ping.key === media.DEMO_PROPERTY_MEDIA_PING && !/data:|blob:|demo-casa|base64/.test(ping.value)), 'Cross-tab ping contains no media, URL or property payload');
  assert(events.every(event => event === media.DEMO_PROPERTY_MEDIA_EVENT));
  fixture.fail(); await assert.rejects(media.saveDemoPropertyPhoto(id, 0, null));
  assert.equal((await media.loadDemoPropertyMedia())[id].photos[0], image, 'An aborted write preserves the previously approved media');
  assert.equal(pings.length, 3, 'A failed transaction never announces a successful approval');
  await media.saveDemoPropertyPhoto(id, 0, null);
  assert.equal((await media.loadDemoPropertyMedia())[id].photos[0], undefined);
  assert((await media.loadDemoPropertyMedia())[id].video instanceof Blob, 'Removing one photo never discards the independent video');
  await media.saveDemoPropertyVideo(id, null);
  assert.equal((await media.loadDemoPropertyMedia())[id].video, null);
  fixture.rows.set('real-company-property', { propertyId: 'real-company-property', photos: { 0: image }, video });
  fixture.rows.set('demo-apartamento-centro', { propertyId: 'demo-apartamento-centro', photos: { 0: image, '01': image, 2: image, bad: image, 1: 'javascript:alert(1)' }, video: new Blob(['not a video!'], { type: 'video/mp4' }) });
  stored = await media.loadDemoPropertyMedia();
  assert.equal(stored['real-company-property'], undefined);
  assert.deepEqual(clean(stored['demo-apartamento-centro'].photos), { 0: image });
  assert.equal(stored['demo-apartamento-centro'].video, null, 'Malformed video bytes cannot reach the public demo');
  await media.clearDemoPropertyMedia(id);
  assert.equal((await media.loadDemoPropertyMedia())[id], undefined);
  assert(fixture.rows.has('demo-apartamento-centro'), 'Clear only touches the chosen fictional property');

  // Drive the actual public demo component's effects: no mutations, URL leaks,
  // publication resurrection, or accidental use of the live catalogue path.
  const { demoProperties, demoContent } = load('lib/website/demo.ts');
  let currentMedia = { [id]: { photos: { 0: image }, video } }, savedSite = null, cursor = 0, effects = [], tree;
  const hooks = [], listeners = new Map(), created = [], revoked = [];
  const react = { ...React,
    useSyncExternalStore: () => savedSite,
    useState(value) { const index = cursor++; if (!hooks[index]) hooks[index] = { value }; return [hooks[index].value, next => { hooks[index].value = next; }]; },
    useMemo: fn => fn(),
    useEffect(fn) { const index = cursor++; if (!hooks[index]) { hooks[index] = {}; effects.push(() => { hooks[index].cleanup = fn(); }); } },
  };
  class LocalURL extends URL { static createObjectURL(blob) { assert(blob instanceof Blob); const url = `blob:https://example.test/media-${created.length}`; created.push(url); return url; } static revokeObjectURL(url) { revoked.push(url); } }
  const demoComponent = load('app/modelo-imobiliaria/demo-client.tsx', { react, URL: LocalURL,
    dependencies: { '@/lib/website/demo-property-media': { ...media, loadDemoPropertyMedia: async () => currentMedia } },
    window: { addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
  }).default;
  const render = () => { cursor = 0; effects = []; tree = demoComponent(); effects.forEach(fn => fn()); return tree; };
  render(); await tick(); render();
  assert.equal(tree.props.properties[0].images[0], image);
  assert.equal(tree.props.properties[0].images[1], demoProperties[0].images[1]);
  assert.equal(tree.props.demoPropertyVideos[id], created[0]);
  assert.equal(tree.props.demo, true);
  currentMedia = {}; listeners.get(media.DEMO_PROPERTY_MEDIA_EVENT)(); await tick(); render();
  assert.equal(tree.props.properties[0].images[0], demoProperties[0].images[0], 'Clearing approval restores the original source photo');
  assert.equal(tree.props.demoPropertyVideos[id], undefined);
  assert(revoked.includes(created[0]), 'Replacing the overlay revokes previous video URLs');
  currentMedia = { [id]: { photos: {}, video } }; listeners.get('storage')({ key: 'unrelated' }); await tick(); render();
  assert.equal(created.length, 1, 'Unrelated storage updates cannot reload media');
  listeners.get('storage')({ key: media.DEMO_PROPERTY_MEDIA_PING }); await tick(); render();
  assert.equal(created.length, 2, 'Cross-tab ping reloads approved media');
  savedSite = JSON.stringify({ site: { published: null }, properties: demoProperties }); render();
  assert.equal(tree.type, 'main', 'Media never republishes an unpublished demonstration');
  savedSite = JSON.stringify({ site: { published: { ...demoContent, brandName: 'Marca personalizada preservada' } }, properties: demoProperties }); render();
  assert.equal(tree.props.content.brandName, 'Marca personalizada preservada');
  hooks.forEach(hook => hook.cleanup?.());
  assert.deepEqual(revoked.sort(), created.sort(), 'Unmount releases all remaining object URLs');
  assert.equal(listeners.size, 0);
  console.log('PASS isolated property media: strict fictional IDs/slots and media bounds, transactional photo/video persistence and rollback, metadata-only cross-tab ping, corrupt storage filtering, original restoration, unpublished preservation and object URL cleanup. Synthetic files only; no real property or provider calls.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
