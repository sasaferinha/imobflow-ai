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
    require: name => name.startsWith('@/lib/') ? load(name.replace('@/', '') + '.ts') : name.startsWith('./') ? load(path.posix.join(path.posix.dirname(file),name+(file.endsWith('.tsx')?'.tsx':'.ts'))) : require(name),
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
for (const html of [emptyHtml, liveHtml]) {
  assert.ok(!html.includes('conversation-temperature-guide'), 'the removed temperature explainer never returns');
}
assert.match(liveHtml, /aria-expanded="true" aria-controls="conversation-client-profile"/, 'essential profile starts visible with an accessible toggle');
assert.doesNotMatch(liveHtml, /id="conversation-client-profile" hidden/, 'score and preferences must not require opening the profile');
assert.match(liveHtml, /<details class="conversation-lead-details conversation-extra-details"/, 'secondary details stay collapsed');
const essentialProfile = liveHtml.split('id="conversation-client-profile"')[1].split('<details')[0];
for (const value of ['Score do lead', 'Indefinido', 'Objetivo', 'Comprar', 'Tipo de imóvel', 'Casa', 'Região / bairro', 'Centro', 'Investimento', 'Até R$ 500.000']) assert.ok(essentialProfile.includes(value), `${value} visible in essential profile`);
assert.ok(!essentialProfile.includes('conversation-classifications'), 'do not restore additional badges in the default profile');
assert.match(liveHtml, /<details class="conversation-quick-reply"/, 'suggested replies start collapsed');
assert.ok(!liveHtml.includes('aria-label="Anexos"'), 'do not display a nonfunctional attachment control');
assert.ok(liveHtml.includes('Status não confirmado'), 'unknown attendance must remain visible');
assert.ok(liveHtml.includes('Usar resposta'));
assert.ok(!liveHtml.includes('Mariana Costa'));
console.log('PASS production conversation view renders only persisted leads and a truthful empty state');
const ownedLead = { ...liveLead, scoreDefined: true, details: '2 quartos, aceita financiamento', assignedTo: 'Corretor antigo' };
const ownedThread = { ...liveState.threads[`lead-${liveLead.id}`], attendance: { attendanceMode: 'human', assignedTo: 'Marina Alves', assignedBrokerId: 'broker-marina' } };
function renderOwner(thread, lead = ownedLead) {
  return renderToStaticMarkup(createElement(Component, { state: { ...liveState, threads: { [`lead-${liveLead.id}`]: thread } }, dispatch() {}, notify() {}, openAgenda() {}, persistMessage: async () => ({}), refreshProperties: async () => {}, leads: [lead], properties: [], currentBrokerId: 'broker-marina', currentBrokerName: 'Marina Alves' }));
}
const ownedHtml = renderOwner(ownedThread);
assert.match(ownedHtml, /72\/100/);
assert.match(ownedHtml, /2 quartos, aceita financiamento/);
assert.match(ownedHtml, /Corretor responsável: Marina Alves \(você\)/);
assert.match(ownedHtml, /Corretor: Marina Alves/);
assert.doesNotMatch(ownedHtml, /Corretor antigo/);
const releasedHtml = renderOwner({ ...ownedThread, attendance: { attendanceMode: 'automatic', assignedTo: null, assignedBrokerId: null } });
assert.match(releasedHtml, /Sem corretor responsável/);
assert.doesNotMatch(releasedHtml, /Corretor responsável: Marina Alves|Corretor: Marina Alves|Corretor antigo/);
console.log('PASS visible score, property preferences and named broker; confirmed release clears stale owner');
const registrationText = 'Lead criado automaticamente a partir de uma mensagem recebida no WhatsApp.';
for (const details of [registrationText, registrationText.toUpperCase().replace(/ /g, '  ')]) {
  const html = renderOwner(ownedThread, { ...ownedLead, details });
  const profile = html.split('id="conversation-client-profile"')[1];
  assert.ok(!profile.split('<details')[0].includes(details), 'registration metadata does not masquerade as a preference');
  assert.ok(profile.split('<details')[1].includes(details), 'original registration metadata remains available in additional details');
}
const mixedText = `${registrationText} Precisa de 3 quartos.`;
assert.ok(renderOwner(ownedThread, { ...ownedLead, details: mixedText }).split('id="conversation-client-profile"')[1].split('<details')[0].includes(mixedText), 'never hide real preferences mixed with registration text');
assert.match(ownedHtml, /<dl class="conversation-lead-highlights"/);
console.log('PASS semantic customer details, understated score and preserved registration metadata');

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
