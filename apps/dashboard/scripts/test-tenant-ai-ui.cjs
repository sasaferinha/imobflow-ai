const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Real components and controlled hooks, with synthetic accounts and denied
// external I/O. Browser layout/focus remain separate browser-QA obligations.
const root = path.resolve(__dirname, '..');
const formFile = 'app/evolution/ai-settings.tsx';
const clientFile = 'app/evolution/evolution-client.tsx';
const owner = { companyId: '00000000-0000-4000-8000-000000000001', brokerId: '00000000-0000-4000-8000-000000000011', name: 'Gestor sintético', role: 'owner' };
const forbiddenFetch = () => { throw Error('Unexpected network request in tenant AI UI test'); };
function runtime(react = React, environment = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    assert(file.startsWith(root + path.sep), 'Only dashboard-local modules may load');
    if (modules.has(file)) return modules.get(file);
    const mod = { exports: {} };
    modules.set(file, mod.exports);
    let source = fs.readFileSync(file, 'utf8');
    if (relative.replaceAll('\\', '/') === formFile) source += '\nexport { AISettingsForm };';
    const output = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(output, {
      module: mod, exports: mod.exports, crypto, structuredClone, URL, Date, Intl, console, process, AbortController,
      fetch: forbiddenFetch,
      require(id) {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        if (id === '@/lib/dashboard-transport') return { isProductDemo: () => false, dashboardFetch: environment.dashboardFetch || forbiddenFetch };
        assert(id.startsWith('@/') || id.startsWith('.'), `Unexpected dependency: ${id}`);
        const target = id.startsWith('@/') ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        const resolved = ['.ts', '.tsx'].map(extension => target + extension).find(candidate => fs.existsSync(candidate));
        assert(resolved, `Missing local dependency: ${id}`);
        return load(path.relative(root, resolved));
      },
      ...environment,
    }, { filename: file });
    modules.set(file, mod.exports);
    return mod.exports;
  }
  return { load };
}

const pure = runtime();
const config = pure.load('lib/ai/tenant-settings.ts');
const model = pure.load('lib/evolution/model.ts');
const initial = config.getTenantAISettings();
const baseState = model.emptyState(owner.companyId);
baseState.members = [{ id: owner.brokerId, name: owner.name, role: owner.role, specialization: 'Ambos' }];
baseState.sourceRevision = 'synthetic-source';
const stateWith = (settings, version = 1) => ({ ...structuredClone(baseState), version, settings: {
  ...baseState.settings, ai: { ...structuredClone(settings), updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: owner.brokerId },
} });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);
const control = (tree, label) => find(find(tree, node => node.type === 'label' && text(node).startsWith(label)), node => ['input', 'select', 'textarea'].includes(node.type));
const tick = () => new Promise(resolve => setImmediate(resolve));

