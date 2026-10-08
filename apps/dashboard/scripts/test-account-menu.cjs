const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Isolated behavior and server-route contracts. No account, network, browser
// session or production data is used by this test.
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props || {} });
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } });
  assert.equal((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, `${file} must parse`);
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports, console, URL, URLSearchParams, AbortController,
    require(id) {
      if (id in dependencies) return dependencies[id];
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
      if (id.endsWith('.css')) return css;
      throw Error(`Unexpected dependency: ${id}`);
    },
    ...globals,
  }, { filename: file });
  return module.exports;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const trigger = tree => find(tree, node => node.type === 'button' && String(node.props['aria-label']).startsWith('Abrir opções da conta'));
const signOut = tree => find(tree, node => node.type === 'button' && /Sair da conta|Saindo|Desconectando/.test(text(node)));
const region = tree => find(tree, node => node.props['aria-label'] === 'Opções da conta');
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function harness(props = {}, response = async () => ({ ok: true })) {
  const slots = [], pendingEffects = [], listeners = new Map(), calls = [], navigations = [], timers = new Map();
  let cursor = 0, timerId = 0, tree, opens = 0, focusCount = 0;
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { const index = cursor++; return `account-menu-${index}`; },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || !dependencies || dependencies.some((value, key) => value !== previous.dependencies?.[key])) {
        pendingEffects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
      }
    },
  };
  const document = {
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    activeElement: null,
  };
  const setTimer = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; };
  const clearTimer = id => timers.delete(id);
  const window = { location: { replace: value => navigations.push(value) }, setTimeout: setTimer, clearTimeout: clearTimer };
  const AccountMenu = load('app/evolution/account-menu.tsx', { react: React }, {
    document, window, setTimeout: setTimer, clearTimeout: clearTimer,
    fetch: async (url, options) => { calls.push({ url, options }); return response(url, options); },
  }).default;
  const input = { name: 'Pessoa de teste', role: 'broker', onOpen: () => { opens++; }, ...props };
  function render() {
    cursor = 0;
    tree = AccountMenu(input);
    for (const node of nodes(tree)) {
      if (typeof node.type !== 'string' || !node.props.ref || typeof node.props.ref !== 'object') continue;
      node.props.ref.current ||= { __inside: true, contains: target => Boolean(target?.__inside), focus() { focusCount++; document.activeElement = this; } };
    }
    while (pendingEffects.length) pendingEffects.shift()();
    return tree;
  }
  render();
  return {
    render, calls, navigations, timers,
    get tree() { return tree; }, get opens() { return opens; }, get focusCount() { return focusCount; },
    dispatch(name, event = {}) { for (const listener of [...(listeners.get(name) || [])]) listener(event); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    listenerCount() { return [...listeners.values()].reduce((sum, list) => sum + list.size, 0); },
  };
}

