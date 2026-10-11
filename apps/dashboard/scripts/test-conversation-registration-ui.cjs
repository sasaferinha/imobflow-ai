// Controlled React hooks and DOM seams; no browser account or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
const root = path.resolve(__dirname, '..');
const jsx = (type, props) => typeof type === 'function' ? type(props || {}) : ({ type, props: props || {} });
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
const trigger = tree => button(tree, 'Registro') || button(tree, 'Editar fechamento');
const menuItem = (tree, label) => find(tree, node => node.props.role === 'menuitem' && text(find(node, child => child.type === 'strong')) === label);
const formNode = tree => find(tree, node => node.type === 'form');
const submitButton = tree => find(tree, node => node.type === 'button' && node.props.type === 'submit');
const control = (tree, label) => find(find(tree, node => node.type === 'label' && text(node).startsWith(label)), node => ['input', 'select', 'textarea'].includes(node.type));
function cancelNestedDialog(instance) {
  let prevented = false, stopped = false, parentClosed = false;
  const event = { preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
  find(instance.tree, node => node.type === 'dialog').props.onCancel(event);
  // React bubbles cancel from a nested dialog to RecordDetail. Its onClose
  // would unmount the child and abort its pending request if not stopped.
  if (!stopped) { parentClosed = true; instance.unmount(); }
  instance.render();
  assert.equal(prevented, true, 'native dialog closing is handled by the component');
  assert.equal(parentClosed, false, 'Escape in the nested dialog must not close the parent record detail');
}

function fixture({ role = 'broker', closed = false, source = 'WhatsApp' } = {}) {
  const actor = { companyId: uuid(1), brokerId: uuid(role === 'owner' ? 11 : 12), name: 'Responsável sintético', role };
  const now = new Date().toISOString();
  const record = (id, kind, data, legacy) => ({ id, kind, data, createdAt: now, updatedAt: now, createdBy: uuid(12), ...(legacy ? { legacy } : {}) });
  const legacy = { table: 'leads', id: uuid(102), access: 'assigned', assignedTo: uuid(12) };
  return { actor, mode: 'live', state: {
    companyId: uuid(1), version: 4, sourceRevision: 'a'.repeat(64), events: [],
    members: [{ id: uuid(11), name: 'Administrador teste', role: 'owner' }, { id: uuid(12), name: 'Corretor teste', role: 'broker' }], settings: {},
    records: [
      record(caseId, 'cases', { name: 'Cliente teste', source, purpose: 'Venda', stage: 'Atendimento', journey: 'Negociação', status: closed ? 'Ganho' : 'Aberto', assignedTo: uuid(12), personId: `person:${uuid(102)}`, propertyId }, legacy),
      record(`person:${uuid(102)}`, 'people', { name: 'Cliente teste' }, legacy),
      record(propertyId, 'properties', { name: 'Imóvel teste', code: 'TEST-301', purpose: 'Venda', status: 'Disponível' }, { table: 'properties', id: uuid(301), access: 'shared' }),
      record(`appointment:${uuid(902)}`, 'tasks', { caseId, type: 'Visita', status: 'Confirmada', propertyId, dueAt: new Date(Date.now() - 86400000).toISOString(), assignedTo: uuid(12) }, { table: 'appointments', id: uuid(902), access: 'assigned', assignedTo: uuid(12) }),
      record(uuid(903), 'proposals', { name: 'Proposta teste', caseId, propertyId, status: 'Enviada', amount: 500000, expiresAt: '2030-01-01' }),
    ],
  } };
}
function closedFixture({ role = 'owner', legacyOnly = false, withHistory = true } = {}) {
  const result = fixture({ role, closed: true });
  const record = result.state.records.find(item => item.id === caseId);
  record.data.stage = 'Negociado'; record.legacy.lifecycleStatus = 'Convertido'; record.data.closedAt = '2026-10-01T12:00:00.000Z';
  const proposal = result.state.records.find(item => item.kind === 'proposals');
  if (legacyOnly) result.state.records = result.state.records.filter(item => item !== proposal);
  else { proposal.data.status = 'Aceita'; proposal.data.conditions = 'Entrada de 20%'; proposal.data.acceptedAt = '2026-10-01T12:00:00.000Z'; }
  result.state.records.find(item => item.id === propertyId).data.status = 'Vendido';
  if (withHistory && !legacyOnly) result.state.events = [
    { id: uuid(951), recordId: proposal.id, at: proposal.data.acceptedAt, actorId: result.actor.brokerId, type: 'updated', changes: { status: { from: 'Em negociação', to: 'Aceita' } } },
    { id: uuid(952), recordId: propertyId, at: proposal.data.acceptedAt, actorId: result.actor.brokerId, type: 'updated', changes: { status: { from: 'Reservado', to: 'Vendido' } } },
    { id: uuid(953), recordId: caseId, at: proposal.data.acceptedAt, actorId: result.actor.brokerId, type: 'updated', changes: { status: { from: 'Aberto', to: 'Ganho' }, closedAt: { from: '', to: proposal.data.acceptedAt } } },
  ];
  return result;
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
    if (!fs.existsSync(path.join(root, file)) && file.endsWith('.ts') && fs.existsSync(path.join(root, `${file}x`))) file += 'x';
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
  await menu.open(); cancelNestedDialog(menu);
  assert.equal(trigger(menu.tree).props['aria-expanded'], false, 'Escape closes only the child menu');
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
    assert.equal(payload.command.data.source, undefined, 'an untouched origin is never silently rewritten');
    if (action === 'schedule') assert.equal(payload.command.data.dueAt, '2030-10-10T10:30');
    if (action === 'attendance') assert.equal(payload.command.data.outcome, 'Tentativa sem resposta');
    assert.equal(form.saved, 1); assert.equal(form.notifications.length, 1); assert.equal(formNode(form.tree), undefined);
    assert.equal(form.timers.size, 0); form.unmount();
  }
  const sourceForm = harness(); await sourceForm.open(); sourceForm.select('Iniciar atendimento');
  const originGroup = find(sourceForm.tree, node => node.type === 'fieldset' && text(find(node, child => child.type === 'legend')) === 'Origem do cliente');
  assert(originGroup, 'each registration form has a named source group');
  const sourceRadios = nodes(originGroup).filter(node => node.type === 'input' && node.props.type === 'radio');
  assert.deepEqual(sourceRadios.map(node => node.props.value), ['Facebook', 'Instagram', 'Cliente pessoal', 'Tráfego pago', 'Indicação', 'WhatsApp', 'Site', 'Portal imobiliário', 'Placa no imóvel', 'Atendimento presencial', 'Outros']);
  assert.equal(sourceRadios.filter(node => node.props.checked).length, 1);
  assert.equal(sourceRadios.find(node => node.props.checked).props.value, 'WhatsApp');
  assert.equal(new Set(sourceRadios.map(node => node.props.name)).size, 1, 'one accessible native radio group enforces a single origin');
  sourceForm.change('Facebook', 'Facebook');
  assert.equal(control(sourceForm.tree, 'Facebook').props.checked, true);
  assert.equal(control(sourceForm.tree, 'WhatsApp').props.checked, false);
  await sourceForm.submit();
  const sourcePayload = JSON.parse(sourceForm.calls.at(-1).options.body).command.data;
  assert.equal(sourcePayload.source, 'Facebook'); assert.equal(sourcePayload.channel, 'WhatsApp', 'commercial origin is independent from conversation channel'); sourceForm.unmount();

  const other = harness(); await other.open(); other.select('Lead'); other.change('Outros', 'Outros');
  assert.equal(control(other.tree, 'Qual foi a origem?').props.maxLength, 192);
  assert.equal(control(other.tree, 'Qual foi a origem?').props.required, undefined, 'other description is optional');
  other.change('Qual foi a origem?', 'Evento da região'); await other.submit();
  assert.equal(JSON.parse(other.calls.at(-1).options.body).command.data.source, 'Outros: Evento da região'); other.unmount();
  const otherBare = harness(); await otherBare.open(); otherBare.select('Lead'); otherBare.change('Outros', 'Outros'); await otherBare.submit();
  assert.equal(JSON.parse(otherBare.calls.at(-1).options.body).command.data.source, 'Outros'); otherBare.unmount();
  const oldSource = harness({ snapshot: fixture({ source: 'Parceiro antigo' }) }); await oldSource.open(); oldSource.select('Iniciar atendimento');
  assert.equal(control(oldSource.tree, 'Parceiro antigo').props.checked, true, 'legacy origin stays visible and selected');
  await oldSource.submit(); assert.equal(JSON.parse(oldSource.calls.at(-1).options.body).command.data.source, undefined); oldSource.unmount();
  const oldOther = harness({ snapshot: fixture({ source: 'Outros: Feira local' }) }); await oldOther.open(); oldOther.select('Iniciar atendimento');
  assert.equal(control(oldOther.tree, 'Outros').props.checked, true);
  assert.equal(control(oldOther.tree, 'Qual foi a origem?').props.value, 'Feira local');
  assert.equal(nodes(oldOther.tree).filter(node => node.type === 'input' && node.props.type === 'radio' && node.props.value.startsWith('Outros')).length, 1);
  oldOther.unmount();
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

  const correction = harness({ snapshot: closedFixture(), props: { caseId, triggerAction: 'correct_close' } });
  await correction.open();
  assert(formNode(correction.tree), 'detail button opens correction directly after a fresh read');
  assert.equal(control(correction.tree, 'O que deseja corrigir?').props.value, 'edit');
  assert.equal(control(correction.tree, 'Valor correto').props.value, '500000');
  assert.equal(control(correction.tree, 'Condições corretas').props.value, 'Entrada de 20%');
  assert(!text(correction.tree).includes('Origem do cliente'), 'a closure correction cannot change acquisition source');
  await correction.submit(); assert.equal(correction.saved, 0, 'correction requires reason and explicit confirmation');
  correction.change('Valor correto', '480000'); correction.change('Condições corretas', 'Pagamento à vista'); correction.change('Motivo da correção', 'Valor digitado incorretamente'); correction.change('Conferi os dados e confirmo', true);
  await correction.submit();
  const correctionCommand = JSON.parse(correction.calls.at(-1).options.body).command;
  assert.equal(correctionCommand.action, 'correct_close');
  assert.deepEqual(correctionCommand.data, { mode: 'edit', proposalId: uuid(903), amount: 480000, conditions: 'Pagamento à vista', reason: 'Valor digitado incorretamente', confirmed: true }); correction.unmount();

  const reopening = harness({ snapshot: closedFixture() }); await reopening.open();
  assert.equal(menuItem(reopening.tree, 'Iniciar atendimento').props.disabled, true, 'normal registrations remain locked for closed cases');
  reopening.select('Editar fechamento'); reopening.change('O que deseja corrigir?', 'reopen');
  assert.match(text(reopening.tree), /Proposta, com situação Aberto/); assert.match(text(reopening.tree), /Proposta: Aceita → Em negociação/); assert.match(text(reopening.tree), /Imóvel: Vendido → Reservado/);
  reopening.change('Motivo da correção', 'Fechamento selecionado por engano'); reopening.change('Confirmo que o fechamento', true); await reopening.submit();
  assert.deepEqual(JSON.parse(reopening.calls.at(-1).options.body).command.data, { mode: 'reopen', proposalId: uuid(903), reason: 'Fechamento selecionado por engano', confirmed: true }); reopening.unmount();

  const limitedCorrection = harness({ snapshot: closedFixture({ role: 'broker' }) }); await limitedCorrection.open(); limitedCorrection.select('Editar fechamento');
  assert.equal(find(limitedCorrection.tree, node => node.type === 'option' && node.props.value === 'reopen').props.disabled, true, 'canonical property write permission is required to undo closing');
  assert.match(text(limitedCorrection.tree), /peça ao administrador/);
  limitedCorrection.change('Valor correto', '490000'); limitedCorrection.change('Motivo da correção', 'Ajuste de valor'); limitedCorrection.change('Conferi os dados e confirmo', true); await limitedCorrection.submit();
  assert.equal(JSON.parse(limitedCorrection.calls.at(-1).options.body).command.data.mode, 'edit', 'a broker with case/proposal access can still correct the recorded amount'); limitedCorrection.unmount();

  const classification = harness({ snapshot: closedFixture({ role: 'broker', legacyOnly: true }) }); await classification.open(); classification.select('Editar fechamento');
  assert.match(text(classification.tree), /voltará a Atendimento/); assert.match(text(classification.tree), /Nenhum imóvel será alterado/);
  assert.equal(control(classification.tree, 'Valor correto'), undefined);
  classification.change('Motivo da correção', 'Classificação antiga incorreta'); classification.change('Confirmo que a classificação', true); await classification.submit();
  assert.deepEqual(JSON.parse(classification.calls.at(-1).options.body).command.data, { mode: 'reopen', reason: 'Classificação antiga incorreta', confirmed: true }); classification.unmount();

  const noEvidence = harness({ snapshot: closedFixture({ withHistory: false }) }); await noEvidence.open(); noEvidence.select('Editar fechamento'); noEvidence.change('O que deseja corrigir?', 'reopen');
  assert.match(text(noEvidence.tree), /Situação anterior da proposta e do imóvel não comprovada/);
  assert(!text(noEvidence.tree).includes('Vendido → Reservado'), 'a previous inventory status is never invented'); noEvidence.unmount();
  let demoCorrectionState;
  const demoCorrection = harness({ props: { caseId, triggerAction: 'correct_close', demonstration: true, demoSnapshot: closedFixture(), onDemoSaved: state => { demoCorrectionState = state; } } });
  await demoCorrection.open(); demoCorrection.change('Valor correto', '470000'); demoCorrection.change('Motivo da correção', 'Conferência sintética'); demoCorrection.change('Conferi os dados e confirmo', true); await demoCorrection.submit();
  assert.equal(demoCorrection.calls.length, 0, 'a real closed demonstration snapshot is edited entirely locally');
  assert.equal(demoCorrectionState.records.find(item => item.id === uuid(903)).data.amount, 470000); assert.equal(demoCorrection.saved, 0); demoCorrection.unmount();

  let correctionFailed = true;
  const uncertainCorrection = harness({ snapshot: closedFixture(), response: call => call.options.method === 'POST' && correctionFailed ? Response.json({ error: 'Unknown result' }, { status: 503 }) : Response.json(closedFixture()) });
  await uncertainCorrection.open(); uncertainCorrection.select('Editar fechamento'); uncertainCorrection.change('Valor correto', '475000'); uncertainCorrection.change('Motivo da correção', 'Valor conferido no contrato'); uncertainCorrection.change('Conferi os dados e confirmo', true); await uncertainCorrection.submit();
  const uncertainCommand = JSON.parse(uncertainCorrection.calls.at(-1).options.body).command;
  assert.equal(find(uncertainCorrection.tree, node => node.type === 'fieldset').props.disabled, true);
  await button(uncertainCorrection.tree, 'Verificar dados atualizados').props.onClick(); await uncertainCorrection.settle();
  uncertainCorrection.change('Conferi os dados atualizados', true); correctionFailed = false; await uncertainCorrection.submit();
  assert.deepEqual(JSON.parse(uncertainCorrection.calls.at(-1).options.body).command, uncertainCommand, 'closure correction retries reuse the same UUID and exact payload'); uncertainCorrection.unmount();
  let resolveDirectRead;
  const dismissedDirect = harness({ props: { caseId, triggerAction: 'correct_close' }, response: () => new Promise(resolve => { resolveDirectRead = resolve; }) });
  trigger(dismissedDirect.tree).props.onClick(); dismissedDirect.render();
  cancelNestedDialog(dismissedDirect);
  resolveDirectRead(Response.json(closedFixture())); await dismissedDirect.settle();
  assert.equal(formNode(dismissedDirect.tree), undefined, 'a direct correction cannot reopen itself after the user cancels loading'); dismissedDirect.unmount();
  const idleCorrection = harness({ snapshot: closedFixture(), props: { caseId, triggerAction: 'correct_close' } }); await idleCorrection.open();
  cancelNestedDialog(idleCorrection);
  assert.equal(formNode(idleCorrection.tree), undefined, 'Escape while idle closes only the correction form');
  assert.equal(idleCorrection.calls.filter(call => call.options.method === 'POST').length, 0); idleCorrection.unmount();

  let resolvePost;
  const busy = harness({ response: call => call.options.method === 'POST' ? new Promise(resolve => { resolvePost = resolve; }) : Response.json(fixture()) });
  await busy.open(); busy.select('Iniciar atendimento');
  const submit = formNode(busy.tree).props.onSubmit;
  const inFlight = submit({ preventDefault() {} }); submit({ preventDefault() {} }); busy.render();
  assert.equal(busy.calls.filter(call => call.options.method === 'POST').length, 1, 'double click does not submit twice');
  assert.equal(submitButton(busy.tree).props.disabled, true);
  cancelNestedDialog(busy);
  assert(formNode(busy.tree), 'Escape during saving keeps the form and pending request mounted');
  assert.equal(busy.calls.find(call => call.options.method === 'POST').options.signal.aborted, false, 'nested Escape does not abort the active save');
  assert([...busy.timers.values()].some(timer => timer.ms === 15000), 'requests have a 15-second timeout');
  resolvePost(Response.json(fixture())); await inFlight; await busy.settle(); busy.unmount();

  let failed = true;
  const uncertain = harness({ response: call => call.options.method === 'POST' && failed ? Response.json({ error: 'Outcome unknown' }, { status: 503 }) : Response.json(fixture()) });
  await uncertain.open(); uncertain.select('Iniciar atendimento'); uncertain.change('Instagram', 'Instagram'); await uncertain.submit();
  assert.equal(uncertain.saved, 0); assert.equal(submitButton(uncertain.tree).props.disabled, true);
  assert.equal(find(uncertain.tree, node => node.type === 'fieldset').props.disabled, true, 'uncertain form is immutable until reconciled');
  const first = JSON.parse(uncertain.calls.find(call => call.options.method === 'POST').options.body).command;
  await button(uncertain.tree, 'Verificar dados atualizados').props.onClick(); await uncertain.settle();
  assert.equal(submitButton(uncertain.tree).props.disabled, true, 'refresh alone is not confirmation');
  uncertain.change('Conferi os dados', true);
  failed = false; await uncertain.submit();
  const second = JSON.parse(uncertain.calls.filter(call => call.options.method === 'POST')[1].options.body).command;
  assert.deepEqual(first, second, 'retry reuses identical request id and payload');
  assert.equal(first.data.source, 'Instagram', 'an uncertain write preserves its selected origin across retries');
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

  let sourceChangedElsewhere = false;
  const remoteSource = harness({ response: call => {
    if (call.options.method === 'POST' && !sourceChangedElsewhere) { sourceChangedElsewhere = true; return Response.json({ error: 'Changed' }, { status: 409 }); }
    return Response.json(fixture({ source: sourceChangedElsewhere ? 'Indicação' : 'WhatsApp' }));
  } });
  await remoteSource.open(); remoteSource.select('Iniciar atendimento'); await remoteSource.submit();
  assert.equal(control(remoteSource.tree, 'Indicação').props.checked, true, 'untouched origin follows the refreshed server snapshot after conflict');
  remoteSource.change('Conferi os dados', true); await remoteSource.submit();
  assert.equal(JSON.parse(remoteSource.calls.at(-1).options.body).command.data.source, undefined, 'review cannot overwrite a concurrent origin with a stale default'); remoteSource.unmount();
  let explicitConflict = true;
  const chosenSource = harness({ response: call => {
    if (call.options.method === 'POST' && explicitConflict) return Response.json({ error: 'Changed' }, { status: 409 });
    return Response.json(fixture({ source: 'Indicação' }));
  } });
  await chosenSource.open(); chosenSource.select('Iniciar atendimento'); chosenSource.change('Instagram', 'Instagram'); await chosenSource.submit();
  assert.equal(control(chosenSource.tree, 'Instagram').props.checked, true, 'an explicit draft choice is retained for review');
  assert.match(text(chosenSource.tree), /Origem atual: Indicação. Sua seleção: Instagram/, 'the current saved source is visible before confirming an overwrite');
  chosenSource.change('Conferi os dados', true); explicitConflict = false; await chosenSource.submit();
  assert.equal(JSON.parse(chosenSource.calls.at(-1).options.body).command.data.source, 'Instagram'); chosenSource.unmount();

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
  console.log('PASS registration UI: six explicit forms, one accessible origin choice, legacy origins preserved, optional Others detail, channel independent from origin, no demo network, closed/role guards, timeout and duplicate-click protection, preserved origin on idempotent retries and conflict reconciliation. Synthetic hooks and network only.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
