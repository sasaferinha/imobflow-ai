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
    if (relative === clientPath) source += '\nexport { RecordEditor, RecordDetail };';
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
        if (id === '../lead-source-picker') return load('app/lead-source-picker.tsx');
        if (id === '../guided-record-field') return load('app/guided-record-field.tsx');
        if (id === '@/lib/guided-record-fields') return load('lib/guided-record-fields.ts');
        if (id === '../conversation-registration') return load('app/conversation-registration.tsx');
        if (id === './lead-source-picker') return load('app/lead-source-picker.tsx');
        if (id === '@/lib/evolution/registration-contract') return load('lib/evolution/registration-contract.ts');
        if (id === '@/lib/dashboard-transport') return { isProductDemo: () => false, dashboardFetch: () => { throw new Error('Navigation tests must never fetch conversation data'); } };
        if (id === '@/lib/evolution/model') return load('lib/evolution/model.ts');
        if (id === '@/lib/evolution/historical-funnel') return load('lib/evolution/historical-funnel.ts');
        if (id === '../lead-sources' || id === '@/lib/lead-sources') return load('lib/lead-sources.ts');
        if (id === '@/lib/evolution/schema' || id === './schema') return load('lib/evolution/schema.ts');
        if (id === './registration-contract') return load('lib/evolution/registration-contract.ts');
        if (id === './operations' || id === '@/lib/evolution/operations') return load('lib/evolution/operations.ts');
        if (id === './operations-center') return load('app/evolution/operations-center.tsx');
        if (id === '@/lib/panel-reminders') return load('lib/panel-reminders.ts');
        if (id === '@/lib/evolution/weekly-report') return load('lib/evolution/weekly-report.ts');
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
const { default: EvolutionClient, RecordEditor, RecordDetail } = server.load(clientPath);
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
function navigationHarness(actor = owner, hash = '#conversations', browser = {}) {
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
      if (!slots[slot] || differs(slots[slot].deps, deps)) {
        const previous = slots[slot]; slots[slot] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[slot].cleanup = effect(); });
      }
    },
  };
  const requests = [];
  const isolated = runtime(hooks, {
    window: { location: { hash, pathname: '/painel', search: '' }, history: { replaceState() {} }, ...browser.window },
    document: browser.document,
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
click(nav, 'Conversas');
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
find(broker.tree, node => node.props?.['aria-label'] === 'Opções de Equipe').props.onClick(); broker.render();
assert(!button(broker, 'Corretores e acessos'));
find(broker.tree, node => node.props?.['aria-label'] === 'Opções de Relatórios').props.onClick(); broker.render();
assert(!button(broker, 'Metas da operação'));
find(broker.tree, node => node.props?.['aria-label'] === 'Opções de Leads').props.onClick(); broker.render();
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

// Test the editor's submitted values as well as its rendered source control.
// A person already in the canonical CRM must retain the existing acquisition
// source instead of offering a choice that the server would reject or replace.
function editorHarness(editor, editorState = state) {
  let cursor = 0, tree;
  const slots = [], saves = [];
  const hooks = { ...React, useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  } };
  const Component = runtime(hooks).load(clientPath).RecordEditor;
  const props = { editor, state: editorState, actor: owner, busy: false, error: '', onClose() {}, onSave: async data => { saves.push(data); } };
  function render() { cursor = 0; tree = Component(props); }
  render();
  return {
    saves, get tree() { return tree; },
    source() { return find(tree, node => node.props?.id === 'edit-source'); },
    change(id, value) { const control = find(tree, node => node.props?.id === id); assert(control, id); control.props.onChange({ target: { value } }); render(); },
    changeSource(value) { this.source().props.onChange(value); render(); },
    submit() { find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); },
  };
}
const sourceState = structuredClone(state);
const canonicalSourceLead = sourceState.records.find(record => record.kind === 'leads');
canonicalSourceLead.legacy = { table: 'leads', id: 'source-test', access: 'owner' };
canonicalSourceLead.data.source = '  Origem histórica específica  ';
for (const kind of ['leads', 'cases']) {
  const editor = editorHarness({ kind, defaults: { source: 'Instagram' } }, sourceState);
  assert.equal(editor.source().props.disabled, false, `${kind}: source can be chosen before selecting an existing person`);
  editor.change('edit-personId', canonicalSourceLead.data.personId);
  assert.equal(editor.source().props.disabled, true, `${kind}: selecting the canonical person locks its source`);
  assert.equal(editor.source().props.value, canonicalSourceLead.data.source, `${kind}: the displayed source comes from the canonical contact`);
  assert(text(editor.tree).includes('Para corrigir, use Registro em Conversas.'));
  editor.submit();
  assert.equal(editor.saves[0].source, canonicalSourceLead.data.source, `${kind}: submitted origin matches the locked choice, preserving historical spaces`);
  assert.equal(editor.saves[0].personId, canonicalSourceLead.data.personId);
}
for (const kind of ['leads', 'cases']) {
  const record = { ...canonicalSourceLead, kind, data: { ...canonicalSourceLead.data, journey: 'Negociação', stage: 'Lead', status: kind === 'cases' ? 'Aberto' : 'Pendente' } };
  const editor = editorHarness({ kind, record }, sourceState);
  assert.equal(editor.source().props.disabled, true, `${kind}: an existing canonical origin cannot be changed through the generic editor`);
  assert.equal(editor.source().props.value, record.data.source);
  editor.change('edit-name', 'Nome revisto sem mudar a origem'); editor.submit();
  assert.equal(editor.saves[0].source, record.data.source, `${kind}: unrelated edits never trim an untouched historical origin`);
}
const editableSource = editorHarness({ kind: 'leads', defaults: { source: '  Fonte antiga  ' } });
editableSource.submit(); assert.equal(editableSource.saves[0].source, '  Fonte antiga  ', 'the original source is kept byte-for-byte when untouched');
editableSource.changeSource('Outros: Feira local  '); editableSource.submit();
assert.equal(editableSource.saves[1].source, 'Outros: Feira local', 'only an explicitly changed source is trimmed on submit');

