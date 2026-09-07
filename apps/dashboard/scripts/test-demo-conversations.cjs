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
    require: name => name === '@/lib/demo-conversations' ? load('lib/demo-conversations.ts') : require(name),
  });
  modules.set(file, module.exports);
  return module.exports;
}
const { demoContacts, createDemoConversationState, demoConversationReducer: reduce } = load('lib/demo-conversations.ts');
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
state = reduce(state, { type: 'assign', id: 'mariana' });
assert.equal(state.threads.mariana.humanMode, true);
assert.equal(state.threads.beatriz.humanMode, false);
assert.equal(reduce(state, { type: 'select', id: 'unknown' }), state);
console.log('PASS draft, unread count, assignment and outgoing messages isolated per contact; seed immutable');
const Component = load('app/conversation-center.tsx').default;
for (const contact of demoContacts) {
  const selectedState = reduce(state, { type: 'select', id: contact.id });
  const html = renderToStaticMarkup(createElement(Component, { state: selectedState, dispatch() {}, notify() {}, openAgenda() {} }));
  assert.ok(html.includes('perfis fictícios'));
  assert.ok(html.includes('Cliente fictício'));
  assert.ok(html.includes('Usar resposta'));
  assert.ok(html.includes(contact.messages[0].text));
  assert.ok(html.includes(contact.suggestion));
  assert.ok(!html.includes('Atendimento online'));
  assert.ok(!html.includes('✓✓'));
}
console.log('PASS all ten views render with their own dialogue, suggested response and clear demo labeling');
