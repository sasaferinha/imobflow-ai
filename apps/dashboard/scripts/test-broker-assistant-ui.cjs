const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const css = new Proxy({}, { get: (_, name) => String(name) });
const jsx = (type, props) => ({ type, props: props || {} });
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : []; }
function text(tree) { return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join(' ') : ''; }
function find(tree, predicate) { return nodes(tree).find(predicate); }
function button(tree, label) { return find(tree, node => node.type === 'button' && text(node).trim() === label); }
const result = () => ({ assistance: { reply: 'Sugestão que deve ser revisada.', explanation: 'Só texto explícito.', changes: [{ field: 'region', value: 'Centro', messageId: uuid(40), evidence: 'Procuro no Centro.' }], missing: ['budgetMax'] }, review: { record: { id: `lead:${uuid(30)}`, kind: 'leads', data: { region: 'Outro bairro', purpose: 'Venda', notes: 'Preserve existing field' } }, expectedVersion: 8, expectedSourceRevision: 'source-eight' }, messageCount: 3 });
function harness(file, input, { demo = false, response, globals = {} } = {}) {
  const slots = [], effects = [], calls = []; let index = 0, tree;
  const React = {
    useState(initial) { const current = index++; if (!(current in slots)) slots[current] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[current].value, value => { slots[current].value = typeof value === 'function' ? value(slots[current].value) : value; }]; },
    useRef(initial) { const current = index++; if (!(current in slots)) slots[current] = { current: initial }; return slots[current]; },
    useId() { return `test-${index++}`; },
    useEffect(callback, dependencies) { const current = index++, previous = slots[current]; if (!previous || !dependencies || dependencies.some((value, i) => value !== previous.dependencies?.[i])) effects.push(() => { previous?.cleanup?.(); slots[current] = { dependencies, cleanup: callback() }; }); },
  };
  const module = { exports: {} };
  const dependencies = {
    react: React, 'react/jsx-runtime': { jsx, jsxs: jsx }, './conversation-assistant.module.css': css,
    '@/lib/dashboard-transport': { isProductDemo: () => demo, dashboardFetch: async (url, options) => { calls.push({ url, options }); return response ? response(url, options) : Response.json(result()); } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module, exports: module.exports, require: name => { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected UI import ${name}`); }, AbortController, Date, Intl, Map, console, ...globals });
  const Component = module.exports.default;
  const render = () => {
    index = 0; tree = Component(input);
    for (const node of nodes(tree)) if (node.props.ref && typeof node.props.ref === 'object') node.props.ref.current ||= { focus() {}, open: false, showModal() { this.open = true; }, close() { this.open = false; } };
    while (effects.length) effects.shift()();
    return tree;
  };
  render();
  return {
    input, calls, render, get tree() { return tree; },
    async settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); render(); },
    async click(label) { const target = button(tree, label); assert(target, `missing ${label}`); assert(!target.props.disabled, `disabled ${label}`); target.props.onClick(); render(); await this.settle(); },
    change(field, value) { field.props.onChange({ target: { value, checked: value } }); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
(async () => {
  const uses = [], saved = [], notices = [];
  const props = { leadId: uuid(30), customerName: 'Cliente fictício', onUseReply: text => uses.push(text), onSaved: () => saved.push(true), notify: text => notices.push(text) };
  const ui = harness('app/conversation-assistant.tsx', props, { response: async (url, options) => url === '/api/evolution'
    ? Response.json({ state: { records: [{ ...result().review.record, data: JSON.parse(options.body).command.data }] } }) : Response.json(result()) });
  assert.equal(nodes(ui.tree).filter(node => node.type === 'button').length, 1);
  assert.equal(ui.calls.length, 0); await ui.click('Assistente'); assert.equal(ui.calls.length, 0, 'Opening dialog never sends conversation to provider');
  assert.match(text(ui.tree), /provedor de IA/); await ui.click('Analisar conversa'); assert.equal(ui.calls[0].url, '/api/conversations/assist');
  assert.deepEqual(JSON.parse(ui.calls[0].options.body), { leadId: uuid(30), sector: 'automatic' });
  assert.equal(button(ui.tree, 'Salvar dados revisados').props.disabled, true, 'Changes are not preapproved');
  assert.equal(uses.length, 0); assert.equal(saved.length, 0);
  ui.change(find(ui.tree, node => node.props.type === 'checkbox'), true); await ui.click('Salvar dados revisados');
  assert.equal(saved.length, 1); assert.equal(ui.calls.at(-1).url, '/api/evolution');
  const command = JSON.parse(ui.calls.at(-1).options.body);
  assert.equal(command.expectedVersion, 8); assert.equal(command.expectedSourceRevision, 'source-eight');
  assert.deepEqual(command.command.data, { region: 'Centro', purpose: 'Venda', notes: 'Preserve existing field' });
  assert.equal(command.command.type, 'save'); assert.equal(button(ui.tree, 'Ficha atualizada').props.disabled, true);
  ui.change(find(ui.tree, node => node.type === 'textarea'), 'Resposta editada'); await ui.click('Adicionar ao rascunho');
  assert.deepEqual(uses, ['Resposta editada']); assert.equal(find(ui.tree, node => node.type === 'dialog'), undefined);
  assert.ok(ui.calls.every(call => call.url !== '/api/conversations'), 'No send endpoint');
  ui.unmount();

  for (const options of [{ demo: true }, {}]) {
    const sim = harness('app/conversation-assistant.tsx', { ...props, demonstration: !options.demo }, options);
    await sim.click('Assistente'); await sim.click('Analisar conversa'); sim.change(find(sim.tree, node => node.props.type === 'checkbox'), true);
    await sim.click('Simular atualização da ficha'); assert.equal(sim.calls.length, 0); assert.equal(saved.length, 1);
    assert.match(text(sim.tree), /simulada/); sim.unmount();
  }
  const conflict = harness('app/conversation-assistant.tsx', props, { response: async url => url === '/api/evolution' ? Response.json({ error: 'Outra alteração foi salva.' }, { status: 409 }) : Response.json(result()) });
  await conflict.click('Assistente'); await conflict.click('Analisar conversa'); conflict.change(find(conflict.tree, node => node.props.type === 'checkbox'), true);
  await conflict.click('Salvar dados revisados'); assert.match(text(conflict.tree), /Confira a ficha ou analise novamente/); assert.equal(button(conflict.tree, 'Salvar dados revisados').props.disabled, true);
  await conflict.click('Analisar novamente'); assert.equal(find(conflict.tree, node => node.props.type === 'checkbox').props.checked, false);
  conflict.unmount();
  let release;
  const slow = harness('app/conversation-assistant.tsx', props, { response: () => new Promise(resolve => { release = resolve; }) });
  await slow.click('Assistente'); await slow.click('Analisar conversa'); await slow.click('Fechar');
  assert.equal(slow.calls[0].options.signal.aborted, true); release(Response.json(result())); await slow.settle();
  assert.equal(find(slow.tree, node => node.type === 'dialog'), undefined, 'Late response cannot reopen dialog'); slow.unmount();
  console.log('PASS assistant UI: lazy explicit generation, sector contract, unchecked evidence review, CAS profile save, duplicate lock, conflict recovery, editable draft only, abort on close, isolated synthetic demonstration');

  const notifications = []; let permissions = 0;
  class Notification {
    static permission = 'default';
    static async requestPermission() { permissions++; Notification.permission = 'granted'; return 'granted'; }
    constructor(title, options) { notifications.push({ title, options }); }
    close() {}
  }
  const original = { conversationId: 'one', leadId: 'lead', incomingCount: 3, unread: 3, lastMessageAt: new Date().toISOString(), lastMessageText: 'Private text not disclosed', lastMessageId: 'old' };
  const alerts = harness('app/conversation-alerts.tsx', { inbox: [original], ready: true }, { globals: { Notification, window: { isSecureContext: true, focus() {} } } });
  assert.equal(permissions, 0); assert.equal(notifications.length, 0);
  find(alerts.tree, node => node.type === 'button').props.onClick(); await alerts.settle();
  assert.equal(permissions, 1); assert.equal(notifications.length, 0, 'Never alert old unread on activation');
  alerts.input.inbox = [{ ...original, incomingCount: 4, unread: 4 }]; alerts.render();
  assert.equal(notifications.length, 1); assert.doesNotMatch(JSON.stringify(notifications), /Private text|lead/);
  alerts.input.inbox = [{ ...original, incomingCount: 4, unread: 4 }]; alerts.render(); assert.equal(notifications.length, 1, 'No duplicate on repeated snapshot');
  alerts.input.inbox = [{ ...original, incomingCount: 4, unread: 0 }]; alerts.render(); assert.equal(notifications.length, 1, 'Reading cannot generate notification');
  find(alerts.tree, node => node.type === 'button').props.onClick(); await alerts.settle();
  alerts.input.inbox = [{ ...original, incomingCount: 5 }]; alerts.render(); assert.equal(notifications.length, 1); alerts.unmount();
  const unsupported = harness('app/conversation-alerts.tsx', { inbox: [], ready: true }, { globals: { window: { isSecureContext: true } } });
  find(unsupported.tree, node => node.type === 'button').props.onClick(); await unsupported.settle(); assert.match(text(unsupported.tree), /não oferece alertas/); unsupported.unmount();
  const demo = harness('app/conversation-alerts.tsx', { inbox: [original], ready: true, demonstration: true }); assert.equal(demo.tree, null); demo.unmount();
  console.log('PASS browser alerts: explicit user permission, activation baseline, only new unread arrivals, no duplicate/old/read alerts, privacy-safe content, disable and unsupported/demo guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