function hooksHarness(file, exportName, initialProps, environment = {}) {
  let cursor = 0, pending = false, effects = [], tree, props = initialProps;
  const slots = [];
  const differs = (left, right) => !left || !right || left.length !== right.length || left.some((value, index) => value !== right[index]);
  const hooks = {
    ...React,
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof value === 'function' ? value() : value };
      return [slots[index].value, update => {
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (next !== slots[index].value) { slots[index].value = next; pending = true; }
      }];
    },
    useRef(value) { const index = cursor++; return slots[index] || (slots[index] = { current: value }); },
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
  const Component = runtime(hooks, environment).load(file)[exportName];
  function render(updates) {
    if (updates) props = { ...props, ...updates };
    let attempts = 0;
    do {
      pending = false; cursor = 0; effects = []; tree = Component(props);
      effects.forEach(effect => effect());
      assert(++attempts < 20, 'The component must settle without a render loop');
    } while (pending);
    return tree;
  }
  render();
  return { render, get tree() { return tree; }, get props() { return props; }, unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

function formHarness({ settings = initial, execute, preview = true, dashboardFetch } = {}) {
  const commands = [], dirty = [], confirmations = [];
  let confirmation = false;
  const currentState = stateWith(settings);
  const instance = hooksHarness(formFile, 'AISettingsForm', {
    initial: structuredClone(settings), state: currentState, isAdmin: true, busy: false, preview,
    execute: async command => { commands.push(structuredClone(command)); return execute ? execute(command) : false; },
    onDirtyChange: value => dirty.push(value),
  }, { window: { confirm: message => { confirmations.push(message); return confirmation; } }, dashboardFetch });
  return Object.assign(instance, {
    commands, dirty, confirmations,
    confirm(value) { confirmation = value; },
    change(label, value) { const input = control(instance.tree, label); assert(input, label); input.props.onChange({ target: { value } }); instance.render(); },
    click(label) { const target = button(instance.tree, label); assert(target, label); target.props.onClick(); instance.render(); },
    async submit() { find(instance.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await tick(); instance.render(); },
    saved(settings, version = 2) { instance.render({ initial: structuredClone(settings), state: stateWith(settings, version) }); },
  });
}

function navigationHarness({ actor = owner, hash = '#ai-settings', responses = [] } = {}) {
  const requests = [], confirmations = [], listeners = new Map();
  let confirmation = false;
  const location = { hash, pathname: '/painel', search: '', href: `https://example.invalid/painel${hash}` };
  const history = (_, unused, url) => { const next = new URL(url, location.href); Object.assign(location, { hash: next.hash, href: next.href, pathname: next.pathname, search: next.search }); };
  const window = {
    location, history: { pushState: history, replaceState: history },
    confirm(message) { confirmations.push(message); return confirmation; },
    addEventListener(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    setTimeout() { return 1; }, clearTimeout() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}, scrollTo() {},
  };
  const document = { visibilityState: 'visible', body: { style: { overflow: '' } }, activeElement: null, addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };
  const nav = hooksHarness(clientFile, 'default', { initialState: stateWith(initial), actor, mode: 'live', integrated: true }, {
    window, document,
    fetch: async (url, options) => {
      requests.push({ url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response() : response || { ok: true, status: 200, json: async () => ({ state: stateWith(initial) }) };
    },
  });
  return Object.assign(nav, {
    requests, confirmations, location,
    confirm(value) { confirmation = value; },
    settings() { return find(nav.tree, node => node.type?.name === 'AISettings'); },
    click(label) { const target = button(nav.tree, label); assert(target, label); target.props.onClick(); nav.render(); },
    dispatch(name, event = {}) { for (const listener of [...(listeners.get(name) || [])]) listener(event); nav.render(); return event; },
    hash(value) { location.hash = value; this.dispatch('hashchange'); },
  });
}

async function run() {
  const Component = pure.load(formFile).default;
  const props = { state: stateWith(initial), isAdmin: true, busy: false, preview: true, execute: async () => { throw Error('SSR must not save'); }, onDirtyChange() {} };
  const html = renderToStaticMarkup(React.createElement(Component, props));
  assert(html.includes('Um assistente com o jeito da sua imobiliária.'));
  assert(html.includes('Venda de imóveis') && html.includes('Locação de imóveis'));
  assert(html.includes('Sem envio') && html.includes('sem consultar a IA ou consumir créditos'));
  assert(!html.includes('type="password"') && !html.includes('OPENAI_API_KEY'));
  const privateConfig = { ...initial, businessSummary: 'INTERNAL_SYNTHETIC_CONTEXT' };
  const brokerHtml = renderToStaticMarkup(React.createElement(Component, { ...props, isAdmin: false, state: stateWith(privateConfig) }));
  assert(brokerHtml.includes('Acesso exclusivo do administrador'));
  assert(!brokerHtml.includes('INTERNAL_SYNTHETIC_CONTEXT') && !brokerHtml.includes('<form'));
  const malformed = renderToStaticMarkup(React.createElement(Component, { ...props, state: { ...baseState, settings: { ...baseState.settings, ai: null } } }));
  assert(malformed.includes('Não foi possível validar') && !malformed.includes('<form'));

  const draft = formHarness({ settings: { ...initial, assistantName: 'Assistente salvo' } });
  draft.change('Nome do assistente', 'Rascunho local');
  assert.equal(draft.dirty.at(-1), true);
  assert.equal(draft.props.state.settings.ai.assistantName, 'Assistente salvo');
  draft.click('Descartar ajustes');
  assert.equal(control(draft.tree, 'Nome do assistente').props.value, 'Rascunho local', 'Declined discard preserves draft');
  draft.confirm(true); draft.click('Descartar ajustes');
  assert.equal(control(draft.tree, 'Nome do assistente').props.value, 'Assistente salvo');
  assert.equal(draft.dirty.at(-1), false);
  draft.click('Carregar opções padrão');
  assert.equal(control(draft.tree, 'Nome do assistente').props.value, initial.assistantName);
  assert.equal(draft.commands.length, 0, 'Loading defaults is only a draft action');
  draft.click('Descartar ajustes');
  assert.equal(control(draft.tree, 'Nome do assistente').props.value, 'Assistente salvo');

  const failed = formHarness();
  failed.change('Nome do assistente', 'Preservado após falha'); await failed.submit();
  assert.equal(failed.commands.length, 1);
  assert.equal(control(failed.tree, 'Nome do assistente').props.value, 'Preservado após falha');
  assert.equal(failed.dirty.at(-1), true);
  assert(!text(failed.tree).includes('Configuração salva para esta imobiliária'));
  failed.change('Nome do assistente', ''); await failed.submit();
  assert.equal(failed.commands.length, 1, 'Invalid settings never reach execute');

  let complete;
  const success = formHarness({ execute: () => new Promise(resolve => { complete = resolve; }) });
  success.change('Nome do assistente', ' Nome normalizado ');
  await success.submit(); await success.submit();
  assert.equal(success.commands.length, 1, 'In-flight save is guarded even before parent busy propagates');
  const sent = success.commands[0];
  assert.deepEqual(Object.keys(sent), ['type', 'settings']);
  assert.deepEqual(Object.keys(sent.settings), ['ai']);
  assert.equal(sent.settings.ai.assistantName, 'Nome normalizado');
  assert(!('updatedBy' in sent.settings.ai) && !('companyId' in sent.settings.ai));
  complete(true); await tick(); success.saved(sent.settings.ai);
  assert.equal(success.dirty.at(-1), false);
  assert(text(success.tree).includes('Configuração salva para esta imobiliária'));

  const conflict = formHarness();
  conflict.change('Nome do assistente', 'Meu rascunho');
  const concurrent = { ...initial, assistantName: 'Outra versão salva', services: ['Venda'] };
  conflict.saved(concurrent);
  assert(text(conflict.tree).includes('A configuração salva mudou.'));
  assert.equal(control(conflict.tree, 'Nome do assistente').props.value, 'Meu rascunho');
  await conflict.submit(); assert.equal(conflict.commands.length, 0, 'Concurrent configuration requires review before replacement');
  conflict.click('Revisei; manter meus ajustes');
  await conflict.submit(); assert.equal(conflict.commands.length, 1);
  assert.equal(conflict.commands[0].settings.ai.assistantName, 'Meu rascunho');
  conflict.confirm(true); conflict.click('Descartar ajustes');
  assert.equal(control(conflict.tree, 'Nome do assistente').props.value, 'Outra versão salva');

  const nav = navigationHarness();
  assert(nav.settings(), 'Owner can open Configurar IA by hash');
  assert(!find(nav.tree, node => node.props?.className === 'filterBar'));
  nav.settings().props.onDirtyChange(true);
  nav.click('Dashboard'); assert(nav.settings(), 'Declined departure preserves the settings page');
  nav.hash('#dashboard'); assert.equal(nav.location.hash, '#ai-settings', 'Hash/back navigation also respects a dirty draft');
  const unload = { prevented: false, preventDefault() { this.prevented = true; } };
  nav.dispatch('beforeunload', unload); assert.equal(unload.prevented, true);
  nav.confirm(true); nav.click('Dashboard'); assert(!nav.settings());
  nav.hash('#ai-settings'); assert(nav.settings());
  const cleanUnload = { prevented: false, preventDefault() { this.prevented = true; } };
  nav.dispatch('beforeunload', cleanUnload); assert.equal(cleanUnload.prevented, false, 'Confirmed departure clears the discarded draft guard');
  assert.equal(nav.requests.length, 0, 'Editing and navigating drafts does not persist anything');
  const broker = navigationHarness({ actor: { ...owner, role: 'broker' } });
  assert(!broker.settings()); assert.equal(broker.location.hash, '#dashboard');
  const menu = find(broker.tree, node => node.props?.['aria-label'] === 'Opções de Configurações');
  assert(menu); menu.props.onClick(); broker.render();
  assert(!button(broker.tree, 'Configurar IA'), 'Broker menu never exposes admin configuration');

  const updated = stateWith(concurrent, 4);
  const stale = navigationHarness({ responses: [
    { ok: false, status: 409, json: async () => ({ error: 'Versão alterada.' }) },
    { ok: true, status: 200, json: async () => ({ state: updated }) },
  ] });
  assert.equal(await stale.settings().props.execute({ type: 'settings', settings: { ai: initial } }), false);
  stale.render();
  assert.equal(stale.requests[0].body.expectedVersion, 1);
  assert.equal(stale.requests[0].body.expectedSourceRevision, 'synthetic-source');
  assert.equal(stale.settings().props.state.version, 4, '409 refreshes canonical state for explicit draft reconciliation');
  assert(text(stale.tree).includes('Versão alterada.'));

  const statusCalls = [];
  const status = formHarness({ preview: false, dashboardFetch: async url => { statusCalls.push(url); return { ok: true, json: async () => ({ providerConfigured: true, providerTested: false }) }; } });
  await tick(); status.render();
  assert.deepEqual(statusCalls, ['/api/ai/settings']);
  assert(text(status.tree).includes('Provedor configurado · não testado'));
  assert.equal(status.commands.length, 0);
  status.unmount();
  console.log('PASS tenant AI UI: owner SSR, broker redaction/hash/menu, no-send preview/provider status, isolated drafts, discard/defaults, validation, failed/in-flight/successful save, conflict reconciliation/CAS and navigation/unload guards. No network or provider calls.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
