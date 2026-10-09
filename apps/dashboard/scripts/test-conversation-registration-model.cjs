const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const file = path.resolve(__dirname, '../lib/evolution', name + '.ts');
  const mod = { exports: {} }; modules.set(name, mod.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, require: name => load(path.basename(name)), crypto, structuredClone, URL, Date, console }, { filename: file });
  modules.set(name, mod.exports); return mod.exports;
}
const model = load('model');
const now = '2026-10-08T16:00:00.000Z';
const actor = { companyId: 'tenant-a', brokerId: 'owner', name: 'Responsável sintético', role: 'owner' };
const caseId = 'demo-case-1', propertyId = 'demo-property-1';
let state = model.createDemoState(actor.companyId, actor.brokerId, now);
const command = (action, data = {}, target = caseId) => ({ type: 'register', caseId: target, requestId: crypto.randomUUID(), action, data });
const apply = value => { const before = state.version; state = model.applyCommand(state, actor, value, now); assert.equal(state.version, before + 1); return state; };
const record = id => state.records.find(item => item.id === id);
function rejected(value, expected = /./, person = actor) {
  const before = JSON.stringify(state);
  assert.throws(() => model.applyCommand(state, person, value, now), expected);
  assert.equal(JSON.stringify(state), before, 'failed validation never mutates the original snapshot');
}

