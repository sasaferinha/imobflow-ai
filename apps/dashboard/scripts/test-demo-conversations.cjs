// Local fictional conversation examples: no database, contacts or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => name.startsWith('@/lib/') ? load(name.replace('@/', '') + '.ts') : name.startsWith('./') ? load(path.posix.join(path.posix.dirname(file),name+'.tsx')) : require(name),
  });
  modules.set(file, module.exports);
  return module.exports;
}
const { demoContacts, demoTemperature, createDemoConversationState, createLiveConversationState, demoConversationReducer: reduce } = load('lib/demo-conversations.ts');
assert.equal(demoTemperature(44), 'Frio');
assert.equal(demoTemperature(45), 'Morno');
assert.equal(demoTemperature(64), 'Morno');
assert.equal(demoTemperature(65), 'Quente');
assert.equal(demoTemperature(100), 'Quente');
assert.equal(new Set(demoContacts.map(contact => demoTemperature(contact.score))).size, 3);
assert.equal(demoContacts.find(contact => contact.id === 'ana').stage, 'Visita');
assert.equal(demoContacts.length, 10);
assert.equal(new Set(demoContacts.map(contact => contact.id)).size, 10);
assert.equal(new Set(demoContacts.map(contact => contact.messages.map(message => message.text).join(' '))).size, 10);
for (const name of ['Mariana Costa', 'Ricardo e Juliana', 'Beatriz Lima', 'Eduardo Nunes', 'João Almeida', 'Camila Rocha']) {
  assert.ok(demoContacts.find(contact => contact.name === name));
}
for (const contact of demoContacts) {
  for (const key of ['category', 'style', 'goal', 'propertyType', 'region', 'budget', 'rooms', 'payment', 'suggestion']) assert.ok(contact[key], contact.id + ':' + key);
  assert.ok(contact.messages.some(message => message.side === 'incoming'));
  assert.ok(contact.messages.some(message => message.side === 'outgoing'));
}
console.log('PASS all six requested profiles, four previous contacts and distinct complete conversations');
let state = createDemoConversationState();
const originalMarianaCount = state.threads.mariana.messages.length;
state = reduce(state, { type: 'draft', id: 'mariana', text: 'Resposta somente para Mariana' });
state = reduce(state, { type: 'select', id: 'beatriz' });
assert.equal(state.threads.beatriz.draft, '');
assert.equal(state.threads.beatriz.unread, 0);
assert.equal(state.threads.mariana.draft, 'Resposta somente para Mariana');
const beatrizThread = state.threads.beatriz;
state = reduce(state, { type: 'select', id: 'mariana' });
state = reduce(state, { type: 'send', id: 'mariana', messageId: 'sent-example', time: '14:00' });
assert.equal(state.threads.mariana.messages.length, originalMarianaCount + 1);
assert.equal(state.threads.mariana.messages.at(-1).side, 'outgoing');
assert.equal(state.threads.mariana.draft, '');
assert.equal(state.threads.beatriz, beatrizThread);
assert.equal(demoContacts[0].messages.length, originalMarianaCount);
const empty = reduce(state, { type: 'send', id: 'mariana', messageId: 'empty', time: '14:01' });
assert.equal(empty, state);
state = reduce(state, { type: 'assign', id: 'mariana', assignedTo: 'Corretor A' });
assert.equal(state.threads.mariana.assignedTo, 'Corretor A');
assert.equal(state.threads.mariana.humanMode, true);
assert.equal(state.threads.beatriz.humanMode, false);
assert.equal(reduce(state, { type: 'select', id: 'unknown' }), state);
console.log('PASS draft, unread count, assignment and outgoing messages isolated per contact; seed immutable');
const Component = load('app/conversation-center.tsx').default;
const emptyHtml = renderToStaticMarkup(createElement(Component, { state: createLiveConversationState(), dispatch() {}, notify() {}, openAgenda() {}, persistMessage: async () => ({}), refreshProperties: async () => {} }));
assert.ok(!emptyHtml.includes('Mariana Costa'));
assert.ok(emptyHtml.includes('Nenhuma conversa disponível'));
assert.ok(emptyHtml.includes('Clientes cadastrados'));
const liveLead = { id:'00000000-0000-4000-8000-000000000100', name:'Cliente Real', phone:'35999999999', email:null, goal:'Comprar', propertyType:'Casa', region:'Centro', budget:'Até R$ 500.000', details:null, summary:'Busca cadastrada', score:72, temperature:'Quente', source:'Formulário', assignedTo:null, lifecycleStatus:'Novo', lastContactAt:null, inactivityDays:0, recoveryPotential:'Baixo', scoreReasons:[], recoverySelected:false, createdAt:'2026-09-08T12:00:00.000Z' };
let liveState = reduce(createLiveConversationState(), { type:'sync', contacts:[{ id:`lead-${liveLead.id}`, unread:0 }] });
const liveHtml = renderToStaticMarkup(createElement(Component, { state: liveState, dispatch() {}, notify() {}, openAgenda() {}, persistMessage: async () => ({}), refreshProperties: async () => {}, leads:[liveLead], properties:[] }));
assert.ok(liveHtml.includes('Cliente Real'));
assert.ok(liveHtml.includes('Dados do banco de leads'));
assert.ok(liveHtml.includes('Usar resposta'));
assert.ok(!liveHtml.includes('Mariana Costa'));
console.log('PASS production conversation view renders only persisted leads and a truthful empty state');

let shared = reduce(state, { type: 'draft', id: 'mariana', text: 'Rascunho do administrador' });
const received = [...shared.threads.mariana.messages, { id:'broker-message', side:'outgoing', text:'Mensagem do corretor', time:'15:00' }];
shared = reduce(shared, { type:'hydrate', contacts:[{ id:'mariana', revision:5, assignedTo:'Corretor B', assignedBrokerId:'broker-b', messages:received }] });
assert.equal(shared.threads.mariana.assignedTo, 'Corretor B');
assert.equal(shared.threads.mariana.draft, 'Rascunho do administrador');
shared = reduce(shared, { type:'hydrate', contacts:[{ id:'mariana', revision:4, assignedTo:null, messages:[] }] });
assert.equal(shared.threads.mariana.assignedTo, 'Corretor B');
assert.equal(shared.threads.mariana.messages.length, received.length);
shared = reduce(shared, { type:'send', id:'mariana', messageId:'broker-message', text:'Mensagem do corretor', time:'15:00' });
assert.equal(shared.threads.mariana.messages.length, received.length);
assert.equal(shared.threads.mariana.draft, 'Rascunho do administrador');
console.log('PASS shared assignment, stale revision rejection, draft preservation and message deduplication');
