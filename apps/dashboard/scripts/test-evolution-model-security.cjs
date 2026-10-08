const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, require: name => name.startsWith('.') ? load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`) : require(name),
    crypto: crypto.webcrypto, structuredClone, Date, URL, console,
  });
  cache.set(file, mod.exports); return mod.exports;
}
const model = load('lib/evolution/model.ts');
const now = '2026-10-07T18:00:00.000Z';
const owner = { companyId: 'company-1', brokerId: 'owner', name: 'Admin sintético', role: 'owner' };
const brokerA = { ...owner, brokerId: 'broker-a', name: 'Corretor A', role: 'broker' };
const brokerB = { ...owner, brokerId: 'broker-b', name: 'Corretor B', role: 'broker' };
const member = actor => ({ id: actor.brokerId, name: actor.name, role: actor.role, specialization: 'Ambos' });
const save = (state, actor, kind, data, id) => model.applyCommand(state, actor, { type: 'save', kind, data, ...(id ? { id } : {}) }, now);
function fixture() {
  let state = model.emptyState(owner.companyId); state.members = [member(owner), member(brokerA), member(brokerB)];
  const add = (kind, data) => { state = save(state, owner, kind, data); return state.records.at(-1).id; };
  const personA = add('people', { name: 'Cliente A', personType: 'Pessoa física', category: 'Cliente', phone: '553599990001', assignedTo: brokerA.brokerId });
  const personB = add('people', { name: 'Cliente B', personType: 'Pessoa física', category: 'Cliente', phone: '553599990002', assignedTo: brokerB.brokerId });
  const propertyA = add('properties', { name: 'Imóvel A', code: 'TEST-A', purpose: 'Venda', price: 450000, status: 'Disponível', assignedTo: brokerA.brokerId, ownerId: personA });
  const propertyB = add('properties', { name: 'Imóvel B', code: 'TEST-B', purpose: 'Venda', price: 480000, status: 'Disponível', assignedTo: brokerB.brokerId, ownerId: personB });
  const caseA = add('cases', { name: 'Atendimento A', personId: personA, source: 'Site', assignedTo: brokerA.brokerId, purpose: 'Venda', journey: 'Negociação', stage: 'Lead', status: 'Aberto', propertyId: propertyA });
  const caseB = add('cases', { name: 'Atendimento B', personId: personB, source: 'Site', assignedTo: brokerB.brokerId, purpose: 'Venda', journey: 'Negociação', stage: 'Lead', status: 'Aberto', propertyId: propertyB });
  return { state, personA, personB, propertyA, propertyB, caseA, caseB };
}
const proposal = values => ({ name: 'Proposta sintética', amount: 440000, conditions: 'Condição de teste', expiresAt: '2026-10-30', status: 'Rascunho', ...values });
const task = values => ({ name: 'Tarefa sintética', assignedTo: brokerA.brokerId, type: 'Tarefa', dueAt: '2026-10-08T14:30', priority: 'Normal', status: 'Pendente', ...values });
const rejected = fn => assert.throws(fn, error => error instanceof model.CrmError && [400, 403, 404, 409, 413].includes(error.status));
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('Unauthenticated actor, forged owner role and foreign company cannot enter model boundaries', () => {
  const { state } = fixture();
  for (const actor of [{ ...owner, brokerId: 'missing' }, { ...brokerA, role: 'owner' }, { ...owner, companyId: 'other-company' }]) {
    rejected(() => model.visibleState(state, actor));
    rejected(() => model.applyCommand(state, actor, { type: 'settings', settings: { sources: ['Fake'] } }));
  }
});

test('Read-only case grants carry only necessary related context, not edit rights or unrelated contacts', () => {
  let { state, caseB, personB } = fixture();
  state = save(state, owner, 'people', { name: 'Cliente sem vínculo', personType: 'Pessoa física', category: 'Cliente', phone: '553599990099', assignedTo: brokerB.brokerId });
  const unrelated = state.records.at(-1).id;
  state.members.find(item => item.id === brokerA.brokerId).permissions = { cases: { readOthers: true, editOthers: false } };
  const visible = model.visibleState(state, brokerA);
  assert.ok(visible.records.some(record => record.id === caseB));
  assert.ok(visible.records.some(record => record.id === personB));
  assert.ok(!visible.records.some(record => record.id === unrelated));
  assert.ok(!JSON.stringify(visible).includes('553599990099'));
  rejected(() => save(state, brokerA, 'cases', { notes: 'Forbidden' }, caseB));
  rejected(() => save(state, brokerA, 'people', { phone: 'Forbidden' }, personB));
});

test('Broker cannot reassign a case or create a task assigned to another broker', () => {
  const { state, caseA, propertyB } = fixture();
  rejected(() => save(state, brokerA, 'cases', { assignedTo: brokerB.brokerId }, caseA));
  rejected(() => save(state, brokerA, 'tasks', task({ caseId: caseA, assignedTo: brokerB.brokerId })));
  rejected(() => save(state, brokerA, 'cases', { propertyId: propertyB }, caseA));
});

test('Task assignment cannot silently create a task invisible to its responsible broker', () => {
  const { state, caseA } = fixture();
  let next;
  try { next = save(state, owner, 'tasks', task({ caseId: caseA, assignedTo: brokerB.brokerId })); }
  catch (error) { assert.ok(error instanceof model.CrmError); return; }
  const created = next.records.at(-1);
  assert.ok(model.visibleState(next, brokerB).records.some(record => record.id === created.id), 'accepted task must be visible to its assignee; otherwise reject cross-portfolio assignment');
});

test('Case reassignment supplies related read context without granting contact edit authority', () => {
  const { state, caseA, personA } = fixture();
  let next;
  try { next = save(state, owner, 'cases', { assignedTo: brokerB.brokerId }, caseA); }
  catch (error) { assert.ok(error instanceof model.CrmError); return; }
  const edited = save(next, brokerB, 'cases', { notes: 'Atualização do responsável' }, caseA);
  assert.equal(edited.records.find(record => record.id === caseA).data.notes, 'Atualização do responsável');
  assert.ok(model.visibleState(edited, brokerB).records.some(record => record.id === personA));
  rejected(() => save(edited, brokerB, 'people', { phone: 'Forbidden' }, personA));
});

test('Real calendar validation rejects normalized impossible proposal dates', () => {
  const { state, caseA, propertyA } = fixture();
  for (const expiresAt of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01']) {
    rejected(() => save(state, owner, 'proposals', proposal({ caseId: caseA, propertyId: propertyA, expiresAt })));
  }
  assert.ok(save(state, owner, 'proposals', proposal({ caseId: caseA, propertyId: propertyA, expiresAt: '2028-02-29' })));
});

test('Real calendar validation rejects impossible activity dates without changing the source state', () => {
  const { state, caseA } = fixture(); const before = JSON.stringify(state);
  for (const dueAt of ['2026-02-30T10:00', '2026-04-31T12:30', '2026-10-08T25:00']) rejected(() => save(state, owner, 'tasks', task({ caseId: caseA, dueAt })));
  assert.equal(JSON.stringify(state), before);
});

test('Completed financial classification cannot be rewritten through the case', () => {
  const { state, caseA, propertyA, propertyB } = fixture();
  const won = save(state, owner, 'proposals', proposal({ caseId: caseA, propertyId: propertyA, status: 'Aceita' }));
  assert.equal(won.records.find(record => record.id === caseA).data.status, 'Ganho');
  for (const data of [{ purpose: 'Aluguel' }, { assignedTo: brokerB.brokerId }, { propertyId: propertyB }]) rejected(() => save(won, owner, 'cases', data, caseA));
  const accepted = won.records.find(record => record.kind === 'proposals');
  rejected(() => save(won, owner, 'proposals', { amount: 1 }, accepted.id));
  rejected(() => save(won, owner, 'proposals', { status: 'Rascunho' }, accepted.id));
});

test('Proposal is allowed without a prior visit and closes proposal/case/property atomically', () => {
  const { state, caseA, propertyA } = fixture();
  const next = save(state, brokerA, 'proposals', proposal({ caseId: caseA, propertyId: propertyA, status: 'Aceita' }));
  assert.equal(next.records.find(record => record.id === caseA).data.stage, 'Negociado');
  assert.equal(next.records.find(record => record.id === propertyA).data.status, 'Vendido');
  assert.equal(next.records.filter(record => record.kind === 'tasks').length, 0);
  assert.equal(next.events.length, state.events.length + 3);
  assert.equal(state.records.find(record => record.id === propertyA).data.status, 'Disponível');
});

test('Dangerous URLs and client-controlled audit fields are rejected', () => {
  const { state, caseA } = fixture();
  for (const url of ['javascript:alert(1)', 'data:text/html,attack', 'file:///etc/passwd']) rejected(() => save(state, owner, 'links', { name: 'Attack', url }));
  for (const key of ['createdAt', 'updatedAt', 'stageEnteredAt', 'acceptedAt', 'createdBy']) rejected(() => save(state, owner, 'cases', { [key]: now }, caseA));
  assert.ok(save(state, owner, 'links', { name: 'Link seguro', url: 'https://example.test' }));
});

test('Private notes remain private even from admin and receipt is not mutation authority', () => {
  const { state } = fixture();
  const noted = save(state, brokerA, 'notes', { name: 'Nota privada', text: 'Conteúdo privado de A' });
  const noteId = noted.records.at(-1).id;
  rejected(() => save(noted, owner, 'notes', { text: 'Admin edit' }, noteId));
  assert.ok(!model.visibleState(noted, owner).records.some(record => record.id === noteId));
  const messaged = save(noted, brokerA, 'messages', { name: 'Recado', text: 'Mensagem interna', recipientId: brokerB.brokerId });
  const messageId = messaged.records.at(-1).id;
  assert.ok(model.visibleState(messaged, brokerB).records.some(record => record.id === messageId));
  rejected(() => save(messaged, brokerB, 'messages', { text: 'Recipient edit' }, messageId));
});

test('Key loans retain real checkout/return history and reject double checkout or changing the key identity', () => {
  const { state, propertyA, propertyB } = fixture();
  const input = { name: 'Retirada sintética', propertyId: propertyA, keyCode: 'Chave A', assignedTo: brokerA.brokerId, borrower: 'Visitante sintético', purpose: 'Visita', dueAt: '2026-10-08T17:00', status: 'Retirada' };
  const borrowed = save(state, brokerA, 'keys', input);
  const key = borrowed.records.at(-1);
  assert.equal(key.data.checkedOutAt, now);
  rejected(() => save(borrowed, owner, 'keys', input));
  rejected(() => save(borrowed, owner, 'keys', { propertyId: propertyB }, key.id));
  rejected(() => save(borrowed, owner, 'keys', { keyCode: 'Outra chave' }, key.id));
  rejected(() => save(borrowed, brokerB, 'keys', { status: 'Devolvida' }, key.id));
  const returned = save(borrowed, brokerA, 'keys', { status: 'Devolvida' }, key.id);
  assert.equal(returned.records.find(record => record.id === key.id).data.returnedAt, now);
  rejected(() => save(returned, owner, 'keys', { status: 'Retirada' }, key.id));
  const nextBorrow = save(returned, brokerA, 'keys', input);
  assert.equal(nextBorrow.records.filter(record => record.kind === 'keys').length, 2, 'a later checkout is a new record; old history survives');
  assert.equal(nextBorrow.events.filter(event => event.recordId === key.id).length, 2);
});

test('Stage event dates are server-authored and internal comments do not invent contact or stage transitions', () => {
  const { state, caseA } = fixture();
  const changed = save(state, brokerA, 'cases', { stage: 'Atendimento' }, caseA);
  const stageEvent = changed.events.at(-1);
  assert.equal(stageEvent.at, now); assert.equal(stageEvent.changes.stage.to, 'Atendimento');
  assert.equal(changed.records.find(record => record.id === caseA).data.stageEnteredAt, now);
  const beforeStageEvents = changed.events.filter(event => event.changes?.stage).length;
  const commented = model.applyCommand(changed, brokerA, { type: 'comment', id: caseA, text: 'Observação interna' }, now);
  assert.equal(commented.events.at(-1).type, 'comment');
  assert.equal(commented.events.filter(event => event.changes?.stage).length, beforeStageEvents);
  assert.equal(commented.records.find(record => record.id === caseA).data.lastContactAt, undefined);
  assert.equal(model.createDemoState('synthetic', 'demo-owner', now).events.length, 0);
});

test('No client can delete records, rewrite events or enable unfinished distribution', () => {
  const { state, caseA } = fixture();
  for (const command of [{ type: 'delete', id: caseA }, { type: 'events', events: [] }, { type: 'settings', settings: { distributionEnabled: true } }]) rejected(() => model.applyCommand(state, owner, command));
  const source = JSON.stringify(state);
  model.applyCommand(state, owner, { type: 'comment', id: caseA, text: 'Comentário' }, now);
  assert.equal(JSON.stringify(state), source, 'pure transaction must not mutate input');
});

let failures = 0;
for (const { name, run } of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
if (failures) { console.error(`${failures} CRM model security acceptance checks failed.`); process.exitCode = 1; }
else console.log(`PASS ${tests.length} CRM model adversarial acceptance checks.`);
