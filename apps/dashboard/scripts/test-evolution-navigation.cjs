const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const clientPath = 'app/evolution/evolution-client.tsx';
const clientSource = fs.readFileSync(path.join(root, clientPath), 'utf8');
const wrapperSource = fs.readFileSync(path.join(root, 'app/evolution/legacy-panel.tsx'), 'utf8');
const owner = { companyId: 'navigation-test', brokerId: 'test-owner', name: 'Pessoa fictícia', role: 'owner' };

// This intentionally tests only render/navigation contracts. No network, live
// sessions, browser storage or real records are read or changed.
function runtime(react = React, environment = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.join(root, relative);
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    let source = fs.readFileSync(file, 'utf8');
    if (relative === clientPath) source += '\nexport { RecordEditor };';
    const script = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    vm.runInNewContext(script, {
      module, exports: module.exports, crypto, structuredClone, URL, Date, console, process,
      require: id => {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return css;
        if (id === './account-menu') return load('app/evolution/account-menu.tsx');
        if (id === '@/lib/evolution/model') return load('lib/evolution/model.ts');
        if (id === '@/lib/evolution/schema' || id === './schema') return load('lib/evolution/schema.ts');
        throw new Error(`Unexpected client dependency: ${id}`);
      },
      ...environment,
    }, { filename: file });
    modules.set(file, module.exports);
    return module.exports;
  }
  return { load };
}

const server = runtime();
const model = server.load('lib/evolution/model.ts');
const { default: EvolutionClient, RecordEditor } = server.load(clientPath);
const state = model.createDemoState(owner.companyId, owner.brokerId, '2026-10-07T16:00:00.000Z');
const nativeHost = (page, refreshKey) => React.createElement('native-host', { page, refreshKey });

function renderClient(extra) {
  return renderToStaticMarkup(React.createElement(EvolutionClient, { initialState: state, actor: owner, ...extra }));
}
const preview = renderClient({ mode: 'preview', integrated: true, renderOperationalPanel: nativeHost });
assert(preview.includes('Prévia privada'));
assert(!preview.includes('Sua operação real'), 'Preview must not claim a production integration.');
assert(!preview.includes('<native-host'), 'Preview must never render the live operational panel.');
assert(!renderClient({ mode: 'live' }).includes('Sua operação real'));
const live = renderClient({ mode: 'live', integrated: true, renderOperationalPanel: nativeHost });
assert(live.includes('Sua operação real'));
assert(live.includes('Operação real integrada'));
assert(!live.includes('Prévia privada'));
assert(!/from ['"].*(dashboard-client|legacy-panel)['"]/.test(clientSource));
// The production-only checkout does not package the independent preview app.
const previewSync = path.join(root, '../evolution-preview/scripts/sync-evolution.mjs');
if (fs.existsSync(previewSync)) assert(!fs.readFileSync(previewSync, 'utf8').includes('legacy-panel'));
assert(clientSource.includes('expectedSourceRevision: state.sourceRevision'));

// A small hook runner checks the parent element's retention and stable keys.
// It is not a substitute for browser tests of DOM focus, layout or requests.
function navigationHarness(actor = owner, hash = '#conversations') {
  let index = 0, slots = [], effects = [], dirty = false, tree;
  const differs = (left, right) => !left || !right || left.length !== right.length || left.some((value, i) => value !== right[i]);
  const hooks = {
    ...React,
    useState(initial) {
      const slot = index++;
      if (!slots[slot]) slots[slot] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[slot].value, update => {
        const next = typeof update === 'function' ? update(slots[slot].value) : update;
        if (next !== slots[slot].value) { slots[slot].value = next; dirty = true; }
      }];
    },
    useRef(value) {
      const slot = index++;
      if (!slots[slot]) slots[slot] = { current: value };
      return slots[slot];
    },
    useMemo(compute, deps) {
      const slot = index++;
      if (!slots[slot] || differs(slots[slot].deps, deps)) slots[slot] = { deps, value: compute() };
      return slots[slot].value;
    },
    useEffect(effect, deps) {
      const slot = index++;
      if (!slots[slot] || differs(slots[slot].deps, deps)) { slots[slot] = { deps }; effects.push(effect); }
    },
  };
  const requests = [];
  const isolated = runtime(hooks, {
    window: { location: { hash, pathname: '/painel', search: '' }, history: { replaceState() {} } },
    fetch: async (url, options) => {
      requests.push({ url, method: options?.method || 'GET' });
      return { ok: true, json: async () => ({ state }) };
    },
  });
  const Client = isolated.load(clientPath).default;
  const props = { initialState: state, actor, mode: 'live', integrated: true, renderOperationalPanel: nativeHost };
  function render() {
    let attempts = 0;
    do {
      dirty = false; index = 0; effects = [];
      tree = Client(props);
      for (const effect of effects) effect();
      assert(++attempts < 15, 'Navigation must not cause a render loop.');
    } while (dirty);
    return tree;
  }
  render();
  return { render, requests, get tree() { return tree; } };
}

function find(node, predicate) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const child of node) { const match = find(child, predicate); if (match) return match; }
    return null;
  }
  if (typeof node !== 'object') return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function button(harness, label) {
  return find(harness.tree, node => node.type === 'button' && text(node) === label);
}
function click(harness, label) {
  const target = button(harness, label);
  assert(target, `Missing navigation button: ${label}`);
  target.props.onClick(); harness.render();
}
const nav = navigationHarness();
const host = () => find(nav.tree, node => node.type === 'native-host');
const container = () => find(nav.tree, node => node.props?.className === 'operationalPanel');
assert.equal(host().props.page, 'conversations');
assert.equal(container().props.hidden, false);
click(nav, 'Dashboard');
assert.equal(host().props.page, 'conversations', 'The operational child must remain mounted outside native tabs.');
assert.equal(container().props.hidden, true);
assert.equal(container().props.inert, true);
click(nav, 'CRM'); click(nav, 'Conversas');
assert.equal(container().props.hidden, false);
find(nav.tree, node => node.props?.['aria-label'] === 'Atualizar').props.onClick(); nav.render();
assert.equal(host().props.refreshKey, 1);
assert.equal(host().key, null);
assert(!wrapperSource.includes('key='), 'Refreshing must not remount DashboardClient and erase unsent drafts.');
assert(wrapperSource.includes('function OperationalPanel('), 'The native host component type must be stable.');
assert(wrapperSource.includes('announceDashboardChange(entity)'));
assert(nav.requests.every(request => request.url === '/api/evolution' && request.method === 'GET'));