async function componentContracts() {
  const menu = harness();
  assert.equal(trigger(menu.tree).props.type, 'button', 'avatar must not submit a form');
  assert.equal(trigger(menu.tree).props['aria-expanded'], false);
  assert.equal(region(menu.tree), undefined);
  assert.equal(menu.calls.length, 0);
  trigger(menu.tree).props.onClick(); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], true);
  assert.equal(region(menu.tree).props.id, trigger(menu.tree).props['aria-controls']);
  assert.match(text(region(menu.tree)), /Pessoa de teste/);
  assert.equal(menu.opens, 1);
  assert.equal(menu.calls.length, 0, 'opening account options must never end the session');
  assert.equal(menu.focusCount, 1, 'opening the menu focuses its available action');
  menu.dispatch('pointerdown', { target: { __inside: true } }); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], true, 'interacting inside the menu keeps it open');
  const beforeEscapeFocus = menu.focusCount;
  menu.dispatch('keydown', { key: 'Escape', preventDefault() {} }); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], false, 'Escape closes the menu');
  assert.equal(menu.focusCount, beforeEscapeFocus + 1, 'Escape returns focus to the avatar');
  trigger(menu.tree).props.onClick(); menu.render();
  menu.dispatch('pointerdown', { target: {} }); menu.dispatch('mousedown', { target: {} }); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], false, 'outside pointer closes the menu');
  trigger(menu.tree).props.onClick(); menu.render();
  menu.tree.props.onBlur({ relatedTarget: {}, currentTarget: { contains: () => false } }); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], false, 'keyboard focus leaving the account area closes the menu');
  menu.unmount();
  assert.equal(menu.listenerCount(), 0, 'global listeners must be cleaned up');

  for (const [role, access] of [['owner', 'administrador'], ['broker', 'corretor']]) {
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const live = harness({ role }, () => pending);
    trigger(live.tree).props.onClick(); live.render();
    const action = signOut(live.tree);
    assert(action, 'logout is an explicit menu action');
    action.props.onClick(); action.props.onClick(); live.render();
    assert.equal(live.calls.length, 1, 'rapid repeated clicks cannot duplicate logout');
    assert.equal(live.calls[0].url, '/api/admin/logout');
    assert.equal(live.calls[0].options.method, 'POST');
    assert.equal(live.calls[0].options.credentials, 'same-origin');
    assert(live.calls[0].options.signal instanceof AbortSignal);
    assert.equal(signOut(live.tree).props.disabled, true, 'logout stays disabled while pending');
    assert.equal(live.navigations.length, 0, 'navigation waits for server confirmation');
    assert([...live.timers.values()].some(timer => timer.ms === 15000), 'logout has a bounded timeout');
    resolve({ ok: true }); await flush(); live.render();
    assert.deepEqual(live.navigations, [`/painel?acesso=${access}`]);
    assert.equal(live.timers.size, 0, 'completed requests clean up timers');
    live.unmount();
  }

  for (const failure of [async () => ({ ok: false, status: 500 }), async () => { throw new TypeError('offline'); }]) {
    const failed = harness({}, failure);
    trigger(failed.tree).props.onClick(); failed.render();
    signOut(failed.tree).props.onClick(); await flush(); failed.render();
    assert.equal(failed.navigations.length, 0, 'a failed logout must not pretend the session ended');
    assert(find(failed.tree, node => node.props.role === 'alert'), 'failures are announced accessibly');
    assert.equal(signOut(failed.tree).props.disabled, false, 'failed requests can be retried explicitly');
    assert.equal(failed.timers.size, 0);
    signOut(failed.tree).props.onClick(); await flush();
    assert.equal(failed.calls.length, 2, 'only an explicit retry issues a second request');
    failed.unmount();
  }

  const timedOut = harness({}, (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  trigger(timedOut.tree).props.onClick(); timedOut.render();
  signOut(timedOut.tree).props.onClick(); timedOut.render();
  [...timedOut.timers.values()].find(timer => timer.ms === 15000).callback();
  await flush(); timedOut.render();
  assert.equal(timedOut.calls[0].options.signal.aborted, true, 'the timeout really aborts the request');
  assert.equal(timedOut.navigations.length, 0);
  assert(find(timedOut.tree, node => node.props.role === 'alert'));
  assert.equal(signOut(timedOut.tree).props.disabled, false);
  assert.equal(timedOut.timers.size, 0);
  timedOut.unmount();

  const preview = harness({ preview: true });
  trigger(preview.tree).props.onClick(); preview.render();
  signOut(preview.tree).props.onClick(); await flush(); preview.render();
  assert.equal(preview.calls.length, 0, 'a preview may not log out a real account');
  assert.equal(preview.navigations.length, 0);
  assert(find(preview.tree, node => node.props.role === 'status'), 'preview restriction is explained');
  preview.unmount();
}

async function logoutRouteContracts() {
  const calls = [], cookies = [];
  let allowed = true, fail = false;
  const token = 'a'.repeat(64);
  const route = load('app/api/admin/logout/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, cookies: { set: (...args) => cookies.push(args) } }) } },
    '@/lib/admin-auth': { COOKIE_NAME: 'imobflow_admin' },
    '@/lib/request-security': { hasSameOrigin: () => allowed },
    '@/lib/accounts': { ACCOUNT_COOKIE: 'imobflow_session', cookieOptions: { httpOnly: true, secure: true, sameSite: 'strict', path: '/' }, tokenHash: value => crypto.createHash('sha256').update(value).digest('hex') },
    '@/lib/supabase': { supabaseRequest: async (...args) => { calls.push(args); if (fail) throw Error('unavailable'); } },
  });
  const request = value => ({ cookies: { get: name => name === 'imobflow_session' && value ? { value } : undefined } });
  allowed = false;
  assert.equal((await route.POST(request(token))).status, 403);
  assert.equal(calls.length, 0); assert.equal(cookies.length, 0);
  allowed = true;
  assert.equal((await route.POST(request(token))).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], `account_sessions?token_hash=eq.${crypto.createHash('sha256').update(token).digest('hex')}`);
  assert.equal(calls[0][1].method, 'DELETE');
  assert.deepEqual(cookies.map(([name]) => name).sort(), ['imobflow_admin', 'imobflow_session']);
  for (const [, value, options] of cookies) { assert.equal(value, ''); assert.equal(options.maxAge, 0); assert.equal(options.path, '/'); assert.equal(options.httpOnly, true); }
  for (const invalid of [undefined, '', 'foreign-token', 'b'.repeat(65)]) {
    const before = calls.length;
    assert.equal((await route.POST(request(invalid))).status, 200);
    assert.equal(calls.length, before, 'absent/invalid tokens must not broaden session deletion');
  }
  fail = true;
  const before = cookies.length;
  await assert.rejects(() => route.POST(request(token)), /unavailable/);
  assert.equal(cookies.length, before, 'server revocation failure must not return success');
}

