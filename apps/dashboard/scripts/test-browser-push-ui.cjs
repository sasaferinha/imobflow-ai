// Browser and worker doubles only: no permission dialog, registration or delivery on a real device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props || {} });
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : [];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join(' ') : '';
const key = new Uint8Array(65); key[0] = 4; key[1] = 3;
const publicKey = Buffer.from(key).toString('base64url');
const baseStatus = () => ({ configured: true, publicKey, schedulerConfigured: true, subscribed: false, bindingIds: [] });
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 2)); };
function harness(options = {}) {
  const slots = [], effects = [], calls = [], timers = new Map(); let index = 0, tree, local = null, registered = Boolean(options.existing), subscribeCount = 0, permissionCalls = 0, unregisterCount = 0;
  const status = { ...baseStatus(), ...options.status };
  const doc = new EventTarget(), win = new EventTarget(); doc.visibilityState = 'visible';
  const Notification = { permission: options.permission || 'default', requestPermission: async () => { permissionCalls++; return Notification.permission = options.grant || 'granted'; } };
  Object.assign(win, { Notification, PushManager: function () {}, location: { origin: 'https://app.example.test' }, isSecureContext: true,
    atob: value => Buffer.from(value, 'base64').toString('binary'), matchMedia: () => ({ matches: Boolean(options.installed) }),
    setTimeout: (fn, ms) => { const id = Symbol(); timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  const makeSubscription = (serverKey = key) => ({ endpoint: 'https://push.example.test/opaque-device-id', options: { applicationServerKey: serverKey.buffer },
    toJSON: () => ({ endpoint: 'https://push.example.test/opaque-device-id', keys: { p256dh: 'fake', auth: 'fake' } }),
    unsubscribe: async () => { unregisterCount++; local = null; return true; } });
  if (options.existing) local = makeSubscription(options.oldKey || key);
  const registration = { active: { scriptURL: 'https://app.example.test/push-sw.js' }, pushManager: {
    getSubscription: async () => local,
    subscribe: async config => { subscribeCount++; assert.equal(config.userVisibleOnly, true); local = makeSubscription(config.applicationServerKey); return local; },
  } };
  const navigator = { userAgent: options.ios ? 'iPhone' : 'Test browser', platform: 'Test', maxTouchPoints: 0, serviceWorker: {
    getRegistration: async () => registered ? registration : undefined,
    register: async (url, opts) => { calls.push({ register: url, opts }); registered = true; return registration; },
  } };
  if (options.unsupported) delete win.PushManager;
  const react = {
    useState(initial) { const n = index++; if (!(n in slots)) slots[n] = { value: initial }; return [slots[n].value, value => { slots[n].value = typeof value === 'function' ? value(slots[n].value) : value; }]; },
    useRef(initial) { const n = index++; if (!(n in slots)) slots[n] = { current: initial }; return slots[n]; },
    useEffect(fn, dependencies) { const n = index++, previous = slots[n]; if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) effects.push(() => { previous?.cleanup?.(); slots[n] = { dependencies, cleanup: fn() }; }); },
  };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'app/browser-push-settings.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module, exports: module.exports, URL, Uint8Array, TextEncoder, crypto: webcrypto, AbortController, console,
    window: win, document: doc, navigator, Notification, require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) });
      if (name === '@/lib/dashboard-transport') return { isProductDemo: () => Boolean(options.demo), dashboardFetch: async (url, request = {}) => {
        calls.push({ url, request });
        if (request.method === 'POST') return { ok: !options.postFailure, json: async () => ({ ok: !options.postFailure, bindingId: 'binding-current-device' }) };
        if (request.method === 'DELETE') return { ok: !options.deleteFailure, json: async () => ({ ok: !options.deleteFailure }) };
        return { ok: true, json: async () => ({ ...status }) };
      } };
      throw new Error(`Unexpected import ${name}`);
    } });
  const props = { ready: options.ready !== false, demonstration: Boolean(options.demonstration) };
  const render = () => { index = 0; tree = module.exports.default(props); while (effects.length) effects.shift()(); return tree; };
  render();
  return { options, calls, status, props, Notification, exports: module.exports, render, get tree() { return tree; },
    get permissionCalls() { return permissionCalls; }, get subscribeCount() { return subscribeCount; }, get unregisterCount() { return unregisterCount; },
    async settle() { await flush(); return render(); },
    async click(label) { const btn = nodes(tree).find(node => node.type === 'button' && text(node).trim() === label); assert(btn, label); assert(!btn.props.disabled, `${label} disabled`); btn.props.onClick(); await flush(); return render(); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
  };
}

