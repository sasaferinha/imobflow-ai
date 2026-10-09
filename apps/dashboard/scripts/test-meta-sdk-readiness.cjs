// Regression: an early Script callback must not cancel SDK readiness polling.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
function load(file, dependencies, globals = {}) {
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: name => name in dependencies ? dependencies[name] : require(name), ...globals });
  return mod.exports;
}
const client = load('lib/meta-whatsapp-signup-client.ts', {});
function scenario(status = 'loading', initThrows = false) {
  let index = 0, poll, timeout;
  const effects = [], updates = [];
  const config = { available: true, appId: '123456', configId: '654321', apiVersion: 'v26.0' };
  const values = [{ configured: false }, config, false, 0, 'idle', false, null, status];
  const fakeWindow = {
    setInterval(fn) { poll = fn; return 1; }, clearInterval() { poll = null; },
    setTimeout(fn) { timeout = fn; return 2; }, clearTimeout() { timeout = null; },
  };
  const Script = () => null;
  const Component = load('app/whatsapp-integration.tsx', {
    react: { ...React, useState(initial) { const key = index++; return [key < values.length ? values[key] : initial, value => updates.push({ key, value })]; }, useRef: current => ({ current }), useEffect: fn => effects.push(fn) },
    'next/script': { default: Script }, '@/lib/dashboard-transport': {},
    '@/lib/meta-whatsapp-signup-client': client, './whatsapp-integration.css': {}, './social-integrations': {default:()=>null},
  }, { window: fakeWindow }).default;
  const tree = Component({ canEdit: true, onOpenConversations() {} });
  const nodes = [];
  function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); nodes.push(node); walk(node.props?.children); }
  walk(tree);
  const button = nodes.find(node => node.type === 'button' && node.props.onClick?.name === 'connect');
  assert.equal(button.props.disabled, status !== 'ready');
  if (status !== 'loading') return;
  const unmount = effects[0]();
  const cleanupPolling = effects[2]();
  const script = nodes.find(node => node.type === Script);
  script.props.onReady();
  assert.equal(updates.some(update => update.key === 7), false, 'early callback must not mark SDK failed');
  const abandonedCalls = [];
  fakeWindow.FB = { __buffer: { calls: abandonedCalls }, init() {}, login() { abandonedCalls.push('login'); } };
  script.props.onLoad();
  poll();
  assert.equal(updates.some(update => update.key === 7), false, 'buffering facade must never enable the login button');
  assert.equal(abandonedCalls.length, 0);
  fakeWindow.FB = { init() { if (initThrows) throw new Error('init failed'); }, login() {} };
  poll();
  assert.equal(updates.findLast(update => update.key === 7).value, initThrows ? 'failed' : 'ready');
  unmount(); cleanupPolling();
  assert.equal(poll, null); assert.equal(timeout, null);
}
scenario(); scenario('loading', true); scenario('ready'); scenario('failed');
console.log('PASS delayed SDK callback, eventual readiness, initialization failure, button gating and cleanup');