async function loginContracts() {
  const Login = Symbol('LoginClient');
  const page = load('app/painel/page.tsx', {
    '../dashboard-client': {}, './login-client': { __esModule: true, default: Login },
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    '@/lib/accounts': { ACCOUNT_COOKIE: 'imobflow_session', readAccount: async () => null },
    '@/lib/evolution/feature': { evolutionEnabled: () => false },
    '@/lib/evolution/server': { evolutionIntegrated: () => false },
    '../evolution/live-entry': {},
  }).default;
  for (const [access, expected] of [['administrador', 'login-admin'], ['corretor', 'login'], ['owner', 'enroll'], ['https://outside.invalid', 'enroll'], [['corretor', 'administrador'], 'enroll'], [undefined, 'enroll']]) {
    const result = await page({ searchParams: Promise.resolve(access === undefined ? {} : { acesso: access }) });
    assert.equal(result.type, Login);
    assert.equal(result.props.initialMode, expected, 'only supported local access options select a login mode');
  }
  for (const mode of ['login', 'login-admin']) {
    const LoginClient = load('app/painel/login-client.tsx', {
      react: { useState: initial => [initial, () => {}] }, '../password-input': {}, 'next/link': {},
    }).default;
    const tree = LoginClient({ initialMode: mode });
    assert.match(text(find(tree, node => node.type === 'h1')), mode === 'login' ? /Acesso do corretor/ : /Acesso do administrador/);
    assert.equal(find(tree, node => node.type === 'input' && node.props.name === 'accessKey'), undefined, 'switching accounts must not land in company enrollment');
  }
}

(async () => {
  await componentContracts();
  await logoutRouteContracts();
  await loginContracts();
  console.log('PASS account menu: explicit logout, disclosure/focus cleanup, duplicate-click protection, bounded request, success/error handling, demo isolation, role-aware login and current-session-only revocation. No real sessions or network used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