async function testWorker() {
  const handlers = {}, notices = [], fetches = [], opens = [], navigations = [], focuses = [];
  let now = Date.parse('2026-10-19T12:00:00Z'), advanceDuringFetch = 0;
  const openStatus = () => ({ configured: true, schedulerConfigured: true, bindingIds: ['current'], businessHoursOpen: true, activeUntil: now + 30000 });
  let status = openStatus(), responseOk = true, throwFetch = false, windows = [];
  class Clock extends Date { static now() { return now; } }
  const self = { location: { origin: 'https://app.example.test' }, addEventListener: (name, callback) => { handlers[name] = callback; },
    skipWaiting: async () => {}, registration: { showNotification: async (title, options) => notices.push({ title, options }) },
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async url => opens.push(url) } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/push-sw.js'), 'utf8'), { self, URL, AbortController, setTimeout, clearTimeout, Date: Clock,
    fetch: async (url, options) => { fetches.push({ url, options }); now += advanceDuringFetch; if (throwFetch) throw new Error('offline'); return { ok: responseOk, json: async () => status }; } });
  assert.deepEqual(Object.keys(handlers).sort(), ['activate', 'install', 'notificationclick', 'push']);
  const dispatch = async (name, extra) => { let pending; handlers[name]({ ...extra, waitUntil: promise => { pending = promise; } }); await pending; };
  const push = async payload => dispatch('push', { data: { json: () => ({ expiresAt: now + 30000, ...payload }) } });
  await push({ bindingId: 'current', title: 'PRIVATE CLIENT', body: 'PRIVATE CONTENT', url: 'https://evil.example/', tag: 'evil' });
  assert.equal(notices.length, 1); assert.doesNotMatch(JSON.stringify(notices[0]), /PRIVATE|evil|SOZINHO/);
  assert.equal(notices[0].options.tag, 'imobflow-attendance');
  assert.equal(notices[0].options.renotify, true, 'Server reminders replace the old card but re-alert the user');
  assert.equal(fetches[0].url, 'https://app.example.test/api/notifications/push');
  assert.equal(fetches[0].options.credentials, 'same-origin'); assert.equal(fetches[0].options.cache, 'no-store');
  assert.equal(fetches[0].options.redirect, 'error');
  for (const changes of [{ configured: false }, { schedulerConfigured: false }, { bindingIds: ['other-account'] },
    { businessHoursOpen: false }, { businessHoursOpen: undefined }, { activeUntil: null }, { activeUntil: undefined }, { activeUntil: now }, { activeUntil: Infinity }]) {
    status = { ...openStatus(), ...changes }; await push({ bindingId: 'current' }); assert.equal(notices.length, 1);
  }
  status = openStatus();
  const beforeExpiredFetch = fetches.length;
  for (const expiresAt of [undefined, null, 'bad', now, now - 86400000, Infinity]) await push({ bindingId: 'current', expiresAt });
  assert.equal(fetches.length, beforeExpiredFetch, 'Expired or old-protocol payloads are rejected before lookup, even when office is open again');
  advanceDuringFetch = 30000;
  await push({ bindingId: 'current' });
  assert.equal(notices.length, 1, 'Closing or payload expiry during lookup suppresses notification');
  advanceDuringFetch = 0; status = openStatus();
  advanceDuringFetch = 200;
  await push({ bindingId: 'current', expiresAt: now + 100 });
  assert.equal(notices.length, 1, 'Payload expiry is checked again after an otherwise valid lookup');
  advanceDuringFetch = 0; status = openStatus();
  responseOk = false; await push({ bindingId: 'current' }); responseOk = true;
  throwFetch = true; await push({ bindingId: 'current' }); throwFetch = false;
  assert.equal(notices.length, 1, 'Logout/offline/network failure cannot display delayed old-account notification');
  await dispatch('push', { data: { json() { throw new Error('invalid JSON'); } } });
  await push({ bindingId: '' }); assert.equal(notices.length, 1);
  const notification = { data: { bindingId: 'current', url: 'https://evil.example/' }, close() {} };
  status.businessHoursOpen = false; status.activeUntil = null;
  await dispatch('notificationclick', { notification }); assert.deepEqual(opens, ['https://app.example.test/painel#conversations'], 'Existing notice may be opened after hours; this does not send another notification');
  windows = [{ url: 'https://evil.example/painel', focus: async () => focuses.push('foreign') },
    { url: 'https://app.example.test/painel#properties', navigate: async url => { navigations.push(url); }, focus: async () => focuses.push('current') }];
  await dispatch('notificationclick', { notification }); assert.deepEqual(navigations, ['https://app.example.test/painel#conversations']); assert.deepEqual(focuses, ['current']); assert.equal(opens.length, 1);
  status.bindingIds = ['other-account']; await dispatch('notificationclick', { notification }); assert.equal(navigations.length, 1);
  now += 300000; status = openStatus();
  await push({ bindingId: 'current' });
  assert.equal(notices.length, 2, 'A new server reminder five minutes later is not suppressed locally');
  assert.equal(notices[1].options.renotify, true);
  assert.equal(notices[1].options.tag, notices[0].options.tag, 'One privacy-safe notification card, not a growing stack');
  console.log('PASS push-only worker: recurring reminders, business-hours and payload expiry before/after lookup, session/global config guards, generic content, no caching and same-origin navigation.');
}

