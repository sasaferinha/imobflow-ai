const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const dashboardRoot = path.join(__dirname, '..');
const origin = 'https://imobflow.test';
const source = name => fs.readFileSync(path.join(dashboardRoot, name), 'utf8');
const compile = value => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helperModule = { exports: {} };
vm.runInNewContext(compile(source('lib/presentation-handshake.ts')), {
  module: helperModule, exports: helperModule.exports,
}, { filename: 'presentation-handshake.js' });
const { startPresentationHandshake } = helperModule.exports;

function fakeClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const callbacks = [];
  const schedule = (callback, delay, interval) => {
    const id = ++nextId;
    timers.set(id, { callback, at: now + delay, interval });
    callbacks.push(callback);
    return id;
  };
  return {
    timers, callbacks,
    setTimeout: (callback, delay) => schedule(callback, delay, 0),
    setInterval: (callback, delay) => schedule(callback, delay, delay),
    clearTimeout: id => timers.delete(id),
    clearInterval: id => timers.delete(id),
    advance(duration) {
      const end = now + duration;
      let executions = 0;
      while (true) {
        const entry = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!entry) break;
        assert.ok(++executions < 2000, 'Fake timers must not loop indefinitely.');
        const [id, timer] = entry;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval;
        else timers.delete(id);
        timer.callback();
      }
      now = end;
    },
  };
}

function fakeWindow(clock = fakeClock()) {
  const listeners = new Set();
  return {
    location: { origin }, clock, listeners,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    addEventListener(type, callback) { assert.equal(type, 'message'); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'message'); listeners.delete(callback); },
    emit(data, sourceWindow, eventOrigin = origin) {
      for (const listener of [...listeners]) listener({ data, source: sourceWindow, origin: eventOrigin });
    },
  };
}

function fixture(options = {}) {
  const host = fakeWindow();
  const requests = [];
  const ready = [];
  let timeouts = 0;
  const frame = {
    postMessage(data, targetOrigin) {
      assert.equal(targetOrigin, origin, 'Never broadcast readiness requests with wildcard origin.');
      assert.equal(data.type, 'imobflow-demo-status-request');
      requests.push(data);
      options.onRequest?.(host, frame);
    },
  };
  const bridge = startPresentationHandshake({
    host, getFrameWindow: options.getFrameWindow || (() => frame),
    isView: value => ['overview', 'conversations', 'team'].includes(value),
    onReady: view => ready.push(view), onTimeout: () => timeouts++,
    ...options.timing,
  });
  return { host, frame, bridge, requests, ready, timeouts: () => timeouts };
}