const closedState = structuredClone(state);
const closedCase = closedState.records.find(record => record.kind === 'cases');
closedCase.data.status = 'Ganho'; closedCase.data.stage = 'Negociado';
const closedProposal = { id: 'closed-proposal-test', kind: 'proposals', createdBy: owner.brokerId, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', data: { name: 'Proposta encerrada de teste', caseId: closedCase.id, propertyId: closedCase.data.propertyId, status: 'Aceita', amount: 400000 } };
closedState.records.push(closedProposal);
for (const record of [closedCase, closedProposal]) {
  const detail = renderToStaticMarkup(React.createElement(RecordDetail, { record, state: closedState, actor: owner, demonstration: true, busy: false, error: '', onClose() {}, onEdit() {}, onCreate() {}, onSelect() {}, execute: async () => false }));
  assert(detail.includes('Editar fechamento'), `${record.kind}: a closed result exposes the dedicated correction entry point`);
  assert(detail.includes('aria-haspopup="dialog"'), 'correction button announces a dialog');
  assert(!detail.includes('Editar</button>'), `${record.kind}: a closed result does not offer the generic editor for protected fields`);
}
const unrelatedActor = { ...owner, brokerId: 'other-test-broker', role: 'broker' };
const protectedDetail = renderToStaticMarkup(React.createElement(RecordDetail, { record: closedProposal, state: closedState, actor: unrelatedActor, busy: false, error: '', onClose() {}, onEdit() {}, onCreate() {}, onSelect() {}, execute: async () => false }));
assert(!protectedDetail.includes('Editar fechamento'), 'an unrelated broker cannot access closing correction from the detail');

console.log('PASS evolution navigation: SSR preview isolation; integration capability; retained native host; refresh without remount; owner/broker menu boundaries; canonical editor preservation; inherited origin on new lead/case, locked historical source, exact untouched values and explicit source normalization.');

// Shared isolated hook harness for the Linha navigation/accessibility contracts.
module.exports = { navigationHarness, find, text, button, click, owner, state, runtime };
