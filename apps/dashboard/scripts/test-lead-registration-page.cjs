const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Synthetic component tests only: no real network, browser storage or tenant data.
const root = path.resolve(__dirname, '..');
const clientPath = 'app/evolution/evolution-client.tsx';
const owner = { companyId: 'lead-page-test', brokerId: 'test-owner', name: 'Pessoa fictícia', role: 'owner' };
const source = fs.readFileSync(path.join(root, clientPath), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'app/evolution/evolution.module.css'), 'utf8');

function runtime(react = React, environment = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    assert(file.startsWith(`${root}${path.sep}`), 'The test loader stays inside the dashboard.');
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    modules.set(file, module.exports);
    let code = fs.readFileSync(file, 'utf8');
    if (relative.replaceAll('\\', '/') === clientPath) code += '\nexport { RecordEditor, RecordDetail };';
    const compiled = ts.transpileModule(code, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, crypto, structuredClone, URL, Date, console, process,
      require(id) {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        if (id === '@/lib/dashboard-transport') return {
          isProductDemo: () => false,
          dashboardFetch: () => { throw new Error('The test must not fetch live conversation data.'); },
        };
        assert(id.startsWith('@/') || id.startsWith('.'), `Unexpected client dependency: ${id}`);
        const target = id.startsWith('@/') ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        const resolved = ['.ts', '.tsx', '.cjs'].map(extension => `${target}${extension}`).find(candidate => fs.existsSync(candidate));
        assert(resolved, `Missing local dependency: ${id}`);
        return load(path.relative(root, resolved));
      },
      ...environment,
    }, { filename: file });
    modules.set(file, module.exports);
    return module.exports;
  }
  return { load };
}

const model = runtime().load('lib/evolution/model.ts');
const state = model.createDemoState(owner.companyId, owner.brokerId, '2026-10-19T16:00:00.000Z');
state.sourceRevision = 'synthetic-source-revision';
const all = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
const find = (node, predicate) => all(node).find(predicate);
const text = node => node == null || typeof node === 'boolean' ? ''
  : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const clickNode = (tree, predicate, description) => {
  const node = find(tree, predicate);
  assert(node, `Missing ${description}`);
  node.props.onClick();
};

