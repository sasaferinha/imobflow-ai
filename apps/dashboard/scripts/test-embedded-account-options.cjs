const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the exact embedded-only JSX, with isolated callbacks and no network.
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/dashboard-client.tsx'), 'utf8');
const block = source.match(/\{embedded && <details className="embedded-account-options"[\s\S]*?<\/details>\}/)?.[0];
assert(block, 'embedded account actions must be a single native disclosure');
const expression = block.slice(1, -1);
const compiled = ts.transpileModule(`export default function Options({ embedded, account, publicDemo, setUtilityModal, notify }) { return (${expression}); }`, {
  fileName: 'embedded-options.tsx', reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.equal((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
const jsx = (type, props) => ({ type, props });
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
function harness({ embedded = true, role = 'owner', publicDemo = false } = {}) {
  const modals = [], notices = [], requests = [], state = { open: true, focused: false };
  const module = { exports: {} };
  const window = { location: { href: '' } };
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports, window,
    require(name) { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
    fetch: async (...args) => { requests.push(args); return { ok: true }; },
  });
  const tree = module.exports.default({ embedded, account: { role }, publicDemo, setUtilityModal: value => modals.push(value), notify: value => notices.push(value) });
  const details = {
    get open() { return state.open; },
    set open(value) { state.open = value; },
    removeAttribute(name) { assert.equal(name, 'open'); state.open = false; },
    contains(value) { return value === 'inside'; },
    querySelector(name) { assert.equal(name, 'summary'); return { focus() { state.focused = true; } }; },
  };
  const event = { currentTarget: { closest(name) { assert.equal(name, 'details'); return details; } } };
  const buttons = nodes(tree).filter(node => node.type === 'button');
  return { tree, buttons, details, event, modals, notices, requests, window, state };
}
async function run() {
  assert.equal(harness({ embedded: false }).tree, false, 'standalone sidebar must not duplicate these options');
  const owner = harness();
  assert.equal(owner.tree.type, 'details');
  assert.equal(owner.tree.props.open, undefined, 'native disclosure starts closed');
  assert.equal(nodes(owner.tree).filter(node => node.type === 'summary').length, 1);
  assert.equal(text(nodes(owner.tree).find(node => node.type === 'summary')), 'Opções da conta');
  assert.deepEqual(owner.buttons.map(text), ['Perfil', 'Senha', 'Preferências', 'Corretores', 'Sair']);
  assert.deepEqual(harness({ role: 'broker' }).buttons.map(text), ['Perfil', 'Senha', 'Preferências', 'Sair']);
  assert.equal(owner.requests.length, 0, 'rendering disclosure never makes requests');
  const expected = ['profile', 'password', 'settings', 'team'];
  for (let index = 0; index < expected.length; index++) {
    owner.state.open = true;
    owner.buttons[index].props.onClick(owner.event);
    assert.equal(owner.modals[index], expected[index]);
    assert.equal(owner.state.open, false, 'choosing a modal collapses disclosure');
  }
  owner.state.open = true;
  owner.tree.props.onBlur({ currentTarget: owner.details, relatedTarget: 'inside' });
  assert.equal(owner.state.open, true, 'tabbing between disclosure controls stays open');
  owner.tree.props.onBlur({ currentTarget: owner.details, relatedTarget: null });
  assert.equal(owner.state.open, false, 'leaving account options collapses disclosure');
  owner.state.open = true;
  owner.tree.props.onKeyDown({ key: 'Escape', currentTarget: owner.details });
  assert.equal(owner.state.open, false);
  assert.equal(owner.state.focused, true, 'Escape returns focus to the disclosure summary');
  const demo = harness({ publicDemo: true });
  await demo.buttons.at(-1).props.onClick(demo.event);
  assert.equal(demo.requests.length, 0, 'demo sign out cannot end a real session');
  assert.equal(demo.notices.length, 1);
  assert.equal(demo.window.location.href, '');
  const live = harness();
  await live.buttons.at(-1).props.onClick(live.event);
  assert.equal(live.requests.length, 1);
  assert.equal(live.requests[0][0], '/api/admin/logout');
  assert.equal(live.requests[0][1].method, 'POST');
  assert.equal(live.window.location.href, '/painel');
  assert(source.includes('className="icon-button theme-toggle"'), 'theme control remains separate');
  assert(source.includes('className="notification-wrap"'), 'notifications remain separate');
  console.log('PASS embedded account disclosure: one closed native summary, preserved role/modal/logout contracts, keyboard focus, demo isolation. Synthetic callbacks only.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
