const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const owner = { companyId: 'operations-ui-test', brokerId: 'owner-test', name: 'Gestor fictício', role: 'owner' };
const broker = { ...owner, brokerId: 'broker-test', name: 'Corretor fictício', role: 'broker' };
function runtime(react = React, env = {}) {
  const modules = new Map();
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const file = path.join(root, relative), module = { exports: {} };
    let source = fs.readFileSync(file, 'utf8');
    if (relative.endsWith('evolution-client.tsx')) source += '\nexport { RecordEditor, RecordDetail };';
    const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
    const requireLocal = id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.css')) return css;
      if (id.startsWith('.') || id.startsWith('@/')) {
        const base = id.startsWith('@/') ? id.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(relative), id));
        const target = ['.ts', '.tsx'].find(ext => fs.existsSync(path.join(root, base + ext)));
        if (target) return load(base + target);
      }
      throw new Error(`Unexpected dependency: ${id}`);
    };
    vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: requireLocal, crypto, structuredClone, Date, Intl, console, URL, Blob, ...env }, { filename: file });
    modules.set(relative, module.exports); return module.exports;
  }
  return { load };
}
const server = runtime();
const model = server.load('lib/evolution/model.ts');
const operations = server.load('app/evolution/operations-center.tsx');
const { RecordEditor, RecordDetail } = server.load('app/evolution/evolution-client.tsx');
const state = model.emptyState(owner.companyId);
state.members = [{ id: owner.brokerId, name: owner.name, role: 'owner', specialization: 'Ambos' }, { id: broker.brokerId, name: broker.name, role: 'broker', specialization: 'Ambos' }, { id: 'other-broker', name: 'Outro corretor fictício', role: 'broker', specialization: 'Venda' }];
const now = new Date().toISOString(), past = new Date(Date.now() - 86400000).toISOString();
function record(id, kind, data) { return { id, kind, data, createdAt: now, updatedAt: now, createdBy: owner.brokerId }; }
state.records.push(record('followup-one', 'followups', { name: 'Retorno de teste', assignedTo: broker.brokerId, dueAt: past, priority: 'Alta', status: 'Pendente', request: 'Atualize o atendimento fictício.', response: '', review: '' }), record('followup-other', 'followups', { name: 'Cobrança de outra carteira', assignedTo: 'other-broker', dueAt: past, priority: 'Normal', status: 'Pendente', request: 'Não visível a outro corretor.' }), record('lead-one', 'leads', { name: 'Lead fictício incompleto', assignedTo: broker.brokerId, purpose: 'Venda', status: 'Pendente' }), record('goal-one', 'captureGoals', { name: 'Meta fictícia', assignedTo: broker.brokerId, month: now.slice(0, 7), purpose: 'Venda', target: 3 }), record('shift-one', 'shifts', { name: 'Plantão fictício', assignedTo: broker.brokerId, startsAt: past, endsAt: new Date(Date.now() + 86400000).toISOString(), purpose: 'Ambos', status: 'Ativo' }), record('report-one', 'notices', { name: 'Resumo semanal · 2026-10-05', text: 'Contagem agregada fictícia.' }));
const props = { state, actor: owner, busy: false, onCreate() {}, onSelect() {}, onEdit() {}, execute: async () => true };
const markup = renderToStaticMarkup(React.createElement(operations.default, props));
assert(markup.includes('Nova cobrança'));
assert(markup.includes('Central') === false, 'Operations component is composed into the existing shell, not a second navigation shell.');
assert(markup.includes('Cobranças vencidas'));
assert(markup.includes('Ativar lembretes do navegador'));
const brokerState = model.visibleState(state, broker);
const brokerMarkup = renderToStaticMarkup(React.createElement(operations.default, { ...props, state: brokerState, actor: broker }));
assert(!brokerMarkup.includes('Nova cobrança'));
assert(!brokerMarkup.includes('Cobrança de outra carteira'));
assert(!brokerMarkup.includes('Redistribuição'));
assert(brokerMarkup.includes('Responder ao gestor'));
const previewMarkup = renderToStaticMarkup(React.createElement(operations.default, { ...props, preview: true }));
assert(previewMarkup.includes('Dados fictícios de demonstração'));
assert(!previewMarkup.includes('Dados reais da carteira autorizada'));
assert(/<button[^>]*disabled=""[^>]*>Ativar lembretes do navegador<\/button>/.test(previewMarkup));