function hookHarness(componentName, props, environment = {}) {
  let cursor = 0, dirty = false, effects = [], tree;
  const slots = [];
  const differs = (left, right) => !left || !right || left.length !== right.length || left.some((value, index) => value !== right[index]);
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (next !== slots[index].value) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: value };
      return slots[index];
    },
    useMemo(compute, deps) {
      const index = cursor++;
      if (!(index in slots) || differs(slots[index].deps, deps)) slots[index] = { deps, value: compute() };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!(index in slots) || differs(slots[index].deps, deps)) {
        const previous = slots[index]; slots[index] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  hooks.useCallback = (callback, deps) => hooks.useMemo(() => callback, deps);
  const Component = runtime(hooks, environment).load(clientPath)[componentName];
  function render(nextProps) {
    if (nextProps) props = { ...props, ...nextProps };
    let attempts = 0;
    do {
      dirty = false; cursor = 0; effects = [];
      tree = Component(props);
      effects.forEach(effect => effect());
      assert(++attempts < 20, 'Component must settle without a render loop.');
    } while (dirty);
    return tree;
  }
  render();
  return { render, get tree() { return tree; }, get props() { return props; }, unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

function navigationHarness({ hash = '#leads/new', actor = owner, responses = [] } = {}) {
  const requests = [], historyCalls = [], confirms = [], listeners = new Map();
  let confirmAnswer = false;
  const location = { hash, pathname: '/painel', search: '', href: `https://example.invalid/painel${hash}` };
  const updateUrl = (method, stateValue, unused, url) => {
    const next = new URL(url, location.href);
    Object.assign(location, { hash: next.hash, pathname: next.pathname, search: next.search, href: next.href });
    historyCalls.push({ method, url, state: stateValue });
  };
  const window = {
    location, history: {
      pushState: (...args) => updateUrl('pushState', ...args),
      replaceState: (...args) => updateUrl('replaceState', ...args),
    },
    confirm(message) { confirms.push(message); return confirmAnswer; },
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    scrollTo() {}, setTimeout() { return 1; }, clearTimeout() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
  };
  const document = { visibilityState: 'visible', body: { style: { overflow: '' } }, activeElement: null,
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };
  const props = { initialState: state, actor, mode: 'live', integrated: true,
    renderOperationalPanel: (page, refreshKey) => React.createElement('native-host', { page, refreshKey }) };
  const harness = hookHarness('default', props, {
    window, document,
    fetch: async (url, options) => {
      requests.push({ url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null });
      const response = responses.shift();
      if (typeof response === 'function') return response();
      if (response instanceof Error) throw response;
      return response || { ok: true, status: 200, json: async () => ({ state }) };
    },
  });
  return Object.assign(harness, { requests, historyCalls, confirms, location,
    confirm(value) { confirmAnswer = value; },
    dispatch(name, event = {}) { for (const listener of [...(listeners.get(name) || [])]) listener(event); harness.render(); return event; },
    moveHash(next) { location.hash = next; location.href = `https://example.invalid/painel${next}`; this.dispatch('hashchange'); },
    click(label) { clickNode(harness.tree, node => node.type === 'button' && text(node) === label, `button ${label}`); harness.render(); },
    editor() { return find(harness.tree, node => node.type?.name === 'RecordEditor'); },
  });
}

async function run() {
  const nav = navigationHarness();
  assert(nav.editor(), 'Direct #leads/new opens the lead editor.');
  assert.equal(nav.editor().props.fullPage, true, 'New leads render in full-page mode.');
  assert.equal(nav.editor().props.editor.kind, 'leads');
  assert.equal(nav.editor().props.editor.record, undefined, 'The route creates, never edits, a lead.');
  assert(!find(nav.tree, node => node.props?.className === 'filterBar'), 'Creation has no list filters.');
  assert(!find(nav.tree, node => node.props?.className === 'moduleActions'), 'Creation has no duplicate new-record button.');

  const { RecordEditor } = runtime().load(clientPath);
  const pageMarkup = renderToStaticMarkup(React.createElement(RecordEditor, nav.editor().props));
  assert(!pageMarkup.includes('<dialog'), 'Full-page registration must not be a modal.');
  assert(pageMarkup.includes('<form'), 'The page retains a native form.');
  assert(pageMarkup.includes('edit-personId') && pageMarkup.includes('edit-source'), 'Contact and acquisition source remain available.');
  assert(pageMarkup.includes('Comprar') && pageMarkup.includes('Alugar'), 'Selection-first guided controls are preserved.');
  assert(pageMarkup.includes('Preferências e informações complementares'), 'Optional fields remain available.');
  const pageRule = cssSource.match(/\.leadRegistrationPage\s*\{([^}]+)\}/)?.[1];
  assert(pageRule && /width:\s*100%/.test(pageRule), 'Registration uses the workspace width.');
  assert(!/position:\s*(?:fixed|absolute)|max-height:|overflow:\s*(?:auto|scroll)/.test(pageRule), 'The page itself is neither an overlay nor a nested scrolling modal.');
  assert(/\.registrationLayout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/.test(cssSource), 'A narrow viewport collapses the layout to one column.');
  assert(/\.modalFormLayout\s*\{\s*display:\s*contents;\s*\}/.test(cssSource), 'The shared form wrapper preserves the existing modal flex/scroll layout.');
  const untouched = navigationHarness();
  const pristineUnload = { prevented: false, preventDefault() { this.prevented = true; } };
  untouched.dispatch('beforeunload', pristineUnload);
  assert.equal(pristineUnload.prevented, false, 'An untouched page does not trap navigation.');
  untouched.editor().props.onClose(); untouched.render();
  assert.equal(untouched.confirms.length, 0, 'An untouched draft needs no discard confirmation.');
  assert.equal(untouched.location.hash, '#leads');

  for (const actor of [owner, { ...owner, role: 'broker' }]) {
    const fromList = navigationHarness({ hash: '#leads', actor });
    const actions = find(fromList.tree, node => node.props?.className === 'moduleActions');
    clickNode(actions, node => node.type === 'button', 'lead create action'); fromList.render();
    assert.equal(fromList.location.hash, '#leads/new');
    assert.equal(fromList.editor().props.fullPage, true, 'Both owner and broker use the dedicated page.');
  }

  const other = navigationHarness({ hash: '#properties' });
  clickNode(find(other.tree, node => node.props?.className === 'moduleActions'), node => node.type === 'button', 'property create action'); other.render();
  assert.notEqual(other.editor().props.fullPage, true, 'Other record creation is unchanged.');
  assert(renderToStaticMarkup(React.createElement(RecordEditor, other.editor().props)).includes('<dialog'));
  const existing = state.records.find(record => record.kind === 'leads');
  assert(renderToStaticMarkup(React.createElement(RecordEditor, {
    ...nav.editor().props, fullPage: false, editor: { kind: 'leads', record: existing },
  })).includes('<dialog'), 'Editing existing leads retains the modal.');

  const values = { name: 'Lead sintético', personId: existing.data.personId, assignedTo: owner.brokerId, source: 'Indicação', purpose: 'Venda', status: 'Pendente' };
  await nav.editor().props.onSave(values); nav.render();
  const request = nav.requests.find(item => item.method === 'POST');
  assert.equal(request.url, '/api/evolution');
  assert.equal(request.body.command.type, 'save');
  assert.equal(request.body.command.kind, 'leads');
  assert.equal(request.body.command.id, undefined);
  assert.deepEqual(request.body.command.data, values);
  assert.equal(request.body.expectedVersion, state.version, 'Existing optimistic concurrency is preserved.');
  assert.equal(request.body.expectedSourceRevision, state.sourceRevision, 'Canonical source concurrency is preserved.');
  assert.equal(nav.location.hash, '#leads', 'Successful save returns to the lead list.');
  assert(!nav.editor(), 'Successful save dismisses the completed draft.');

  const failed = navigationHarness({ responses: [{ ok: false, status: 500, json: async () => ({ error: 'Falha sintética. Tente novamente.' }) }] });
  await failed.editor().props.onSave(values); failed.render();
  assert.equal(failed.location.hash, '#leads/new');
  assert(failed.editor(), 'A failed save keeps the page mounted.');
  assert.equal(failed.editor().props.error, 'Falha sintética. Tente novamente.');
  const freshState = { ...state, version: state.version + 1, sourceRevision: 'updated-synthetic-revision' };
  const conflict = navigationHarness({ responses: [
    { ok: false, status: 409, json: async () => ({ error: 'Conflito sintético. Revise os dados.' }) },
    { ok: true, status: 200, json: async () => ({ state: freshState }) },
    { ok: true, status: 200, json: async () => ({ state: freshState }) },
  ] });
  await conflict.editor().props.onSave(values); conflict.render();
  assert.equal(conflict.location.hash, '#leads/new');
  assert.equal(conflict.editor().props.error, 'Conflito sintético. Revise os dados.');
  assert.equal(conflict.editor().props.state.version, freshState.version);
  await conflict.editor().props.onSave(values); conflict.render();
  const retried = conflict.requests.filter(item => item.method === 'POST')[1];
  assert.equal(retried.body.expectedVersion, freshState.version, 'Retry uses the refreshed concurrency version.');
  assert.equal(retried.body.expectedSourceRevision, freshState.sourceRevision);
  assert.deepEqual(retried.body.command.data, values);

  const dirtiness = [];
  const form = hookHarness('RecordEditor', { ...failed.editor().props, onDirtyChange: value => dirtiness.push(value) });
  const changeName = value => { find(form.tree, node => node.props?.id === 'edit-name').props.onChange({ target: { value } }); form.render(); };
  changeName('Nome ainda não salvo');
  form.render({ state: { ...state, version: state.version + 1 }, error: 'Conflito sintético' });
  assert.equal(find(form.tree, node => node.props?.id === 'edit-name').props.value, 'Nome ainda não salvo', 'Server refresh or conflict cannot reset the entered draft.');
  assert(dirtiness.includes(true), 'Changed form reports a draft to its navigation guard.');

  const guarded = navigationHarness();
  assert.equal(typeof guarded.editor().props.onDirtyChange, 'function');
  guarded.editor().props.onDirtyChange(true); guarded.render();
  guarded.editor().props.onClose(); guarded.render();
  assert(guarded.editor(), 'Declining discard keeps the lead page.');
  assert(guarded.confirms.length > 0, 'Cancel asks before discarding changes.');
  guarded.click('Dashboard');
  assert(guarded.editor(), 'Sidebar navigation also respects the draft guard.');
  const unload = { prevented: false, preventDefault() { this.prevented = true; }, returnValue: undefined };
  guarded.dispatch('beforeunload', unload);
  assert(unload.prevented, 'Closing or refreshing the browser protects unsaved changes.');
  guarded.moveHash('#dashboard');
  assert(guarded.editor(), 'Browser history navigation respects the draft guard.');
  assert.equal(guarded.location.hash, '#leads/new', 'Declining navigation restores the registration URL.');
  guarded.location.hash = '#dashboard'; guarded.dispatch('popstate');
  assert(guarded.editor(), 'Back/forward events respect the same draft guard.');
  assert.equal(guarded.location.hash, '#leads/new');
  guarded.confirm(true); guarded.editor().props.onClose(); guarded.render();
  assert.equal(guarded.location.hash, '#leads');
  assert(!guarded.editor(), 'Accepting discard returns to the list.');

  let finishSave;
  const pending = navigationHarness({ responses: [() => new Promise(resolve => { finishSave = resolve; })] });
  const saveAgain = pending.editor().props.onSave;
  const saving = saveAgain(values);
  await saveAgain(values); pending.render();
  assert.equal(pending.requests.filter(item => item.method === 'POST').length, 1, 'Rapid double-save does not create duplicate requests.');
  assert.equal(pending.editor().props.busy, true);
  pending.editor().props.onClose(); pending.render();
  assert(pending.editor(), 'The form cannot close while saving.');
  pending.click('Dashboard');
  assert(pending.editor(), 'The in-flight creation cannot be abandoned from the sidebar.');
  finishSave({ ok: true, status: 200, json: async () => ({ state }) }); await saving; pending.render();
  assert.equal(pending.location.hash, '#leads');

  assert(!/sessionStorage|localStorage/.test(source), 'The registration implementation does not persist customer drafts in browser storage.');
  console.log('Lead registration page: route, native page, guided fields, permissions, unchanged editors, CAS save, error/draft retention and exit guards passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
