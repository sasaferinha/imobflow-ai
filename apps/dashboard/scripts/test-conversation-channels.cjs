const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Real channel/workspace components and reducer, synthetic I/O and controlled
// hooks. Layout, native dialog focus and touch interaction need browser QA.
const root = path.resolve(__dirname, '..');
const centerFile = 'app/conversation-center.tsx';
const channelsFile = 'app/conversation-channels.tsx';
const instagramFile = 'app/instagram-conversations.tsx';
let forbiddenCalls = 0;
function forbiddenFetch() { forbiddenCalls++; throw Error('External I/O is forbidden in conversation channel tests'); }
const leafNames = {
  './conversation-registration': 'ConversationRegistration',
  './conversation-assistant': 'ConversationAssistant',
  './conversation-alerts': 'ConversationAlerts',
  './conversation-urgent-alert': 'ConversationUrgentAlert',
  './browser-push-settings': 'BrowserPushSettings',
  './conversation-settings': 'ConversationSettings',
  './conversation-whatsapp-handoff': 'ConversationWhatsAppHandoff',
};
function runtime(react = React, environment = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    assert(file.startsWith(root + path.sep), 'Only dashboard-local modules may load');
    if (modules.has(file)) return modules.get(file);
    const mod = { exports: {} };
    modules.set(file, mod.exports);
    let source = fs.readFileSync(file, 'utf8');
    if (relative.replaceAll('\\', '/') === centerFile) source += '\nexport { ConversationWorkspace };';
    const output = ts.transpileModule(source, { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(output, {
      module: mod, exports: mod.exports, structuredClone, URL, Date, Intl, Error, console, process, AbortController, queueMicrotask,
      fetch: forbiddenFetch,
      require(id) {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        if (id === '@/lib/dashboard-transport') return {
          dashboardFetch: environment.dashboardFetch || forbiddenFetch,
          isProductDemo: () => Boolean(environment.productDemo),
        };
        if (id === '@/lib/dashboard-sync') return {
          subscribeDashboardSync: environment.subscribe || (() => { throw Error('Unexpected subscription'); }),
          announceDashboardChange: environment.announce || (() => {}),
        };
        if (leafNames[id]) {
          const name = leafNames[id], Leaf = () => null;
          Object.defineProperty(Leaf, 'name', { value: name });
          return { __esModule: true, default: Leaf, [name]: Leaf };
        }
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
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const find = (tree, predicate) => nodes(tree).find(predicate);
const component = (tree, name) => find(tree, node => node.type?.name === name);
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim() === label);
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function hooksHarness(file, exportName, initialProps, environment = {}) {
  let cursor = 0, pending = false, effects = [], tree, props = initialProps, unmounted = false, updatesAfterUnmount = 0;
  const slots = [];
  const differs = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => value !== b[index]);
  const hooks = {
    ...React,
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) {
        const slot = { value: typeof value === 'function' ? value() : value };
        slot.set = update => {
          if (unmounted) { updatesAfterUnmount++; return; }
          const next = typeof update === 'function' ? update(slot.value) : update;
          if (next !== slot.value) { slot.value = next; pending = true; }
        };
        slots[index] = slot;
      }
      return [slots[index].value, slots[index].set];
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
    assert(!unmounted, 'Unmounted components cannot render');
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
  return { render, get tree() { return tree; }, get props() { return props; }, get updatesAfterUnmount() { return updatesAfterUnmount; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); unmounted = true; } };
}
function eventTarget() {
  const events = new Map();
  return {
    addEventListener(name, listener) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); },
    removeEventListener(name, listener) { events.get(name)?.delete(listener); },
    fire(name) { for (const listener of [...(events.get(name) || [])]) listener(); },
    get listenerCount() { return [...events.values()].reduce((sum, listeners) => sum + listeners.size, 0); },
  };
}
const pure = runtime();
const reducer = pure.load('lib/demo-conversations.ts');
const lead = (id, source = 'WhatsApp') => ({
  id, name: `Contato ${id}`, phone: '', email: null, goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro',
  budget: 'A definir', details: null, summary: '', score: 25, scoreDefined: false, temperature: 'Frio', source,
  assignedTo: null, lifecycleStatus: 'Novo', lastContactAt: null, inactivityDays: null, recoveryPotential: 'Baixo',
  scoreReasons: [], recoverySelected: false, createdAt: '2026-10-20T12:00:00.000Z',
});
const leads = [lead('wa'), lead('dm', 'Instagram Direct'), lead('generic', 'Instagram'), lead('ads', 'Facebook Lead Ads'),
  lead('variant', 'instagram direct'), lead('spaced', 'Instagram Direct '), lead('dm2', 'Instagram Direct')];
function conversationProps() {
  let state = reducer.demoConversationReducer(reducer.createLiveConversationState(), { type: 'sync', contacts: leads.map(item => ({ id: `lead-${item.id}` })) });
  state = reducer.demoConversationReducer(state, { type: 'select', id: 'lead-wa' });
  return {
    state, leads, inbox: leads.map(item => ({ leadId: item.id, conversationId: `conversation-${item.id}`, lastMessageId: 'last', lastMessageAt: '2026-10-20T12:00:00Z', lastMessageText: 'Texto sintético', incomingCount: 1, unread: 1 })),
    notify() {}, dispatch() {}, openAgenda() {}, persistMessage: forbiddenFetch, refreshProperties: forbiddenFetch, claimLead: forbiddenFetch,
    currentBrokerName: 'Corretor sintético', currentBrokerId: 'broker-synthetic', demonstration: true, ready: true,
  };
}
function centerHarness(initial = {}) {
  const notices = [], actions = [];
  let dialogOpen = false;
  const base = { ...conversationProps(), ...initial };
  let shared = base.state;
  const dispatch = action => { actions.push(action); shared = reducer.demoConversationReducer(shared, action); };
  const instance = hooksHarness(centerFile, 'default', { ...base, dispatch, notify: message => notices.push(message) }, {
    document: { querySelector: () => dialogOpen ? {} : null },
  });
  return Object.assign(instance, {
    notices, actions, dispatch,
    getState: () => shared,
    update() { instance.render({ state: shared }); },
    select(id) { dispatch({ type: 'select', id: `lead-${id}` }); this.update(); },
    dialog(value) { dialogOpen = value; },
    switch(channel) { const result = component(instance.tree, 'ConversationChannels').props.onChange(channel); this.update(); return result; },
    workspace() { return component(instance.tree, 'ConversationWorkspace'); },
    instagram() { return component(instance.tree, 'InstagramConversations'); },
  });
}
const inboxData = {
  contacts: [
    { id: 'dm', name: 'Ana sintética', assignedTo: null, lastMessageAt: '2026-10-20T13:00:00.000Z',
      messages: [{ id: 'm1', text: '<script>EXTERNAL_SCRIPT</script> Quero um apartamento.', at: '2026-10-20T13:00:00.000Z' }] },
    { id: 'dm2', name: 'Bruno sintético', assignedTo: 'Corretor sintético', lastMessageAt: '2026-10-20T14:00:00.000Z',
      messages: [{ id: 'm2', text: 'BRUNO_PRIVATE_TEXT', at: '2026-10-20T14:00:00.000Z' }] },
  ], limit: 100, readOnly: true, connectionStatus: 'not_verified',
};
const response = data => ({ ok: true, status: 200, json: async () => ({ data: structuredClone(data) }) });
function instagramHarness(props = {}, environment = {}) {
  const requests = [];
  const instance = hooksHarness(instagramFile, 'default', props, {
    dashboardFetch(url, options) { const result = deferred(); requests.push({ url, options, ...result }); return result.promise; },
    ...environment,
  });
  return Object.assign(instance, {
    requests,
    async respond(index, data = inboxData) { requests[index].resolve(response(data)); await tick(); instance.render(); },
    click(label) { const target = button(instance.tree, label); assert(target, `Button ${label} exists`); assert(!target.props.disabled, `${label} enabled`); target.props.onClick(); instance.render(); },
  });
}
async function run() {
  const Channels = pure.load(channelsFile).default;
  const Instagram = pure.load(instagramFile).default;
  const Center = pure.load(centerFile).default;
  const changed = [];
  for (const channel of ['whatsapp', 'instagram']) {
    const tree = Channels({ channel, onChange: value => changed.push(value) });
    const html = renderToStaticMarkup(tree);
    assert(html.includes('role="group" aria-label="Canal de conversas"'));
    for (const [value, label] of [['whatsapp', 'WhatsApp'], ['instagram', 'Instagram']]) {
      const item = button(tree, label);
      assert.equal(item.props['aria-pressed'], value === channel);
      assert.equal(item.props['aria-controls'], 'conversation-channel-content');
      assert.equal(item.props.type, 'button');
      assert.equal(item.props.disabled, false);
      const icon = renderToStaticMarkup(component(item, 'ChannelIcon'));
      assert(icon.includes('<svg') && icon.includes('aria-hidden="true"'), `${label} has a decorative icon and readable name`);
      item.props.onClick();
    }
  }
  assert.deepEqual(changed, ['whatsapp', 'instagram', 'whatsapp', 'instagram']);
  const busyChannels = Channels({ channel: 'whatsapp', onChange() {}, busy: true });
  assert.equal(button(busyChannels, 'Instagram').props.disabled, true);
  assert.equal(button(busyChannels, 'WhatsApp').props.disabled, false);
  assert(text(busyChannels).includes('Aguarde a operação'));
  for (const props of [{ demonstration: true }, {}]) {
    const html = renderToStaticMarkup(React.createElement(Instagram, props));
    assert(html.includes('id="conversation-channel-content"'));
    assert(html.includes('somente consulta') && html.includes('ainda precisa ser ativada e testada'));
    assert(!/<(?:form|textarea|audio|img)\b/.test(html), 'Instagram SSR never mounts send/media controls');
  }
  const waSSR = renderToStaticMarkup(React.createElement(Center, conversationProps()));
  assert(waSSR.includes('Mensagem para Contato wa') && !waSSR.includes('Instagram · somente consulta'));
  const igProps = conversationProps();
  igProps.state = reducer.demoConversationReducer(igProps.state, { type: 'select', id: 'lead-dm' });
  const igSSR = renderToStaticMarkup(React.createElement(Center, igProps));
  assert(igSSR.includes('Instagram na demonstração') && !igSSR.includes('full-composer'));
  assert.equal((igSSR.match(/id="conversation-channel-content"/g) || []).length, 1);

  const center = centerHarness();
  assert(center.workspace() && !center.instagram(), 'WhatsApp is initially the only workspace');
  const expectedWA = ['wa', 'generic', 'ads', 'variant', 'spaced'];
  assert.deepEqual(Array.from(center.workspace().props.leads, item => item.id), expectedWA, 'Only exact Instagram Direct is a separate source');
  assert.deepEqual(Array.from(center.workspace().props.inbox, item => item.leadId), expectedWA);
  assert.deepEqual(Array.from(component(center.tree, 'ConversationAlerts').props.inbox, item => item.leadId), expectedWA);
  assert.deepEqual(Array.from(component(center.tree, 'ConversationUrgentAlert').props.visibleLeadIds), expectedWA);
  let workspace = hooksHarness(centerFile, 'ConversationWorkspace', center.workspace().props);
  const composer = find(workspace.tree, node => node.type === 'input' && node.props['aria-label'] === 'Mensagem para Contato wa');
  composer.props.onChange({ target: { value: 'Rascunho preservado ao trocar de canal' } });
  center.update();
  workspace.render(center.workspace().props);
  assert.equal(center.getState().threads['lead-wa'].draft, 'Rascunho preservado ao trocar de canal');
  assert.equal(center.switch('instagram'), true);
  workspace.unmount();
  assert(center.instagram() && !center.workspace(), 'Switching really unmounts WhatsApp instead of hiding it');
  assert(!component(center.tree, 'ConversationSettings'), 'WhatsApp-only preferences stay out of Instagram');
  assert.equal(center.getState().selectedId, 'lead-wa');
  assert.equal(center.switch('whatsapp'), true);
  workspace = hooksHarness(centerFile, 'ConversationWorkspace', center.workspace().props);
  assert.equal(find(workspace.tree, node => node.type === 'input' && node.props['aria-label'] === 'Mensagem para Contato wa').props.value,
    'Rascunho preservado ao trocar de canal', 'A fresh WhatsApp workspace restores the parent reducer draft');
  workspace.unmount();

  center.workspace().props.onBusyChange(true); center.update();
  assert.equal(center.switch('instagram'), false);
  assert(center.workspace());
  assert(component(center.tree, 'ConversationChannels').props.busy);
  center.select('dm');
  assert(center.workspace(), 'External selection does not bypass an operation in progress');
  center.workspace().props.onBusyChange(false); center.update();
  await tick(); center.update();
  assert(center.instagram(), 'The queued Instagram selection becomes available once the operation finishes');
  const firstInstagramKey = center.instagram().key;
  center.select('dm2');
  assert.equal(center.instagram().props.initialLeadId, 'dm2');
  assert.notEqual(center.instagram().key, firstInstagramKey, 'External Instagram navigation remounts with the new selection');
  center.dialog(true);
  assert.equal(center.switch('whatsapp'), false);
  const beforeAlert = center.actions.length;
  component(center.tree, 'ConversationUrgentAlert').props.onOpen('wa'); center.update();
  assert.equal(center.actions.length, beforeAlert, 'An open dialog also blocks urgent navigation');
  center.dialog(false);
  component(center.tree, 'ConversationUrgentAlert').props.onOpen('wa'); center.update();
  assert(center.workspace() && !center.instagram(), 'Urgent WhatsApp alert returns to the WhatsApp component');
  assert.equal(center.getState().selectedId, 'lead-wa');
  assert.equal(center.getState().threads['lead-wa'].draft, 'Rascunho preservado ao trocar de canal');
  center.dialog(true); center.select('dm');
  assert(center.workspace(), 'External selection does not bypass an open dialog');
  center.dialog(false);
  assert.equal(center.switch('instagram'), true);
  assert(center.notices.every(message => message.includes('Conclua a operação')));
  center.unmount();

  // Public /demonstracao also needs the transport's demo flag; its callers do
  // not necessarily pass the explicit demonstration prop.
  for (const [props, environment] of [[{ demonstration: true }, {}], [{}, { productDemo: true }], [{ demonstration: true }, { productDemo: true }]]) {
    const preview = instagramHarness(props, environment);
    assert.equal(preview.requests.length, 0, 'Neither demonstration entry point fetches real Instagram data');
    assert(text(preview.tree).includes('Nenhuma conta é conectada'));
    assert(!nodes(preview.tree).some(node => node.type === 'button'), 'The preview cannot reload or send anything');
    preview.unmount();
  }
  const instagram = instagramHarness({ initialLeadId: 'dm2' });
  assert.equal(instagram.requests.length, 1);
  const first = instagram.requests[0];
  assert.equal(first.url, '/api/conversations/instagram');
  assert.equal(first.options.method || 'GET', 'GET');
  assert.equal(first.options.cache, 'no-store');
  assert.equal(first.options.body, undefined);
  assert(first.options.signal instanceof AbortSignal);
  assert(find(instagram.tree, node => node.props?.role === 'status'));
  await instagram.respond(0);
  assert(find(instagram.tree, node => node.props?.['aria-label'] === 'Histórico de Bruno sintético'));
  assert(text(instagram.tree).includes('Até 40 textos por contato'));
  assert(text(instagram.tree).includes('não representa o histórico completo'));
  assert(text(instagram.tree).includes('A IA permanece desligada'));
  assert(!/\b(?:Instagram conectado|Conexão ativa|IA ativa)\b/.test(text(instagram.tree)));
  assert(!nodes(instagram.tree).some(node => ['form', 'textarea', 'audio', 'img'].includes(node.type)));
  assert.equal(nodes(instagram.tree).filter(node => node.type === 'input').length, 1, 'Only contact search is editable');
  const ana = find(instagram.tree, node => node.type === 'button' && text(node).startsWith('Ana sintética'));
  ana.props.onClick(); instagram.render();
  assert(find(instagram.tree, node => node.props?.['aria-label'] === 'Histórico de Ana sintética'));
  const safeHtml = renderToStaticMarkup(instagram.tree);
  assert(safeHtml.includes('&lt;script&gt;EXTERNAL_SCRIPT&lt;/script&gt;') && !safeHtml.includes('<script>'), 'Untrusted message text is escaped');
  const search = find(instagram.tree, node => node.type === 'input');
  search.props.onChange({ target: { value: '  BRUNO  ' } }); instagram.render();
  assert(!text(instagram.tree).includes('Ana sintética') && text(instagram.tree).includes('BRUNO_PRIVATE_TEXT'));
  find(instagram.tree, node => node.type === 'input').props.onChange({ target: { value: 'does-not-exist' } }); instagram.render();
  assert(text(instagram.tree).includes('Nenhum contato encontrado'));
  assert(!text(instagram.tree).includes('BRUNO_PRIVATE_TEXT'));
  instagram.click('Atualizar');
  assert(first.options.signal.aborted, 'Refresh aborts the previous request scope');
  assert(!text(instagram.tree).includes('BRUNO_PRIVATE_TEXT'));
  assert.equal(instagram.requests.length, 2);
  instagram.requests[1].resolve({ ok: false, status: 403, json: async () => ({ error: 'PRIVATE_SERVER_ERROR' }) });
  await tick(); instagram.render();
  assert(find(instagram.tree, node => node.props?.role === 'alert'));
  assert(text(instagram.tree).includes('Entre novamente'));
  assert(!text(instagram.tree).includes('PRIVATE_SERVER_ERROR'));
  assert(!text(instagram.tree).includes('BRUNO_PRIVATE_TEXT') && !text(instagram.tree).includes('Ana sintética'), 'Error clears stale contacts and messages');
  instagram.click('Tentar novamente');
  instagram.requests[2].resolve({ ok: false, status: 503, json: async () => ({ error: 'PRIVATE_BACKEND_REASON' }) });
  await tick(); instagram.render();
  assert(text(instagram.tree).includes('Não foi possível consultar as mensagens'));
  assert(!text(instagram.tree).includes('PRIVATE_BACKEND_REASON'));
  instagram.click('Tentar novamente');
  await instagram.respond(3, { ...inboxData, readOnly: false });
  assert(text(instagram.tree).includes('A consulta do Instagram está indisponível.'));
  instagram.click('Tentar novamente');
  await instagram.respond(4, { ...inboxData, contacts: [] });
  assert(text(instagram.tree).includes('Nenhuma DM disponível'));
  assert(text(instagram.tree).includes('estão pendentes'));
  instagram.click('Atualizar');
  const pending = instagram.requests.at(-1);
  instagram.unmount();
  assert(pending.options.signal.aborted, 'Leaving Instagram aborts its pending request');
  pending.resolve(response(inboxData)); await tick();
  assert.equal(instagram.updatesAfterUnmount, 0, 'A late response cannot update an unmounted channel');
  assert(instagram.requests.every(request => request.url === first.url && (request.options.method || 'GET') === 'GET' && request.options.body === undefined),
    'All channel interactions remain GET-only: no send, ownership, read acknowledgement or AI route');

  // The real workspace reports pending sends to its parent, not just a visual
  // disabled state. A synthetic failure keeps the draft and releases the gate.
  const operation = deferred(), operationBusy = [], sent = [], operationProps = conversationProps();
  operationProps.state = reducer.demoConversationReducer(operationProps.state, { type: 'draft', id: 'lead-wa', text: 'Texto ainda não enviado' });
  const operationWorkspace = hooksHarness(centerFile, 'ConversationWorkspace', {
    ...operationProps,
    persistMessage: input => { sent.push(input); return operation.promise; },
    onBusyChange: value => operationBusy.push(value),
  });
  const submit = find(operationWorkspace.tree, node => node.props?.['aria-label'] === 'Adicionar mensagem');
  assert.equal(submit.props.disabled, false);
  submit.props.onClick(); operationWorkspace.render();
  assert.equal(operationBusy.at(-1), true, 'The real send lifecycle tells the channel switcher it is busy');
  assert.equal(find(operationWorkspace.tree, node => node.props?.['aria-label'] === 'Adicionar mensagem').props.disabled, true);
  submit.props.onClick(); operationWorkspace.render();
  assert.equal(sent.length, 1, 'The in-flight send cannot be duplicated');
  operation.reject(Error('Falha sintética de envio'));
  await tick(); operationWorkspace.render();
  assert.equal(operationBusy.at(-1), false);
  assert.equal(find(operationWorkspace.tree, node => node.props?.['aria-label'] === 'Mensagem para Contato wa').props.value, 'Texto ainda não enviado');
  assert(text(operationWorkspace.tree).includes('Falha sintética de envio'));
  operationWorkspace.unmount();

  // Exercise actual WhatsApp history/read-ack lifecycle, not just the parent
  // conditional. Unmounting on channel change must remove listeners and abort.
  const window = eventTarget(), document = Object.assign(eventTarget(), { visibilityState: 'visible', hasFocus: () => true });
  const body = Object.assign(eventTarget(), { scrollHeight: 300, scrollTop: 300, clientHeight: 200, getClientRects: () => [{}] });
  const subscriptions = [], acknowledgements = [], busy = [];
  let unsubscribed = 0;
  const liveProps = { ...conversationProps(), demonstration: false, leads: [leads[0]], onBusyChange: value => busy.push(value) };
  const live = hooksHarness(centerFile, 'ConversationWorkspace', liveProps, {
    window, document,
    subscribe(subscription) { subscriptions.push(subscription); return () => { unsubscribed++; }; },
    dashboardFetch(url, options) { acknowledgements.push({ url, options }); return new Promise(() => {}); },
  });
  find(live.tree, node => node.props?.className === 'full-chat-body').props.ref.current = body;
  await tick(); live.render();
  assert.equal(subscriptions.length, 1);
  subscriptions[0].apply({ data: [], attendance: [], nextCursor: null, positions: [{ conversationId: 'conversation-wa', position: 1 }] });
  live.render();
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0].url, '/api/conversations/inbox');
  assert.equal(acknowledgements[0].options.method, 'POST');
  assert(window.listenerCount > 0 && document.listenerCount > 0 && body.listenerCount > 0);
  live.unmount();
  assert.equal(unsubscribed, 1, 'Leaving WhatsApp stops its history subscription');
  assert(acknowledgements[0].options.signal.aborted, 'Leaving WhatsApp aborts its in-flight read acknowledgement');
  assert.equal(window.listenerCount + document.listenerCount + body.listenerCount, 0);
  window.fire('focus'); document.fire('visibilitychange'); body.fire('scroll');
  assert.equal(acknowledgements.length, 1, 'Hidden WhatsApp cannot continue acknowledging reads');
  assert.equal(busy.at(-1), false);
  assert.equal(forbiddenCalls, 0, 'No test uses external fetch or actual send/AI callbacks');
  console.log('Conversation channels UI: PASS (SSR, icons, source isolation, drafts, guards, alerts, preview, read-only Instagram and lifecycle)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
