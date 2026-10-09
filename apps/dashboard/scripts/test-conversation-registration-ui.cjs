// Controlled React hooks and DOM seams; no browser account or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => ({ type, props: props || {} });
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = `case:${uuid(102)}`, propertyId = `property:${uuid(301)}`;
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
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);
const trigger = tree => button(tree, 'Registro');
const menuItem = (tree, label) => find(tree, node => node.props.role === 'menuitem' && text(find(node, child => child.type === 'strong')) === label);
const formNode = tree => find(tree, node => node.type === 'form');
const submitButton = tree => find(tree, node => node.type === 'button' && node.props.type === 'submit');
const control = (tree, label) => find(find(tree, node => node.type === 'label' && text(node).startsWith(label)), node => ['input', 'select', 'textarea'].includes(node.type));

function fixture({ role = 'broker', closed = false } = {}) {
  const actor = { companyId: uuid(1), brokerId: uuid(role === 'owner' ? 11 : 12), name: 'Responsável sintético', role };
  const now = new Date().toISOString();
  const record = (id, kind, data, legacy) => ({ id, kind, data, createdAt: now, updatedAt: now, createdBy: uuid(12), ...(legacy ? { legacy } : {}) });
  const legacy = { table: 'leads', id: uuid(102), access: 'assigned', assignedTo: uuid(12) };
  return { actor, mode: 'live', state: {
    companyId: uuid(1), version: 4, sourceRevision: 'a'.repeat(64), events: [],
    members: [{ id: uuid(11), name: 'Administrador teste', role: 'owner' }, { id: uuid(12), name: 'Corretor teste', role: 'broker' }], settings: {},
    records: [
      record(caseId, 'cases', { name: 'Cliente teste', purpose: 'Venda', stage: 'Atendimento', journey: 'Negociação', status: closed ? 'Ganho' : 'Aberto', assignedTo: uuid(12), personId: `person:${uuid(102)}`, propertyId }, legacy),
      record(`person:${uuid(102)}`, 'people', { name: 'Cliente teste' }, legacy),
      record(propertyId, 'properties', { name: 'Imóvel teste', code: 'TEST-301', purpose: 'Venda', status: 'Disponível' }, { table: 'properties', id: uuid(301), access: 'shared' }),
      record(`appointment:${uuid(902)}`, 'tasks', { caseId, type: 'Visita', status: 'Confirmada', propertyId, dueAt: new Date(Date.now() - 86400000).toISOString(), assignedTo: uuid(12) }, { table: 'appointments', id: uuid(902), access: 'assigned', assignedTo: uuid(12) }),
      record(uuid(903), 'proposals', { name: 'Proposta teste', caseId, propertyId, status: 'Enviada', amount: 500000, expiresAt: '2030-01-01' }),
    ],
  } };
}