function parse(file) {
  return ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findNodes(root, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}
const childSource = parse('app/dashboard-client.tsx');
const childEffects = findNodes(childSource, node => ts.isCallExpression(node)
  && node.expression.getText(childSource) === 'useEffect'
  && node.arguments[0]?.getText(childSource).includes('imobflow-demo-status-request'));
assert.equal(childEffects.length, 1, 'Keep a single child readiness responder.');
const childEffect = childEffects[0];
assert.equal(childEffect.arguments[1].getText(childSource), '[publicDemo, view, utilityModal]');

// Execute the actual child effect, not a second implementation of its protocol.
function mountChild(child, parent, options = {}) {
  const navigation = [];
  const modal = [];
  child.parent = parent;
  const cleanup = vm.runInNewContext(compile(`(${childEffect.arguments[0].getText(childSource)})()`), {
    window: child, publicDemo: options.publicDemo ?? true,
    view: options.view || 'overview', utilityModal: options.utilityModal || null,
    navItems: [{ id: 'overview' }, { id: 'conversations' }],
    setView: value => navigation.push(value), setUtilityModal: value => modal.push(value),
  });
  return { cleanup, navigation, modal };
}

let passed = 0;
function test(name, run) {
  run();
  passed++;
  console.log(`PASS ${name}`);
}

test('an announcement lost before the parent mounts is recovered by its first query', () => {
  const host = fakeWindow();
  const child = fakeWindow();
  const ready = [];
  let announcements = 0;
  host.postMessage = (data, targetOrigin) => {
    assert.equal(targetOrigin, origin);
    announcements++;
    host.emit(data, child);
  };
  child.postMessage = (data, targetOrigin) => {
    assert.equal(targetOrigin, origin);
    child.emit(data, host);
  };
  const mounted = mountChild(child, host);
  assert.equal(announcements, 1);
  assert.equal(host.listeners.size, 0, 'The initial announcement really precedes the parent listener.');
  const bridge = startPresentationHandshake({
    host, getFrameWindow: () => child, isView: value => value === 'overview',
    onReady: value => ready.push(value), onTimeout: () => assert.fail('Recovered handshake must not time out.'),
  });
  assert.deepEqual(ready, ['overview']);
  assert.equal(announcements, 2);
  assert.equal(host.clock.timers.size, 0, 'Even an immediate response must clear both timers.');
  host.clock.advance(30_000);
  bridge.dispose(); mounted.cleanup();
});

test('requests before child hydration retry, and retry recovers a lost child announcement', () => {
  const f = fixture();
  const child = fakeWindow();
  assert.equal(f.requests.length, 1, 'Request status immediately.');
  f.host.clock.advance(1499);
  assert.equal(f.requests.length, 2);
  f.host.clock.advance(1);
  assert.equal(f.requests.length, 3);
  let dropAnnouncement = true;
  f.host.postMessage = data => {
    if (dropAnnouncement) { dropAnnouncement = false; return; }
    f.host.emit(data, f.frame);
  };
  const mounted = mountChild(child, f.host, { view: 'conversations' });
  f.frame.postMessage = (data, targetOrigin) => {
    assert.equal(targetOrigin, origin);
    child.emit(data, f.host);
  };
  f.host.clock.advance(750);
  assert.deepEqual(f.ready, ['conversations']);
  assert.equal(f.host.clock.timers.size, 0);
  f.bridge.dispose(); mounted.cleanup();
});

test('repeated ready announcements for the same view and later navigation remain observable', () => {
  const f = fixture();
  for (const view of ['overview', 'overview', 'team', 'team']) {
    f.host.emit({ type: 'imobflow-demo-active', view }, f.frame);
  }
  assert.deepEqual(f.ready, ['overview', 'overview', 'team', 'team']);
  f.bridge.request();
  assert.equal(f.requests.length, 2, 'onLoad can request fresh readiness after the first acknowledgement.');
  f.host.clock.advance(20_000);
  assert.equal(f.timeouts(), 0);
  assert.equal(f.host.clock.timers.size, 0);
  f.bridge.dispose();
});

test('the parent rejects unrelated origins, windows, message types and invalid views', () => {
  const f = fixture();
  const valid = { type: 'imobflow-demo-active', view: 'overview' };
  f.host.emit(valid, f.frame, 'https://untrusted.test');
  f.host.emit(valid, {});
  f.host.emit(valid, null);
  for (const data of [null, undefined, {}, { type: 'imobflow-demo-status-request', view: 'overview' },
    { type: 'imobflow-demo-active' }, { type: 'imobflow-demo-active', view: 123 },
    { type: 'imobflow-demo-active', view: 'not-a-chapter' }]) f.host.emit(data, f.frame);
  assert.deepEqual(f.ready, []);
  assert.equal(f.host.clock.timers.size, 2, 'Invalid messages must not stop recovery or suppress timeout.');
  f.host.emit(valid, f.frame);
  assert.deepEqual(f.ready, ['overview']);
  f.bridge.dispose();
});

test('a missing iframe is safe and can recover when its contentWindow becomes available', () => {
  let currentFrame = null;
  const f = fixture({ getFrameWindow: () => currentFrame });
  f.host.emit({ type: 'imobflow-demo-active', view: 'overview' }, null);
  f.host.clock.advance(1500);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.ready, []);
  currentFrame = f.frame;
  f.bridge.request();
  assert.equal(f.requests.length, 1);
  f.host.emit({ type: 'imobflow-demo-active', view: 'overview' }, f.frame);
  assert.deepEqual(f.ready, ['overview']);
  f.bridge.dispose();
});

test('the 15-second timeout is bounded, stops retries and still permits a late valid ready', () => {
  const f = fixture();
  f.host.clock.advance(14_999);
  assert.equal(f.timeouts(), 0);
  assert.equal(f.requests.length, 20);
  f.host.clock.advance(1);
  assert.equal(f.timeouts(), 1);
  assert.equal(f.host.clock.timers.size, 0);
  const requestsAtTimeout = f.requests.length;
  f.host.clock.advance(60_000);
  assert.equal(f.requests.length, requestsAtTimeout);
  assert.equal(f.timeouts(), 1);
  f.host.emit({ type: 'imobflow-demo-active', view: 'overview' }, f.frame);
  assert.deepEqual(f.ready, ['overview'], 'A slow iframe may dismiss the fallback after timeout.');
  assert.equal(f.host.clock.timers.size, 0);
  f.bridge.dispose();
});

test('a permanently missing frame also reaches the bounded fallback', () => {
  const f = fixture({ getFrameWindow: () => null });
  f.host.clock.advance(15_000);
  assert.equal(f.timeouts(), 1);
  assert.equal(f.host.clock.timers.size, 0);
  f.bridge.dispose();
});