(async () => {
  const ui = harness(); await ui.settle();
  assert.equal(ui.permissionCalls, 0); assert.equal(ui.subscribeCount, 0); assert.ok(ui.calls.every(call => !call.register && !call.request?.method));
  await ui.click('Ativar neste aparelho');
  assert.equal(ui.permissionCalls, 1); assert.equal(ui.subscribeCount, 1);
  assert.match(text(ui.tree), /Ativos neste aparelho/); assert.match(text(ui.tree), /Não usamos o telefone/);
  assert.match(text(ui.tree), /Somente no expediente configurado/);
  assert.match(text(ui.tree), /desde a primeira mensagem do cliente, mesmo que a IA esteja atendendo/);
  assert.match(text(ui.tree), /se repetem a cada 5 minutos até um corretor aceitar/);
  assert.equal(ui.calls.find(call => call.register).register, '/push-sw.js');
  assert.equal(ui.calls.find(call => call.register).opts.scope, '/painel');
  assert.deepEqual(Object.keys(JSON.parse(ui.calls.find(call => call.request?.method === 'POST').request.body)), ['subscription']);
  await ui.click('Desativar neste aparelho'); assert.equal(ui.unregisterCount, 1); assert.doesNotMatch(text(ui.tree), /Ativos neste aparelho/);
  assert.ok(ui.calls.some(call => call.request?.method === 'DELETE')); ui.unmount();

  for (const settings of [{ configured: false }, { schedulerConfigured: false }, { publicKey: null }]) {
    const pending = harness({ status: settings }); await pending.settle();
    assert.ok(nodes(pending.tree).find(node => node.type === 'button' && text(node) === 'Ativar neste aparelho').props.disabled);
    assert.match(text(pending.tree), /Servidor ainda pendente/); assert.equal(pending.permissionCalls, 0); pending.unmount();
  }
  const afterHours = harness({ status: { businessHoursOpen: false, activeUntil: null } }); await afterHours.settle();
  assert.match(text(afterHours.tree), /Fora do expediente configurado/); assert.doesNotMatch(text(afterHours.tree), /Servidor ainda pendente/);
  assert.equal(nodes(afterHours.tree).find(node => node.type === 'button' && text(node) === 'Ativar neste aparelho').props.disabled, false);
  await afterHours.click('Ativar neste aparelho'); assert.match(text(afterHours.tree), /Ativos neste aparelho/);
  assert.match(text(afterHours.tree), /avisos estão pausados/); afterHours.unmount();
  for (const options of [{ demo: true }, { demonstration: true }, { ready: false }]) {
    const blocked = harness(options); await blocked.settle(); assert.equal(blocked.calls.length, 0); assert.equal(blocked.permissionCalls, 0); blocked.unmount();
  }
  const denied = harness({ permission: 'denied' }); await denied.settle(); assert.match(text(denied.tree), /Notificações bloqueadas/); assert.equal(denied.permissionCalls, 0); denied.unmount();
  const ios = harness({ ios: true }); await ios.settle(); assert.match(text(ios.tree), /Adicionar à Tela de Início/); assert.equal(ios.calls.length, 0); ios.unmount();
  const unsupported = harness({ unsupported: true }); await unsupported.settle(); assert.match(text(unsupported.tree), /não oferece os recursos/); unsupported.unmount();
  const otherDevice = harness({ status: { subscribed: true, bindingIds: ['other-device'] } }); await otherDevice.settle(); assert.doesNotMatch(text(otherDevice.tree), /Ativos neste aparelho/); otherDevice.unmount();
  const saved = harness({ existing: true, permission: 'granted', status: { subscribed: true, bindingIds: ['this-device'] } }); await saved.settle();
  assert.match(text(saved.tree), /Ativos neste aparelho/); assert.match(saved.calls[0].url, /endpointHash=[a-f0-9]{64}$/); assert.doesNotMatch(saved.calls[0].url, /opaque-device/); saved.unmount();
  const wrongKey = new Uint8Array(key); wrongKey[1] = 99;
  const rotation = harness({ existing: true, permission: 'granted', oldKey: wrongKey, status: { subscribed: true, bindingIds: ['this-device'] } }); await rotation.settle();
  assert.doesNotMatch(text(rotation.tree), /Ativos neste aparelho/); await rotation.click('Reativar neste aparelho');
  assert.equal(rotation.unregisterCount, 1); assert.equal(rotation.subscribeCount, 1); assert.match(text(rotation.tree), /Ativos neste aparelho/); rotation.unmount();
  const failed = harness({ postFailure: true }); await failed.settle(); await failed.click('Ativar neste aparelho');
  assert.equal(failed.unregisterCount, 1); assert.doesNotMatch(text(failed.tree), /Ativos neste aparelho/); assert.match(text(failed.tree), /Não foi possível confirmar a ativação/); failed.unmount();
  const remove = harness({ existing: true, permission: 'granted', deleteFailure: true, status: { subscribed: true, bindingIds: ['this-device'] } }); await remove.settle(); await remove.click('Desativar neste aparelho');
  assert.match(text(remove.tree), /Concluir remoção/); assert.doesNotMatch(text(remove.tree), /Ativos neste aparelho/);
  remove.options.deleteFailure = false; await remove.click('Concluir remoção'); assert.match(text(remove.tree), /Avisos desativados/); remove.unmount();
  console.log('PASS push UI: explicit opt-in only, local-device hash, server/cron gates, demo isolation, iOS/block/unsupported instructions, VAPID rotation, failed activation rollback and revocation retry.');
  await testWorker();
})().catch(error => { console.error(error); process.exitCode = 1; });