function harness({ props = {}, response, snapshot = fixture(), demoPath = false } = {}) {
  const slots = [], effects = [], calls = [], notifications = [], listeners = new Map(), timers = new Map(), cache = new Map();
  let cursor = 0, timerId = 0, tree, saved = 0, focusCount = 0;
  const React = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useId() { return `registration-${cursor++}`; },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || !dependencies || dependencies.some((value, key) => value !== previous.dependencies?.[key])) effects.push(() => { previous?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
    },
  };
  const document = {
    activeElement: null,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const window = { innerWidth: 1280, innerHeight: 900, addEventListener: document.addEventListener, removeEventListener: document.removeEventListener };
  const focusTarget = () => ({ __inside: true, focus() { focusCount++; document.activeElement = this; } });
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} }; cache.set(file, mod.exports);
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    assert.equal(compiled.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, file);
    const requireLocal = name => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('fragment') };
      if (name.endsWith('.css')) return css;
      if (name === '@/lib/dashboard-transport') return {
        isProductDemo: () => demoPath,
        dashboardFetch: async (url, options = {}) => { const call = { url, options }; calls.push(call); return response ? response(call, snapshot) : Response.json(snapshot); },
      };
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
      throw Error(`Unexpected dependency ${name}`);
    };
    vm.runInNewContext(compiled.outputText, {
      module: mod, exports: mod.exports, require: requireLocal, console, crypto, Date, Intl, URL, AbortController, structuredClone, document, window,
      setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; }, clearTimeout: id => timers.delete(id),
    }, { filename: file });
    cache.set(file, mod.exports); return mod.exports;
  }
  const Component = load('app/conversation-registration.tsx').default;
  const input = { leadId: uuid(102), customerName: 'Cliente teste', onSaved: () => { saved++; }, notify: message => notifications.push(message), ...props };
  function render() {
    cursor = 0; tree = Component(input);
    for (const node of nodes(tree)) {
      if (typeof node.type !== 'string' || !node.props.ref || typeof node.props.ref !== 'object') continue;
      node.props.ref.current ||= {
        ...focusTarget(), contains: target => Boolean(target?.__inside), open: false, style: {}, offsetWidth: 330, offsetHeight: 430,
        showModal() { this.open = true; }, close() { this.open = false; },
        querySelector: () => focusTarget(), querySelectorAll: () => nodes(tree).filter(node => node.props.role === 'menuitem' && !node.props.disabled).map(focusTarget),
        getBoundingClientRect: () => ({ left: 0, right: 500, top: 0, bottom: 500 }),
      };
    }
    while (effects.length) effects.shift()();
    return tree;
  }
  render();
  return {
    calls, snapshot, timers, notifications, render,
    get tree() { return tree; }, get saved() { return saved; }, get focusCount() { return focusCount; },
    async settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); render(); },
    async open() { trigger(tree).props.onClick(); render(); await this.settle(); },
    select(label) { const item = menuItem(tree, label); assert(item && !item.props.disabled, label); item.props.onClick(); render(); },
    change(label, value) { const field = control(tree, label); assert(field, `missing field ${label}`); field.props.onChange({ target: { value, checked: value } }); render(); },
    async submit() { const result = formNode(tree).props.onSubmit({ preventDefault() {} }); render(); await result; await this.settle(); },
    dispatch(name, event) { for (const callback of listeners.get(name) || []) callback(event); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    listenerCount() { return [...listeners.values()].reduce((sum, values) => sum + values.size, 0); },
  };
}

