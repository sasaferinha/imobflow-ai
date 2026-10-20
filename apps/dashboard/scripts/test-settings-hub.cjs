const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Real synchronous components, synthetic accounts and controlled hooks.
// Native disclosure semantics are checked separately from DOM presence.
// Layout, focus and actual clipboard permissions remain browser-QA checks.
const root = path.resolve(__dirname, '..');
const hubFile = 'app/evolution/settings-hub.tsx';
const formFile = 'app/evolution/website-settings.tsx';
const clientFile = 'app/evolution/evolution-client.tsx';
const owner = { companyId: '00000000-0000-4000-8000-000000000001', brokerId: '00000000-0000-4000-8000-000000000011', name: 'Gestor sintético', role: 'owner' };
const broker = { ...owner, brokerId: '00000000-0000-4000-8000-000000000012', name: 'Corretor sintético', role: 'broker' };
let unexpectedNetworkCalls = 0;
const forbiddenFetch = () => { unexpectedNetworkCalls++; throw Error('External I/O is forbidden in settings hub tests'); };
function runtime(react = React, environment = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    assert(file.startsWith(root + path.sep), 'Only dashboard-local modules may load');
    if (modules.has(file)) return modules.get(file);
    const mod = { exports: {} };
    modules.set(file, mod.exports);
    let source = fs.readFileSync(file, 'utf8');
    if (relative.replaceAll('\\', '/') === formFile) source += '\nexport { WebsiteSettingsForm };';
    if (relative.replaceAll('\\', '/') === clientFile) source += '\nexport { SettingsView };';
    const output = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(output, {
      module: mod, exports: mod.exports, crypto, structuredClone, URL, Date, Intl, Error, console, process, AbortController,
      fetch: forbiddenFetch,
      require(id) {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        if (id === '@/lib/dashboard-transport') return { isProductDemo: () => false, dashboardFetch: forbiddenFetch };
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
const config = pure.load('lib/evolution/website-settings.ts');
const model = pure.load('lib/evolution/model.ts');
const initial = structuredClone(config.getWebsiteSettings());
const configured = { url: 'https://www.example.org/imoveis', provider: 'Fornecedor sintético', syncScope: 'full' };
const baseState = model.emptyState(owner.companyId);
baseState.members = [owner, broker].map(actor => ({ id: actor.brokerId, name: actor.name, role: actor.role, specialization: 'Ambos' }));
baseState.sourceRevision = 'synthetic-source';
const stateWith = (settings = initial, version = 1) => ({ ...structuredClone(baseState), version, settings: {
  ...structuredClone(baseState.settings), website: { ...structuredClone(settings), updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: owner.brokerId },
} });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim() === label);
const control = (tree, label) => find(find(tree, node => node.type === 'label' && text(node).startsWith(label)), node => ['input', 'select', 'textarea'].includes(node.type));
function visibleNodes(tree, openedDetails = new Set()) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(node => visibleNodes(node, openedDetails));
  if (tree.type === 'details' && !tree.props.open && !openedDetails.has(text(React.Children.toArray(tree.props.children).find(child => child.type === 'summary')))) {
    return [tree, ...visibleNodes(React.Children.toArray(tree.props.children).find(child => child.type === 'summary'), openedDetails)];
  }
  return [tree, ...visibleNodes(tree.props?.children, openedDetails)];
}
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
    useId() { const index = cursor++; return (slots[index] || (slots[index] = { value: `test-id-${index}` })).value; },
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

function formHarness({ settings = initial, execute, clipboard } = {}) {
  const commands = [], dirty = [], confirmations = [], copied = [];
  const openedDetails = new Set();
  let confirmation = false;
  const instance = hooksHarness(formFile, 'WebsiteSettingsForm', {
    initial: structuredClone(settings), state: stateWith(settings), isAdmin: true, busy: false,
    execute: async command => { commands.push(structuredClone(command)); return execute ? execute(command) : false; },
    onDirtyChange: value => dirty.push(value),
  }, {
    window: { confirm: message => { confirmations.push(message); return confirmation; } },
    navigator: { clipboard: { async writeText(value) { copied.push(value); if (clipboard) await clipboard(value); } } },
  });
  return Object.assign(instance, {
    commands, dirty, confirmations, copied,
    confirm(value) { confirmation = value; },
    openSupplier() {
      const disclosure = find(instance.tree, node => node.type === 'details');
      assert(disclosure, 'Supplier message disclosure exists');
      openedDetails.add(text(React.Children.toArray(disclosure.props.children).find(child => child.type === 'summary')));
    },
    visible() { return visibleNodes(instance.tree, openedDetails); },
    change(label, value) { const input = control(instance.tree, label); assert(input, label); input.props.onChange({ target: { value } }); instance.render(); },
    click(label) { const target = visibleNodes(instance.tree, openedDetails).find(node => node.type === 'button' && text(node).trim() === label); assert(target, `Visible button: ${label}`); target.props.onClick(); instance.render(); },
    async submit() { find(instance.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await tick(); instance.render(); },
    saved(settings, version = 2) { instance.render({ initial: structuredClone(settings), state: stateWith(settings, version) }); },
  });
}

function navigationHarness({ actor = owner, hash = '#settings', settings = initial, responses = [], integrated = true, mode = 'live' } = {}) {
  const requests = [], confirmations = [], listeners = new Map(), renderedOperational = [];
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
  const nav = hooksHarness(clientFile, 'default', {
    initialState: stateWith(settings), actor, mode, integrated,
    renderOperationalPanel: page => { renderedOperational.push(page); return React.createElement('div', { 'data-operational-test': page }); },
  }, {
    window, document,
    fetch: async (url, options) => {
      assert.equal(url, '/api/evolution', 'Navigation/save can only use the synthetic CRM transport');
      requests.push({ url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return typeof response === 'function' ? response() : response || { ok: true, status: 200, json: async () => ({ state: stateWith(settings) }) };
    },
  });
  return Object.assign(nav, {
    requests, confirmations, location, renderedOperational,
    confirm(value) { confirmation = value; },
    component(name) { return find(nav.tree, node => node.type?.name === name); },
    click(label) { const target = button(nav.tree, label); assert(target, label); target.props.onClick(); nav.render(); },
    dispatch(name, event = {}) { for (const listener of [...(listeners.get(name) || [])]) listener(event); nav.render(); return event; },
    hash(value, event = 'hashchange') { location.hash = value; this.dispatch(event); },
  });
}

async function run() {
  const Hub = pure.load(hubFile).default;
  const Website = pure.load(formFile).default;
  const actions = [];
  const hubProps = { state: stateWith(), isAdmin: true, integrated: true,
    onWhatsApp: () => actions.push('whatsapp'), onAI: () => actions.push('ai'), onWebsite: () => actions.push('website'), onTeam: () => actions.push('team'),
    children: React.createElement('p', { 'data-advanced-test': true }, 'INTERNAL_ADVANCED_OPTIONS'),
  };
  const hubHtml = renderToStaticMarkup(React.createElement(Hub, hubProps));
  for (const label of ['WhatsApp da empresa', 'IA de atendimento', 'Site da imobiliária', 'Somente administrador', 'Regras e opções da operação']) assert(hubHtml.includes(label), label);
  assert.equal([...hubHtml.matchAll(/<details\b[^>]*>/g)].length, 1);
  assert(!/<details\b[^>]*\sopen(?:=|\s|>)/.test(hubHtml), 'Advanced operations start closed');
  assert(hubHtml.includes('INTERNAL_ADVANCED_OPTIONS'), 'Existing operation forms remain mounted');
  assert(!visibleNodes(Hub(hubProps)).some(node => node.props?.['data-advanced-test']), 'Mounted advanced options are not initially visible');
  assert(hubHtml.includes('Integração ainda não ativa'));
  assert(hubHtml.includes('Salvar preferências não confirma o funcionamento do provedor de IA'));
  assert(!/\b(?:Site conectado|Sincronização ativa|IA funcionando|WhatsApp conectado)\b/i.test(hubHtml));
  const savedHubHtml = renderToStaticMarkup(React.createElement(Hub, { ...hubProps, state: stateWith(configured) }));
  assert(savedHubHtml.includes('Aguardando integração') && savedHubHtml.includes('Ver preparação do site'));
  const privateSettingsState = stateWith({ ...configured, provider: 'PRIVATE_PROVIDER_SENTINEL' });
  privateSettingsState.settings.sources = ['PRIVATE_SOURCE_SENTINEL'];
  privateSettingsState.settings.ai = { assistantName: 'PRIVATE_AI_SENTINEL' };
  const accountActions = [];
  const accountButton = tree => find(tree, node => node.type === 'button' && /^Minha conta(?:\s*→)?$/.test(text(node).trim()));
  const brokerHubProps = { ...hubProps, state: privateSettingsState, isAdmin: false, onAccount: () => accountActions.push('account') };
  const brokerHub = renderToStaticMarkup(React.createElement(Hub, brokerHubProps));
  assert(brokerHub.includes('Acesso exclusivo do administrador'));
  assert(brokerHub.includes('conta de corretor'), 'The informative page explains the current account role');
  assert(/nome/i.test(brokerHub) && /(?:sair|saia)/i.test(brokerHub) && /(?:outra conta|trocar.*conta|conta de administrador)/i.test(brokerHub),
    'The broker is told how to leave the current account through the name menu and use another account');
  assert(!/<(?:form|input|select|textarea|iframe)\b/.test(brokerHub), 'The broker settings page has no administrative forms or connection widgets');
  for (const forbidden of ['INTERNAL_ADVANCED_OPTIONS', 'Configurar WhatsApp', 'Configurar IA', 'Preparar conexão do site',
    'Corretores e acessos', 'PRIVATE_PROVIDER_SENTINEL', 'PRIVATE_SOURCE_SENTINEL', 'PRIVATE_AI_SENTINEL', configured.url, 'Editar perfil']) {
    assert(!brokerHub.includes(forbidden), `Broker settings must not expose or open ${forbidden}`);
  }
  assert(accountButton(Hub(brokerHubProps)), 'The integrated informational page offers an explicit account action');
  assert.deepEqual(accountActions, [], 'Rendering the broker page never opens account/profile automatically');
  accountButton(Hub(brokerHubProps)).props.onClick();
  assert.deepEqual(accountActions, ['account'], 'Only the explicit Minha conta action opens the account');
  assert(!accountButton(Hub({ ...brokerHubProps, integrated: false })), 'Preview/non-integrated settings cannot open the live account');
  assert(!accountButton(Hub({ ...brokerHubProps, onAccount: undefined })), 'No inert account action is shown without a callback');
  assert.deepEqual(actions, [], 'Rendering must not activate any connection or callback');
  const hubTree = Hub(hubProps);
  for (const label of ['Configurar WhatsApp →', 'Configurar IA →', 'Preparar conexão do site →', 'Corretores e acessos →']) {
    const target = button(hubTree, label); assert(target, label); target.props.onClick();
  }
  assert.deepEqual(actions, ['whatsapp', 'ai', 'website', 'team']);
  const previewHub = Hub({ ...hubProps, integrated: false });
  assert.equal(button(previewHub, 'Configurar WhatsApp →').props.disabled, true);
  assert(!button(previewHub, 'Corretores e acessos →'));
  const SettingsView = pure.load(clientFile).SettingsView;
  const settingsProps = { ...hubProps, busy: false, onIntegrations: hubProps.onWhatsApp,
    execute: async () => { throw Error('Rendering existing operation forms must not save'); } };
  const fullHub = renderToStaticMarkup(React.createElement(SettingsView, settingsProps));
  assert(fullHub.includes('Salvar regras da operação') && fullHub.includes('Salvar prazos') && fullHub.includes('Salvar opções'), 'Actual legacy operation forms are preserved inside the new hub');
  assert(!/<details\b[^>]*\sopen(?:=|\s|>)/.test(fullHub));
  const initiallyVisibleHub = fullHub.replace(/<details\b[\s\S]*?<\/details>/g, '');
  assert(!initiallyVisibleHub.includes('<form') && !initiallyVisibleHub.includes('Salvar prazos'), 'All old forms remain below the closed advanced disclosure');
  assert(initiallyVisibleHub.includes('Configurar WhatsApp') && initiallyVisibleHub.includes('Configurar IA') && initiallyVisibleHub.includes('Preparar conexão do site'));
  const fullBrokerProps = { ...settingsProps, state: privateSettingsState, isAdmin: false, onAccount: () => accountActions.push('settings-account') };
  const fullBrokerHub = renderToStaticMarkup(React.createElement(SettingsView, fullBrokerProps));
  assert(fullBrokerHub.includes('Acesso exclusivo do administrador') && fullBrokerHub.includes('conta de corretor') && !fullBrokerHub.includes('<form'));
  for (const forbidden of ['PRIVATE_PROVIDER_SENTINEL', 'PRIVATE_SOURCE_SENTINEL', 'PRIVATE_AI_SENTINEL', configured.url, 'Editar perfil']) {
    assert(!fullBrokerHub.includes(forbidden), `The real SettingsView does not expose ${forbidden} to brokers`);
  }
  const brokerView = hooksHarness(clientFile, 'SettingsView', fullBrokerProps);
  const forwardedHub = find(brokerView.tree, node => node.type?.name === 'SettingsHub');
  assert(forwardedHub && typeof forwardedHub.props.onAccount === 'function', 'SettingsView forwards the optional explicit account callback');
  assert.deepEqual(accountActions, ['account'], 'Neither SSR nor hook rendering navigates to the account');
  accountButton(Hub(forwardedHub.props)).props.onClick();
  assert.deepEqual(accountActions, ['account', 'settings-account']);
  brokerView.unmount();

  const websiteProps = { state: stateWith(), isAdmin: true, busy: false, execute: async () => { throw Error('SSR must not save'); }, onDirtyChange() {} };
  const websiteHtml = renderToStaticMarkup(React.createElement(Website, websiteProps));
  assert(websiteHtml.includes('Integração ainda não ativa') && websiteHtml.includes('Ainda não publica, atualiza ou retira anúncios'));
  assert(websiteHtml.includes('Se não souber, pode deixar em branco'));
  assert(websiteHtml.includes('A ImobFlow não entra em contato com o fornecedor por esta tela'));
  assert(!/<details\b[^>]*\sopen(?:=|\s|>)/.test(websiteHtml), 'Supplier message starts closed');
  assert(!/type="password"|api[_-]?key|access[_-]?token|<iframe|<img|<script|href=/.test(websiteHtml), 'Preparation has no credentials, site probes or external links');
  const websiteBroker = renderToStaticMarkup(React.createElement(Website, { ...websiteProps, isAdmin: false, state: stateWith({ ...configured, provider: 'PRIVATE_PROVIDER_SENTINEL' }) }));
  assert(websiteBroker.includes('Acesso exclusivo do administrador') && !websiteBroker.includes('<form') && !websiteBroker.includes('PRIVATE_PROVIDER_SENTINEL'));
  const escaped = renderToStaticMarkup(React.createElement(Website, { ...websiteProps, state: stateWith({ ...configured, provider: '"><script>alert(1)</script>' }) }));
  assert(!escaped.includes('<script>') && escaped.includes('&lt;script&gt;'), 'Supplier labels are escaped, never interpreted as HTML');
  const malformed = renderToStaticMarkup(React.createElement(Website, { ...websiteProps, state: { ...baseState, settings: { ...baseState.settings, website: null } } }));
  assert(malformed.includes('Não foi possível validar') && !malformed.includes('<form'));
  const legacy = renderToStaticMarkup(React.createElement(Website, { ...websiteProps, state: baseState }));
  assert(legacy.includes('Integração ainda não ativa'), 'Legacy companies need no migration/default write');

  const draft = formHarness({ settings: configured });
  assert.equal(find(draft.tree, node => node.type === 'form').props.noValidate, true);
  assert.equal(button(draft.tree, 'Salvar dados do site').props.disabled, true);
  assert(!control(draft.tree, 'Quem fez ou cuida do site?').props.required, 'Unknown supplier does not block preparation');
  assert.equal(control(draft.tree, 'Endereço do site').props.maxLength, 1024);
  assert.equal(control(draft.tree, 'Quem fez ou cuida do site?').props.maxLength, 100);
  assert.equal(control(draft.tree, 'Mensagem para copiar').props.readOnly, true);
  assert(!visibleNodes(draft.tree).includes(control(draft.tree, 'Mensagem para copiar')));
  assert.deepEqual(draft.copied, []);
  draft.change('Endereço do site', 'https://draft.example.org/imoveis');
  draft.change('Quem fez ou cuida do site?', '');
  assert.equal(draft.dirty.at(-1), true);
  assert.equal(draft.props.state.settings.website.url, configured.url, 'Editing never mutates canonical settings');
  assert(control(draft.tree, 'Mensagem para copiar').props.value.includes('https://draft.example.org/imoveis'), 'Supplier message uses the current unsaved draft');
  draft.openSupplier();
  assert(draft.visible().includes(control(draft.tree, 'Mensagem para copiar')));
  draft.click('Copiar mensagem'); await tick(); draft.render();
  assert.equal(draft.copied.length, 1);
  assert.equal(draft.copied[0], control(draft.tree, 'Mensagem para copiar').props.value);
  assert(draft.copied[0].includes('retirar anúncios vendidos, alugados, desativados ou excluídos'));
  assert(draft.copied[0].includes('Não enviem senhas ou tokens'));
  assert(text(draft.tree).includes('Mensagem copiada. Nenhuma mensagem foi enviada.'));
  assert.equal(draft.commands.length, 0, 'Copying is local and never saves or sends');
  assert.equal(draft.dirty.at(-1), true, 'Copying does not mark an unsaved draft as saved');
  draft.click('Descartar ajustes');
  assert.equal(control(draft.tree, 'Endereço do site').props.value, 'https://draft.example.org/imoveis', 'Declining discard preserves changes');
  draft.confirm(true); draft.click('Descartar ajustes');
  assert.equal(control(draft.tree, 'Endereço do site').props.value, configured.url);
  assert.equal(draft.dirty.at(-1), false);
  assert(!text(draft.tree).includes('Mensagem copiada.'));
  const copyFailed = formHarness({ clipboard: async () => { throw Error('synthetic clipboard denial'); } });
  copyFailed.openSupplier();
  copyFailed.click('Copiar mensagem'); await tick(); copyFailed.render();
  assert(text(copyFailed.tree).includes('Selecione e copie o texto abaixo'));
  assert(!text(copyFailed.tree).includes('Mensagem copiada.'));
  assert.equal(copyFailed.commands.length, 0);
  const safeCopy = formHarness();
  safeCopy.openSupplier();
  for (const url of [
    'https://private-user:PRIVATE_PASSWORD@example.org',
    'https://example.org/login?token=PRIVATE_TOKEN',
    'https://example.org/#PRIVATE_FRAGMENT',
    'https://localhost/private',
  ]) {
    safeCopy.change('Endereço do site', url);
    assert(!text(safeCopy.tree).includes('Mensagem copiada.'), 'Editing clears stale clipboard success feedback');
    const message = control(safeCopy.tree, 'Mensagem para copiar').props.value;
    assert(!message.includes(url) && !/PRIVATE_|private-user|localhost/.test(message), 'Even the readonly message omits an unsafe unsaved access URL');
    safeCopy.click('Copiar mensagem'); await tick(); safeCopy.render();
    assert.equal(safeCopy.copied.at(-1), message);
    assert.equal(control(safeCopy.tree, 'Endereço do site').props.value, url, 'Omitting unsafe clipboard data never silently rewrites the editable draft');
  }
  safeCopy.change('Endereço do site', ' HTTPS://WWW.EXAMPLE.ORG:443 ');
  safeCopy.click('Copiar mensagem'); await tick(); safeCopy.render();
  assert(safeCopy.copied.at(-1).includes('https://www.example.org/'), 'Safe copied URLs use validated normalization');
  assert.equal(safeCopy.commands.length, 0, 'Supplier copy never persists or contacts a provider');

  const invalid = formHarness();
  for (const url of ['http://example.org', 'https://localhost', 'https://user:secret@example.org', 'https://example.org?token=secret']) {
    invalid.change('Endereço do site', url); await invalid.submit();
    assert(find(invalid.tree, node => node.props?.role === 'alert'), url);
    assert.equal(control(invalid.tree, 'Endereço do site').props.value, url, 'Rejected input stays available for correction');
  }
  invalid.change('Endereço do site', ''); invalid.change('Quem fez ou cuida do site?', 'Fornecedor sem URL'); await invalid.submit();
  assert(text(invalid.tree).includes('Informe o endereço do site'));
  assert.equal(invalid.commands.length, 0, 'Invalid data never reaches persistence');
  invalid.change('Endereço do site', 'https://www.example.org'); invalid.change('Quem fez ou cuida do site?', 'x'.repeat(101)); await invalid.submit();
  assert.equal(invalid.commands.length, 0);

  const failed = formHarness();
  failed.change('Endereço do site', configured.url); await failed.submit();
  assert.equal(failed.commands.length, 1);
  assert.equal(control(failed.tree, 'Endereço do site').props.value, configured.url);
  assert.equal(failed.dirty.at(-1), true);
  assert(!text(failed.tree).includes('Dados do site salvos'));
  assert(!text(failed.tree).includes('Mensagem copiada'));
  let complete;
  const success = formHarness({ execute: () => new Promise(resolve => { complete = resolve; }) });
  success.change('Endereço do site', ' HTTPS://WWW.EXAMPLE.ORG:443 ');
  await success.submit(); await success.submit();
  assert.equal(success.commands.length, 1, 'In-flight duplicate submissions are suppressed');
  assert.deepEqual(success.commands[0], { type: 'settings', settings: { website: { url: 'https://www.example.org/', provider: '', syncScope: 'full' } } });
  success.render({ busy: true });
  assert.equal(find(success.tree, node => node.type === 'fieldset').props.disabled, true);
  assert.equal(button(success.tree, 'Salvando…').props.disabled, true);
  success.confirm(true); success.click('Descartar ajustes');
  assert.equal(control(success.tree, 'Endereço do site').props.value, ' HTTPS://WWW.EXAMPLE.ORG:443 ', 'Saving cannot discard the in-flight draft');
  complete(true); await tick();
  success.render({ busy: false }); success.saved(success.commands[0].settings.website);
  assert.equal(success.dirty.at(-1), false);
  assert.equal(control(success.tree, 'Endereço do site').props.value, 'https://www.example.org/');
  assert(text(success.tree).includes('Dados do site salvos. A integração continua pendente; nenhum imóvel foi enviado.'));
  assert(text(success.tree).includes('Aguardando integração'));
  assert(!/Site conectado|Sincronização ativa|Anúncios publicados/.test(text(success.tree)));
  const clear = formHarness({ settings: configured, execute: async () => true });
  clear.change('Endereço do site', ''); clear.change('Quem fez ou cuida do site?', ''); await clear.submit();
  clear.saved(initial);
  assert.deepEqual(clear.commands[0].settings.website, initial);
  assert(text(clear.tree).includes('Dados de preparação removidos. Nenhum anúncio externo foi alterado.'));
  assert(text(clear.tree).includes('Integração ainda não ativa'));

  const concurrent = { url: 'https://new.example.org/', provider: 'Outro fornecedor', syncScope: 'full' };
  const conflict = formHarness({ settings: configured });
  conflict.change('Quem fez ou cuida do site?', 'Meu rascunho');
  conflict.saved(concurrent);
  assert(text(conflict.tree).includes('Os dados salvos mudaram em outra sessão.'));
  assert.equal(control(conflict.tree, 'Quem fez ou cuida do site?').props.value, 'Meu rascunho');
  assert.equal(button(conflict.tree, 'Salvar dados do site').props.disabled, true);
  await conflict.submit(); assert.equal(conflict.commands.length, 0);
  conflict.click('Carregar dados salvos');
  assert.equal(control(conflict.tree, 'Quem fez ou cuida do site?').props.value, 'Meu rascunho', 'Loading canonical state still asks before discarding a dirty draft');
  conflict.click('Revisei; manter meus dados'); await conflict.submit();
  assert.equal(conflict.commands.length, 1);
  assert.equal(conflict.commands[0].settings.website.provider, 'Meu rascunho');
  conflict.confirm(true); conflict.click('Descartar ajustes');
  assert.equal(control(conflict.tree, 'Endereço do site').props.value, concurrent.url);
  assert.equal(conflict.dirty.at(-1), false);

  const nav = navigationHarness();
  assert(nav.component('SettingsView'), 'Owner hash opens the central settings hub');
  assert.equal(nav.requests.length, 0, 'Opening the hub does not consult WhatsApp, AI or a supplier');
  nav.component('SettingsView').props.onWebsite(); nav.render();
  assert(nav.component('WebsiteSettings') && nav.location.hash === '#website-settings');
  assert(!find(nav.tree, node => node.props?.className === 'filterBar'));
  nav.component('WebsiteSettings').props.onDirtyChange(true);
  nav.click('← Voltar às configurações'); assert(nav.component('WebsiteSettings'));
  nav.hash('#settings'); assert.equal(nav.location.hash, '#website-settings', 'Hash navigation respects draft protection');
  nav.hash('#settings', 'popstate'); assert.equal(nav.location.hash, '#website-settings', 'Browser back respects draft protection');
  const unload = { prevented: false, preventDefault() { this.prevented = true; } };
  nav.dispatch('beforeunload', unload); assert.equal(unload.prevented, true);
  nav.confirm(true); nav.click('← Voltar às configurações'); assert(nav.component('SettingsView'));
  const cleanUnload = { prevented: false, preventDefault() { this.prevented = true; } };
  nav.dispatch('beforeunload', cleanUnload); assert.equal(cleanUnload.prevented, false);
  nav.component('SettingsView').props.onAI(); nav.render(); assert(nav.component('AISettings'));
  nav.click('← Voltar às configurações'); assert(nav.component('SettingsView'));
  assert.equal(nav.requests.length, 0, 'Local navigation and discarded drafts make no requests');
  nav.component('SettingsView').props.onIntegrations(); nav.render();
  assert.equal(nav.location.hash, '#integrations');
  assert(nav.renderedOperational.includes('integrations'), 'WhatsApp shortcut uses the existing operational integration panel');
  const teamNav = navigationHarness();
  teamNav.component('SettingsView').props.onTeam(); teamNav.render();
  assert.equal(teamNav.location.hash, '#brokers');

  // Regression: the main Configurações button used to route brokers to
  // #account, whose legacy panel immediately opened Editar perfil.
  for (const actor of [owner, broker]) {
    const mainClick = navigationHarness({ actor, hash: '#dashboard', settings: configured });
    assert.equal(mainClick.renderedOperational.length, 0);
    mainClick.click('Configurações');
    assert.equal(mainClick.location.hash, '#settings', `${actor.role}: the visible settings label has a settings destination`);
    assert(mainClick.component('SettingsView'));
    assert.equal(mainClick.component('SettingsView').props.isAdmin, actor.role === 'owner');
    assert.equal(text(find(mainClick.tree, node => node.type === 'h1')), 'Configurações');
    assert.equal(mainClick.renderedOperational.length, 0, 'Opening settings must not mount a legacy account/profile panel');
    assert.equal(mainClick.requests.length, 0, 'Opening settings makes no read or mutation request');
    mainClick.click('Relatórios');
    mainClick.hash('#settings', 'popstate');
    assert(mainClick.component('SettingsView') && mainClick.location.hash === '#settings', 'Browser Back returns to settings without a profile fallback');
    mainClick.hash('#dashboard');
    mainClick.hash('#settings');
    assert(mainClick.component('SettingsView') && mainClick.location.hash === '#settings', 'Direct hash navigation keeps the settings page');
    assert.equal(mainClick.renderedOperational.length, 0);
    assert.equal(mainClick.requests.length, 0, 'Settings/hash/history navigation never saves or probes an integration');
    mainClick.unmount();

    const reloaded = navigationHarness({ actor, hash: '#settings', settings: configured });
    assert(reloaded.component('SettingsView') && reloaded.location.hash === '#settings', 'A fresh load of #settings works for both roles');
    assert.equal(reloaded.renderedOperational.length, 0, 'Reloading settings does not open the account');
    assert.equal(reloaded.requests.length, 0);
    if (actor.role === 'broker') {
      const viewProps = reloaded.component('SettingsView').props;
      const accountView = hooksHarness(clientFile, 'SettingsView', viewProps);
      const hub = find(accountView.tree, node => node.type?.name === 'SettingsHub');
      assert(hub && hub.props.isAdmin === false);
      const restrictedHtml = renderToStaticMarkup(React.createElement(Hub, hub.props));
      assert(restrictedHtml.includes('conta de corretor') && !restrictedHtml.includes('<form'));
      assert(!restrictedHtml.includes(configured.url) && !restrictedHtml.includes('Editar perfil'));
      const openAccount = accountButton(Hub(hub.props));
      assert(openAccount, 'The broker can explicitly choose Minha conta from settings');
      assert.equal(reloaded.renderedOperational.length, 0, 'Even rendering the full broker hub does not mount the account');
      assert.equal(reloaded.requests.length, 0);
      openAccount.props.onClick(); reloaded.render();
      assert.equal(reloaded.location.hash, '#account');
      assert(reloaded.renderedOperational.includes('account'), 'The account panel mounts only after the explicit account action');
      assert.equal(reloaded.requests.length, 0, 'Explicit local account navigation itself performs no settings mutation');
      accountView.unmount();
    }
    reloaded.unmount();
  }

  for (const protectedHash of ['#website-settings', '#ai-settings']) {
    const denied = navigationHarness({ actor: broker, hash: protectedHash, settings: configured });
    assert.equal(denied.location.hash, '#dashboard', protectedHash);
    assert(!denied.component('SettingsView') && !denied.component('WebsiteSettings') && !denied.component('AISettings'));
    const menu = find(denied.tree, node => node.props?.['aria-label'] === 'Opções de Configurações');
    assert(menu); menu.props.onClick(); denied.render();
    assert(!button(denied.tree, 'Site da imobiliária') && !button(denied.tree, 'Configurar IA'));
    denied.hash(protectedHash); assert.equal(denied.location.hash, '#dashboard');
    assert.equal(denied.requests.length, 0, 'Denied settings hashes do not fetch configuration');
    denied.unmount();
  }
  const previewNav = navigationHarness({ mode: 'preview', integrated: false });
  assert.equal(previewNav.component('SettingsView').props.integrated, false);
  previewNav.component('SettingsView').props.onIntegrations(); previewNav.render();
  assert(previewNav.component('SettingsView'), 'Preview cannot activate the live WhatsApp screen');

  const updated = stateWith(concurrent, 4);
  const stale = navigationHarness({ hash: '#website-settings', settings: configured, responses: [
    { ok: false, status: 409, json: async () => ({ error: 'Versão alterada.' }) },
    { ok: true, status: 200, json: async () => ({ state: updated }) },
  ] });
  const staleForm = formHarness({ settings: configured, execute: command => stale.component('WebsiteSettings').props.execute(command) });
  staleForm.change('Quem fez ou cuida do site?', 'Rascunho após 409'); await staleForm.submit(); stale.render();
  assert.deepEqual(stale.requests.map(request => request.method), ['POST', 'GET']);
  assert.equal(stale.requests[0].body.expectedVersion, 1);
  assert.equal(stale.requests[0].body.expectedSourceRevision, 'synthetic-source');
  assert.equal(stale.component('WebsiteSettings').props.state.version, 4);
  staleForm.saved(config.getWebsiteSettings(stale.component('WebsiteSettings').props.state.settings.website), 4);
  assert.equal(control(staleForm.tree, 'Quem fez ou cuida do site?').props.value, 'Rascunho após 409');
  assert(text(staleForm.tree).includes('Os dados salvos mudaram em outra sessão.'));
  assert(text(stale.tree).includes('Versão alterada.'));
  const transportFailure = navigationHarness({ hash: '#website-settings', responses: [new Error('Falha sintética de conexão.')] });
  assert.equal(await transportFailure.component('WebsiteSettings').props.execute({ type: 'settings', settings: { website: configured } }), false);
  transportFailure.render(); assert(text(transportFailure.tree).includes('Falha sintética de conexão.'));
  assert.equal(transportFailure.component('WebsiteSettings').props.state.settings.website.url, '');

  let finishSave;
  const savingNav = navigationHarness({ hash: '#website-settings', responses: [() => new Promise(resolve => { finishSave = resolve; })] });
  const pendingSave = savingNav.component('WebsiteSettings').props.execute({ type: 'settings', settings: { website: configured } });
  savingNav.render(); assert.equal(savingNav.component('WebsiteSettings').props.busy, true);
  savingNav.confirm(true); savingNav.click('← Voltar às configurações');
  assert(savingNav.component('WebsiteSettings'), 'Even confirmed navigation cannot leave an in-flight save');
  const savingUnload = { prevented: false, preventDefault() { this.prevented = true; } };
  savingNav.dispatch('beforeunload', savingUnload); assert.equal(savingUnload.prevented, true);
  finishSave({ ok: true, status: 200, json: async () => ({ state: stateWith(configured, 2) }) });
  assert.equal(await pendingSave, true); savingNav.render();
  assert.equal(savingNav.component('WebsiteSettings').props.state.version, 2);
  assert.equal(savingNav.requests.length, 1);
  assert.equal(unexpectedNetworkCalls, 0, 'No swallowed provider/site request may be hidden by a catch');
  console.log('PASS settings hub UI: admin/broker SSR, truthful settings navigation and explicit account action, broker explanation without private settings/forms, direct hash/back/reload, protected AI/site routes, closed advanced/supplier disclosures, truthful pending status, existing WhatsApp navigation, no automatic I/O, isolated drafts, optional supplier, local clipboard success/failure, URL validation, save failure/success/clear, duplicate suppression, CAS conflict review and navigation/unload protection. Synthetic data/transports only; no supplier, Meta or paid AI calls.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