test('dispose and Strict Mode remount leave no old listener, timers or callbacks active', () => {
  const f = fixture();
  const staleListener = [...f.host.listeners][0];
  const staleTimers = [...f.host.clock.callbacks];
  f.bridge.dispose(); f.bridge.dispose(); f.bridge.request();
  assert.equal(f.host.listeners.size, 0);
  assert.equal(f.host.clock.timers.size, 0);
  const nextReady = [];
  let nextTimeouts = 0;
  const next = startPresentationHandshake({
    host: f.host, getFrameWindow: () => f.frame, isView: value => value === 'overview',
    onReady: view => nextReady.push(view), onTimeout: () => nextTimeouts++,
  });
  for (const callback of staleTimers) callback();
  staleListener({ origin, source: f.frame, data: { type: 'imobflow-demo-active', view: 'overview' } });
  assert.equal(f.requests.length, 2, 'Only the first request of each mount is sent.');
  assert.equal(f.host.clock.timers.size, 2, 'Stale cleanup must not cancel the new handshake.');
  assert.deepEqual(f.ready, []);
  assert.equal(f.timeouts(), 0);
  f.host.emit({ type: 'imobflow-demo-active', view: 'overview' }, f.frame);
  assert.deepEqual(nextReady, ['overview']);
  next.dispose(); f.host.clock.advance(30_000);
  assert.equal(nextTimeouts, 0);
  assert.equal(f.host.listeners.size, 0);
  assert.equal(f.host.clock.timers.size, 0);
});

test('postMessage exceptions do not crash the page or prevent the timeout fallback', () => {
  const f = fixture({ onRequest: () => { throw new Error('Frame is blocked'); } });
  assert.doesNotThrow(() => f.bridge.request());
  f.host.clock.advance(15_000);
  assert.equal(f.timeouts(), 1);
  assert.ok(f.requests.length > 2, 'A transient blocked frame still gets retries.');
  assert.equal(f.host.clock.timers.size, 0);
  f.bridge.dispose();
});

test('the actual child responds only in public demo, validates parent/origin and repeats its active view', () => {
  const child = fakeWindow();
  const replies = [];
  const parent = { postMessage: (data, targetOrigin) => {
    assert.equal(targetOrigin, origin);
    replies.push({ type: data.type, view: data.view });
  } };
  const inactive = mountChild(child, parent, { publicDemo: false });
  assert.equal(inactive.cleanup, undefined);
  assert.equal(child.listeners.size, 0);
  assert.deepEqual(replies, []);
  const active = mountChild(child, parent, { view: 'overview', utilityModal: 'team' });
  const ping = { type: 'imobflow-demo-status-request' };
  child.emit(ping, {}, origin);
  child.emit(ping, parent, 'https://untrusted.test');
  child.emit({ type: 'unrelated' }, parent);
  assert.equal(replies.length, 1, 'Invalid messages cannot provoke a readiness response.');
  child.emit(ping, parent); child.emit(ping, parent);
  assert.deepEqual(replies, Array.from({ length: 3 }, () => ({ type: 'imobflow-demo-active', view: 'team' })));
  child.emit({ type: 'imobflow-demo-view', view: 'invalid' }, parent);
  assert.deepEqual(active.navigation, []);
  child.emit({ type: 'imobflow-demo-view', view: 'overview' }, parent);
  assert.deepEqual(active.navigation, ['overview']);
  assert.deepEqual(active.modal, [null]);
  active.cleanup(); child.emit(ping, parent);
  assert.equal(child.listeners.size, 0);
  assert.equal(replies.length, 3);
});

test('parent integration requests real readiness on load and remounts the iframe on retry', () => {
  const parent = parse('app/apresentacao/presentation.tsx');
  const frame = findNodes(parent, node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
    && node.tagName.getText(parent) === 'iframe');
  assert.equal(frame.length, 1);
  const attribute = name => frame[0].attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.text === name);
  assert.equal(attribute('src').initializer.text, '/demonstracao');
  assert.equal(attribute('key').initializer.expression.getText(parent), 'attempt');
  assert.match(attribute('onLoad').initializer.expression.getText(parent), /handshake\.current\?\.request\(\)/);
  assert.doesNotMatch(attribute('onLoad').getText(parent), /setReady|setLoadFailed/,
    'An iframe load event is not proof that its dashboard hydrated.');
  const effects = findNodes(parent, node => ts.isCallExpression(node)
    && node.expression.getText(parent) === 'useEffect'
    && node.arguments[0]?.getText(parent).includes('startPresentationHandshake'));
  assert.equal(effects.length, 1);
  assert.equal(effects[0].arguments[1].getText(parent), '[attempt]');
  const effect = effects[0].arguments[0].getText(parent);
  assert.match(effect, /bridge\.dispose\(\)/);
  assert.match(effect, /getFrameWindow:\s*\(\)\s*=>\s*frame\.current\?\.contentWindow\s*\?\?\s*null/);
  assert.match(effect, /onTimeout:\s*\(\)\s*=>\s*setLoadFailed\(true\)/);
  const retry = findNodes(parent, node => ts.isFunctionDeclaration(node) && node.name?.text === 'retryPanel');
  assert.equal(retry.length, 1);
  const retryBody = retry[0].getText(parent);
  assert.match(retryBody, /setReady\(false\)/);
  assert.match(retryBody, /setLoadFailed\(false\)/);
  assert.match(retryBody, /setAttempt\(value\s*=>\s*value\s*\+\s*1\)/);
  assert.match(parent.text, /onClick=\{retryPanel\}/);
});

console.log(`PASS presentation handshake: ${passed} isolated regression tests; no browser, network or real timers`);