async function run() {
  const menu = harness();
  assert.equal(nodes(menu.tree).filter(node => node.type === 'button').length, 1, 'the conversation gains only one button');
  assert.equal(trigger(menu.tree).props.type, 'button');
  assert.equal(trigger(menu.tree).props['aria-expanded'], false);
  assert.equal(menu.calls.length, 0, 'rendering conversation does not mutate or fetch CRM');
  await menu.open();
  assert.equal(menu.calls.length, 1); assert.equal(menu.calls[0].options.method, undefined);
  assert.equal(menu.calls[0].url, '/api/evolution');
  assert.equal(menu.calls[0].options.credentials, 'same-origin');
  assert.equal(trigger(menu.tree).props['aria-expanded'], true);
  assert.deepEqual(nodes(menu.tree).filter(node => node.props.role === 'menuitem').map(node => text(find(node, child => child.type === 'strong'))), ['Lead', 'Iniciar atendimento', 'Agendar visita', 'Visita realizada', 'Proposta', 'Negociado']);
  assert.equal(find(menu.tree, node => node.props.role === 'menu').props.id, trigger(menu.tree).props['aria-controls']);
  find(menu.tree, node => node.props.role === 'menu').props.onKeyDown({ key: 'Escape', preventDefault() {} }); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], false);
  assert.ok(menu.focusCount > 0);
  await menu.open();
  const popup = find(menu.tree, node => node.type === 'dialog' && node.props['aria-label'] === 'Opções de registro');
  popup.props.onClick({ target: popup.props.ref.current, clientX: -1, clientY: -1 }); menu.render();
  assert.equal(trigger(menu.tree).props['aria-expanded'], false);
  menu.unmount(); assert.equal(menu.listenerCount(), 0);

  for (const configuration of [{ props: { demonstration: true } }, { demoPath: true }]) {
    const demo = harness(configuration); await demo.open();
    assert.equal(demo.calls.length, 0, 'public demo must never access a live CRM');
    assert.match(text(demo.tree), /demonstração/);
    demo.select('Iniciar atendimento'); await demo.submit();
    assert.equal(demo.calls.length, 0, 'interactive demonstration changes only local synthetic state');
    assert.equal(demo.saved, 0, 'simulation must not refresh live data');
    assert.equal(demo.notifications.length, 1); assert.match(demo.notifications[0], /demonstração/);
    await demo.open(); demo.select('Iniciar atendimento');
    assert.match(text(demo.tree), /Etapa atual: Atendimento/, 'local synthetic stage persists while the example conversation is open');
    demo.unmount();
  }
  const closed = harness({ snapshot: fixture({ closed: true }) }); await closed.open();
  assert.ok(nodes(closed.tree).filter(node => node.props.role === 'menuitem').every(node => node.props.disabled));
  assert.match(text(closed.tree), /não está aberto/); closed.unmount();
  const disabled = harness({ props: { disabled: true } });
  assert.equal(trigger(disabled.tree).props.disabled, true); await disabled.open();
  assert.equal(disabled.calls.length, 0); disabled.unmount();

  const drafts = [
    ['Lead', 'lead', [['Motivo do retorno', 'Contato classificado por engano.']]],
    ['Iniciar atendimento', 'attendance', [['Resultado', 'Tentativa sem resposta']]],
    ['Agendar visita', 'schedule', [['Imóvel', propertyId], ['Data da visita', '2030-10-10'], ['Horário', '10:30']]],
    ['Visita realizada', 'visit', []],
    ['Proposta', 'proposal', [['Imóvel', propertyId], ['Valor proposto', '500000'], ['Validade', '2030-10-10'], ['Condições', 'À vista.']]],
  ];
  for (const [label, action, values] of drafts) {
    const form = harness(); await form.open(); form.select(label);
    assert.equal(form.calls.filter(call => call.options.method === 'POST').length, 0, 'selecting an event does not save it');
    assert(find(form.tree, node => node.type === 'dialog').props['aria-labelledby']);
    for (const [field, value] of values) form.change(field, value);
    await form.submit();
    const calls = form.calls.filter(call => call.options.method === 'POST');
    assert.equal(calls.length, 1);
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.command.type, 'register'); assert.equal(payload.command.action, action);
    assert.equal(payload.command.caseId, caseId); assert.match(payload.command.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(payload.expectedVersion, 4); assert.equal(payload.expectedSourceRevision, 'a'.repeat(64));
    assert.equal(payload.command.data.assignedTo, undefined, 'registration cannot reassign accounts');
    if (action === 'schedule') assert.equal(payload.command.data.dueAt, '2030-10-10T10:30');
    if (action === 'attendance') assert.equal(payload.command.data.outcome, 'Tentativa sem resposta');
    assert.equal(form.saved, 1); assert.equal(form.notifications.length, 1); assert.equal(formNode(form.tree), undefined);
    assert.equal(form.timers.size, 0); form.unmount();
  }
  const historical = harness(); await historical.open(); historical.select('Visita realizada');
  historical.change('Visita realizada', ''); historical.change('Imóvel', propertyId);
  historical.change('Data em que aconteceu', '2026-01-02'); historical.change('Horário da visita', '11:45'); await historical.submit();
  const historicalData = JSON.parse(historical.calls.at(-1).options.body).command.data;
  assert.equal(historicalData.propertyId, propertyId); assert.equal(historicalData.occurredAt, '2026-01-02T11:45');
  assert.equal(historicalData.taskId, undefined, 'an unscheduled past visit is distinct from selecting an appointment'); historical.unmount();
  const broker = harness(); await broker.open(); broker.select('Negociado');
  assert.equal(submitButton(broker.tree).props.disabled, true, 'shared property cannot be closed by a broker without permission');
  assert.match(text(broker.tree), /administrador/); broker.unmount();
  const owner = harness({ snapshot: fixture({ role: 'owner' }) }); await owner.open(); owner.select('Negociado');
  await owner.submit(); assert.equal(owner.calls.filter(call => call.options.method === 'POST').length, 0, 'closing requires explicit confirmation');
  owner.change('Confirmo que', true); await owner.submit();
  assert.equal(JSON.parse(owner.calls.at(-1).options.body).command.data.confirmed, true); owner.unmount();

  let resolvePost;
  const busy = harness({ response: call => call.options.method === 'POST' ? new Promise(resolve => { resolvePost = resolve; }) : Response.json(fixture()) });
  await busy.open(); busy.select('Iniciar atendimento');
  const submit = formNode(busy.tree).props.onSubmit;
  const inFlight = submit({ preventDefault() {} }); submit({ preventDefault() {} }); busy.render();
  assert.equal(busy.calls.filter(call => call.options.method === 'POST').length, 1, 'double click does not submit twice');
  assert.equal(submitButton(busy.tree).props.disabled, true);
  assert([...busy.timers.values()].some(timer => timer.ms === 15000), 'requests have a 15-second timeout');
  resolvePost(Response.json(fixture())); await inFlight; await busy.settle(); busy.unmount();

  let failed = true;
  const uncertain = harness({ response: call => call.options.method === 'POST' && failed ? Response.json({ error: 'Outcome unknown' }, { status: 503 }) : Response.json(fixture()) });
  await uncertain.open(); uncertain.select('Iniciar atendimento'); await uncertain.submit();
  assert.equal(uncertain.saved, 0); assert.equal(submitButton(uncertain.tree).props.disabled, true);
  assert.equal(find(uncertain.tree, node => node.type === 'fieldset').props.disabled, true, 'uncertain form is immutable until reconciled');
  const first = JSON.parse(uncertain.calls.find(call => call.options.method === 'POST').options.body).command;
  await button(uncertain.tree, 'Verificar dados atualizados').props.onClick(); await uncertain.settle();
  assert.equal(submitButton(uncertain.tree).props.disabled, true, 'refresh alone is not confirmation');
  uncertain.change('Conferi os dados', true);
  failed = false; await uncertain.submit();
  const second = JSON.parse(uncertain.calls.filter(call => call.options.method === 'POST')[1].options.body).command;
  assert.deepEqual(first, second, 'retry reuses identical request id and payload');
  assert.equal(uncertain.saved, 1); uncertain.unmount();

  let committed;
  const reconciled = harness({ response: call => {
    if (call.options.method === 'POST') { committed = JSON.parse(call.options.body).command; return Response.json({ error: 'Saved but screen reload failed' }, { status: 503 }); }
    const current = fixture(); if (committed) current.state.events.push({ actorId: current.actor.brokerId, recordId: caseId, registration: { requestId: committed.requestId } });
    return Response.json(current);
  } });
  await reconciled.open(); reconciled.select('Iniciar atendimento'); await reconciled.submit();
  await button(reconciled.tree, 'Verificar dados atualizados').props.onClick(); await reconciled.settle();
  assert.equal(reconciled.saved, 1); assert.equal(reconciled.calls.filter(call => call.options.method === 'POST').length, 1, 'discovering committed audit event avoids a second POST'); reconciled.unmount();

  let conflict = true;
  const stale = harness({ response: call => call.options.method === 'POST' && conflict ? Response.json({ error: 'Changed' }, { status: 409 }) : Response.json(fixture()) });
  await stale.open(); stale.select('Iniciar atendimento'); await stale.submit();
  assert.equal(submitButton(stale.tree).props.disabled, true);
  await button(stale.tree, 'Verificar dados atualizados').props.onClick(); await stale.settle();
  stale.change('Conferi os dados', true);
  conflict = false; await stale.submit();
  const requests = stale.calls.filter(call => call.options.method === 'POST').map(call => JSON.parse(call.options.body).command);
  assert.notEqual(requests[0].requestId, requests[1].requestId, 'known rejected 409 gets a new request after explicit review'); stale.unmount();

  let racedCommand;
  const reconciledRace = harness({ response: call => {
    if (call.options.method === 'POST') { racedCommand = JSON.parse(call.options.body).command; return Response.json({ error: 'Concurrent commit' }, { status: 409 }); }
    const current = fixture(); if (racedCommand) current.state.events.push({ actorId: current.actor.brokerId, recordId: caseId, registration: { requestId: racedCommand.requestId } });
    return Response.json(current);
  } });
  await reconciledRace.open(); reconciledRace.select('Iniciar atendimento'); await reconciledRace.submit();
  assert.equal(reconciledRace.saved, 1, '409 can represent another identical in-flight request already committed');
  assert.equal(formNode(reconciledRace.tree), undefined);
  assert.equal(reconciledRace.calls.filter(call => call.options.method === 'POST').length, 1); reconciledRace.unmount();

  let attempted = false, failRead = true, failWrite = true;
  const unknownConflict = harness({ response: call => {
    if (call.options.method === 'POST') { attempted = true; return failWrite ? Response.json({ error: 'Changed' }, { status: 409 }) : Response.json(fixture()); }
    return attempted && failRead ? Response.json({ error: 'Read unavailable' }, { status: 503 }) : Response.json(fixture());
  } });
  await unknownConflict.open(); unknownConflict.select('Iniciar atendimento'); await unknownConflict.submit();
  assert.equal(submitButton(unknownConflict.tree).props.disabled, true);
  assert.equal(find(unknownConflict.tree, node => node.type === 'fieldset').props.disabled, true, 'failed reconciliation cannot silently discard a potentially committed request');
  button(unknownConflict.tree, 'Cancelar').props.onClick(); unknownConflict.render(); await unknownConflict.open();
  assert(formNode(unknownConflict.tree), 'reopening the button restores the unresolved request instead of creating another');
  failRead = false; await button(unknownConflict.tree, 'Verificar dados atualizados').props.onClick(); await unknownConflict.settle();
  unknownConflict.change('Conferi os dados', true); failWrite = false; await unknownConflict.submit();
  const unknownRequests = unknownConflict.calls.filter(call => call.options.method === 'POST').map(call => JSON.parse(call.options.body).command);
  assert.deepEqual(unknownRequests[0], unknownRequests[1], 'failed 409 reload preserves the same UUID and payload for recovery'); unknownConflict.unmount();

  const timedOut = harness({ response: call => call.options.method === 'POST' ? new Promise((_resolve, reject) => call.options.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true })) : Response.json(fixture()) });
  await timedOut.open(); timedOut.select('Iniciar atendimento');
  const waiting = formNode(timedOut.tree).props.onSubmit({ preventDefault() {} }); timedOut.render();
  [...timedOut.timers.values()].find(timer => timer.ms === 15000).callback(); await waiting; await timedOut.settle();
  assert.equal(timedOut.calls.at(-1).options.signal.aborted, true);
  assert.equal(timedOut.saved, 0); assert.equal(submitButton(timedOut.tree).props.disabled, true);
  assert(find(timedOut.tree, node => node.props.role === 'alert')); timedOut.unmount();
  const bodyTimeout = harness({ response: call => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => call.options.signal.addEventListener('abort', () => reject(new Error('body timeout')), { once: true })) }) });
  trigger(bodyTimeout.tree).props.onClick(); bodyTimeout.render();
  await bodyTimeout.settle();
  assert([...bodyTimeout.timers.values()].some(timer => timer.ms === 15000), 'deadline includes response body decoding, not only response headers');
  [...bodyTimeout.timers.values()].find(timer => timer.ms === 15000).callback(); await bodyTimeout.settle();
  assert(find(bodyTimeout.tree, node => node.props.role === 'alert')); assert.equal(bodyTimeout.timers.size, 0); bodyTimeout.unmount();
  const unmounted = harness({ response: call => new Promise((_resolve, reject) => call.options.signal.addEventListener('abort', () => reject(new Error('unmount')), { once: true })) });
  trigger(unmounted.tree).props.onClick(); unmounted.render(); unmounted.unmount(); await unmounted.settle();
  assert.equal(unmounted.calls[0].options.signal.aborted, true, 'leaving the conversation aborts its old request');
  assert.equal(unmounted.saved, 0);
  console.log('PASS registration UI: one accessible disclosure, GET-only opening, six explicit forms, no demo network, closed/role guards, explicit closing, timeout and duplicate-click protection, preserved idempotent recovery and post-commit reconciliation. Synthetic hooks and network only.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