const broker = navigationHarness({ ...owner, role: 'broker' }, '#brokers');
assert(!find(broker.tree, node => node.type === 'native-host'), 'A broker cannot open the owner-only operational route by hash.');
click(broker, 'Painel de controle');
assert(!button(broker, 'Corretores e acessos'));
assert(!button(broker, 'Metas da operação'));
click(broker, 'Pessoas');
assert(!button(broker, 'Importar clientes'));

// Editing an existing canonical record must not force invented legacy values.
const property = {
  id: 'legacy-property-test', kind: 'properties', createdAt: '2026-10-07T12:00:00Z', updatedAt: '2026-10-07T12:00:00Z', createdBy: owner.brokerId,
  data: { name: 'Imóvel fictício', code: '', assignedTo: '', purpose: '', price: 123, status: 'Disponível', photoUrl: 'data:image/png;base64,AAA' },
  legacy: { table: 'properties', id: 'original-test', access: 'owner', missingPurpose: true },
};
function renderEditor(record) {
  return renderToStaticMarkup(React.createElement(RecordEditor, {
    editor: { kind: record.kind, record }, state, actor: owner, busy: false, error: '', onClose() {}, onSave: async () => {},
  }));
}
const propertyForm = renderEditor(property);
assert(!/<input[^>]*id="edit-code"[^>]*required/.test(propertyForm));
assert(!/<select[^>]*id="edit-assignedTo"[^>]*required/.test(propertyForm));
assert(propertyForm.includes('<option value="" selected="">Não informado</option>'));
assert(!propertyForm.includes('data:image/png'));
assert(propertyForm.includes('Foto existente preservada'));
const leadForm = renderEditor({ ...property, id: 'legacy-lead-test', kind: 'leads', data: {
  name: 'Lead fictício', personId: '', assignedTo: '', purpose: '', source: 'Importação', status: 'Pendente',
}, legacy: { table: 'leads', id: 'original-test', access: 'owner' } });
assert(/<select[^>]*id="edit-assignedTo"[^>]*disabled/.test(leadForm));
assert(leadForm.includes('ao assumir ou devolver'));

console.log('PASS evolution navigation: SSR preview isolation; integration capability; retained native host; refresh without remount; owner/broker menu boundaries; canonical editor preservation.');