function text(node) { if (node == null || typeof node === 'boolean') return ''; if (Array.isArray(node)) return node.map(text).join(''); return typeof node === 'object' ? text(node.props?.children) : String(node); }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);
function harness(file, exportName, componentProps) {
  let cursor = 0, tree;
  const slots = [], commands = [], calls = [];
  const react = { ...React, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; }, useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); }, useMemo(compute) { return compute(); }, useEffect() {} };
  const Component = runtime(react, { window: {}, document: {} }).load(file)[exportName];
  const allProps = { ...componentProps, execute: async command => { commands.push(command); return true; }, onCreate: (...args) => calls.push(['create', ...args]), onEdit: (...args) => calls.push(['edit', ...args]), onSelect: (...args) => calls.push(['select', ...args]), onSave: async data => calls.push(['save', data]) };
  const render = () => { cursor = 0; tree = Component(allProps); return tree; };
  render(); return { render, get tree() { return tree; }, commands, calls };
}
const central = harness('app/evolution/operations-center.tsx', 'default', props);
button(central.tree, '+ Nova cobrança').props.onClick();
assert.equal(central.calls[0][1], 'followups');
button(central.tree, 'Metas de captação').props.onClick(); central.render();
assert(text(central.tree).includes('Faltam 3 imóveis'));
button(central.tree, 'Solicitar atualização').props.onClick();
assert.equal(central.calls.at(-1)[1], 'followups');
assert.equal(central.calls.at(-1)[2].assignedTo, broker.brokerId);
button(central.tree, 'Plantões').props.onClick(); central.render();
assert(text(central.tree).includes('Em plantão agora'));
button(central.tree, 'Resumo semanal').props.onClick(); central.render();
assert(text(central.tree).includes('Resumo semanal · 2026-10-05'));
assert(text(central.tree).includes('Exportar resumo CSV'));
button(central.tree, 'Qualidade da carteira').props.onClick(); central.render();
assert(text(central.tree).includes('Lead fictício incompleto'));
button(central.tree, 'Completar cadastro').props.onClick();
assert.equal(central.calls.at(-1)[0], 'edit');

const reply = harness('app/evolution/evolution-client.tsx', 'RecordEditor', { editor: { kind: 'followups', record: state.records[0] }, state: brokerState, actor: broker, busy: false, error: '', onClose() {} });
assert(!find(reply.tree, node => node.props?.id === 'edit-request'));
assert(!find(reply.tree, node => node.props?.id === 'edit-dueAt'));
assert(!find(reply.tree, node => node.props?.id === 'edit-assignedTo'));
assert(!find(reply.tree, node => node.type === 'option' && text(node) === 'Concluída'));
find(reply.tree, node => node.props?.id === 'edit-response').props.onChange({ target: { value: 'Retorno fictício concluído.' } }); reply.render();
find(reply.tree, node => node.props?.id === 'edit-status').props.onChange({ target: { value: 'Respondida' } }); reply.render();
find(reply.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
assert.deepEqual(Object.keys(reply.calls.at(-1)[1]).sort(), ['response', 'status']);
assert.equal(reply.calls.at(-1)[1].response, 'Retorno fictício concluído.');
assert.equal(reply.calls.at(-1)[1].status, 'Respondida');

const newLead = renderToStaticMarkup(React.createElement(RecordEditor, { editor: { kind: 'leads' }, state, actor: owner, busy: false, error: '', onClose() {}, onSave() {} }));
assert(newLead.includes('O imóvel que o cliente procura'));
assert(newLead.includes('Orçamento e qualificação'));
assert(!/<option selected="">À vista<\/option>/.test(newLead), 'Unknown financing must not be prefilled as cash.');
const finished = { ...state.records[0], data: { ...state.records[0].data, status: 'Concluída', response: 'Retorno fictício', review: 'Conferido' } };
const detail = renderToStaticMarkup(React.createElement(RecordDetail, { record: finished, state, actor: owner, busy: false, error: '', onClose() {}, onEdit() {}, onCreate() {}, onSelect() {}, execute() {} }));
assert(!detail.includes('>Editar</button>'), 'Closed accountability history must not offer edit.');

const settings = harness('app/evolution/operations-center.tsx', 'OperationsSettings', { state, busy: false, isAdmin: true });
assert(text(settings.tree).includes('Gerar resumo semanal no mural da equipe'));
assert(text(settings.tree).includes('Não realiza transferências automaticamente'));
const weeklyLabel = find(settings.tree, node => node.type === 'label' && text(node).includes('Gerar resumo semanal'));
const weeklyInput = find(weeklyLabel, node => node.type === 'input');
assert.equal(weeklyInput.props.checked, false);
weeklyInput.props.onChange({ target: { checked: true } }); settings.render();
find(settings.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
assert.equal(settings.commands[0].settings.operations.weeklyReportsEnabled, true);
assert.equal(settings.commands[0].settings.operations.reassignmentEnabled, false);
const csv = operations.operationsCsv([['=HYPERLINK("https://example.test")', ' +SUM(1)', '@bad', '-bad', 'Texto; com "aspas"', 3]]);
assert(csv.startsWith('\ufeff'));
assert(csv.includes('"\'=HYPERLINK'));
assert(csv.includes('"\' +SUM(1)"'));
assert(csv.includes('"\'@bad"'));
assert(csv.includes('Texto; com ""aspas""'));
assert(csv.endsWith(';"3"'));
console.log('PASS operations UI: scoped owner/broker controls; followup response-only payload; no closed edit; live catalog sections; no invented qualification; goals/shift/report navigation; internal-weekly opt-in; spreadsheet-safe CSV.');