for (const invalid of [
  { ...command('attendance'), requestId: 'not-a-uuid' },
  { ...command('attendance'), companyId: 'tenant-b' },
  command('automatic-detection'),
  command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', assignedTo: 'other' }),
  command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', notes: 'x'.repeat(2001) }),
  command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', notes: { unsafe: true } }),
  command('proposal', { propertyId, amount: '400000', conditions: 'Teste', expiresAt: '2026-10-09', status: 'Enviada' }),
  command('close', { proposalId: 'unknown', confirmed: 'true' }),
  command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', purpose: 'Aluguel' }),
]) rejected(invalid);
rejected(command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado' }), /permissão/, { ...actor, companyId: 'tenant-b' });

record(caseId).data.purpose = '';
record('demo-lead-1').data.purpose = '';
rejected(command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado' }), /Venda ou Aluguel/);
apply(command('attendance', { purpose: 'Venda', channel: 'WhatsApp', outcome: 'Tentativa sem resposta' }));
assert.equal(record(caseId).data.stage, 'Atendimento');
assert.equal(record(caseId).data.purpose, 'Venda');
assert.equal(record('demo-lead-1').data.purpose, 'Venda');
assert.equal(record('demo-lead-1').data.status, 'Em atendimento');
assert.match(state.events.at(-1).summary, /Tentativa sem resposta/);
assert.equal(state.events.at(-1).actorId, actor.brokerId);
assert.equal(state.events.at(-1).at, now);
assert.equal(record(caseId).data.lastContactAt, undefined, 'registration is not evidence that a client replied');

const appointment = command('schedule', { propertyId, dueAt: '2026-10-10T10:30', notes: 'A combinar pessoalmente.' });
apply(appointment);
const visit = state.records.find(item => item.kind === 'tasks' && item.data.notes === 'A combinar pessoalmente.');
assert(visit);
assert.equal(visit.data.dueAt, '2026-10-10T13:30:00.000Z', 'local form time is interpreted in São Paulo');
assert.equal(visit.data.status, 'Confirmada');
assert.equal(record(caseId).data.stage, 'Agendamento');
assert.equal(model.applyCommand(state, actor, appointment, now), state, 'exact replay is a pure no-op');
rejected(command('schedule', { propertyId, dueAt: visit.data.dueAt }), /Já existe uma visita/);
rejected(command('visit', { taskId: visit.id }), /futura/);
rejected(command('visit', { taskId: visit.id }, 'demo-case-2'), /deste atendimento/);
visit.data.dueAt = '2026-10-08T14:00:00.000Z';
apply(command('visit', { taskId: visit.id, notes: 'Cliente compareceu.' }));
assert.equal(record(visit.id).data.status, 'Realizada');
assert.equal(record(caseId).data.stage, 'Visita');
rejected(command('visit', { taskId: visit.id }), /concluída/);

rejected(command('visit', { propertyId, occurredAt: '2026-10-09T10:00' }), /futur|acontec|horário/i);
rejected(command('visit', { propertyId, occurredAt: '2026-02-31T10:00' }), /data|horário/i);
rejected(command('visit', { taskId: visit.id, propertyId, occurredAt: '2026-10-07T10:00' }));
record(propertyId).data.status = 'Vendido';
apply(command('visit', { propertyId, occurredAt: '2026-10-07T10:00', notes: 'Visita passada sem agendamento anterior.' }));
const historicalVisit = state.records.find(item => item.kind === 'tasks' && item.data.notes === 'Visita passada sem agendamento anterior.');
assert.equal(historicalVisit.data.dueAt, '2026-10-07T13:00:00.000Z');
assert.equal(historicalVisit.data.status, 'Realizada');
assert.equal(record(propertyId).data.status, 'Vendido', 'a historical visit neither needs nor changes current availability');
rejected(command('visit', { propertyId, occurredAt: '2026-10-07T10:00' }), /existe|registrad/i);
record(propertyId).data.status = 'Disponível';

apply(command('proposal', { propertyId, amount: 410000, conditions: 'Financiamento aprovado pelo cliente.', expiresAt: '2026-10-09', status: 'Em negociação' }));
const proposal = state.records.find(item => item.kind === 'proposals' && item.data.caseId === caseId);
assert.equal(record(caseId).data.stage, 'Proposta');
assert.equal(record(propertyId).data.status, 'Disponível');
apply(command('attendance', { channel: 'Telefone', outcome: 'Contato realizado' }));
assert.equal(record(caseId).data.stage, 'Proposta', 'another contact does not regress an advanced case');
const oldVisitCount = state.records.filter(item => item.kind === 'tasks').length;
apply(command('lead', { reason: 'Revisão expressamente solicitada pelo responsável.' }));
assert.equal(record(caseId).data.stage, 'Lead');
assert.equal(state.records.filter(item => item.kind === 'tasks').length, oldVisitCount);
assert.equal(record(proposal.id).data.status, 'Em negociação', 'explicit reclassification does not erase proposal history');
rejected(command('close', { proposalId: proposal.id }), /confirme/);
rejected(command('close', { proposalId: proposal.id, confirmed: true }, 'demo-case-3'), /deste atendimento/);
record(proposal.id).data.expiresAt = '2026-10-07';
rejected(command('close', { proposalId: proposal.id, confirmed: true }), /vencida/);
record(proposal.id).data.expiresAt = '2026-10-09';
record(propertyId).data.purpose = 'Aluguel';
rejected(command('close', { proposalId: proposal.id, confirmed: true }), /finalidade/);
record(propertyId).data.purpose = 'Venda';
const closing = command('close', { proposalId: proposal.id, confirmed: true });
apply(closing);
assert.equal(record(caseId).data.stage, 'Negociado');
assert.equal(record(caseId).data.status, 'Ganho');
assert.equal(record(propertyId).data.status, 'Vendido');
assert.equal(model.applyCommand(state, actor, closing, now), state, 'closing replay remains safe after the case is closed');
rejected(command('lead', { reason: 'Não pode apagar resultado confirmado.' }), /preservados/);
assert.equal(state.records.filter(item => item.kind === 'messages').length, 0);
assert.ok(!state.events.some(item => item.type === 'automatic'), 'all registrations record explicit human actions');
console.log('PASS registration model: strict command/data validation, immutable failures, no account reassignment, explicit missing purpose, São Paulo scheduling, no duplicate visits, valid completion only, no accidental stage regression, preserved prior history, proposal/closure separation, expiry/property/case guards and exact replay.');
