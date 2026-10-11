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
    { module: mod, exports: mod.exports, require: dependency => load(path.resolve(path.dirname(file), dependency)), crypto, structuredClone, URL, Date, console }, { filename: file });
  modules.set(name, mod.exports); return mod.exports;
}
const model = load('model');
const sources = load('../lead-sources');
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

assert.equal(sources.leadSourceOptions(['Facebook', 'Parceiro local'], 'Campanha antiga').at(-1), 'Outros');
assert.equal(sources.leadSourceOptions(['Facebook']).filter(value => value === 'Facebook').length, 1);
assert(sources.leadSourceOptions([], 'Campanha antiga').includes('Campanha antiga'));
for (const source of sources.LEAD_SOURCE_OPTIONS) assert(sources.validLeadSource(source));
for (const source of ['', ' Facebook', 'Facebook ', 'Outra fonte desconhecida', 'Outros: ', 'Outros:  Feira', 'Outros: Feira\nLocal', 'Outros: Feira\u200b', 'Outros: ' + 'x'.repeat(193), null, 42]) {
  assert.equal(sources.validLeadSource(source), false);
  rejected(command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', source }));
}
state.settings.sources.push('Parceiro local');
assert(sources.validLeadSource('Parceiro local', state.settings.sources));
const sourceRegistration = command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', source: 'Facebook' });
apply(sourceRegistration);
assert.equal(record(caseId).data.source, 'Facebook');
assert.equal(record('demo-lead-1').data.source, 'Facebook');
assert(state.events.some(event => event.recordId === caseId && event.changes?.source?.from === 'WhatsApp' && event.changes.source.to === 'Facebook'));
assert.equal(model.applyCommand(state, actor, sourceRegistration, now), state);
rejected({ ...sourceRegistration, data: { ...sourceRegistration.data, source: 'Instagram' } }, /identificador/);
rejected({ type: 'save', kind: 'cases', id: caseId, data: { source: 'Instagram' } }, /preservados/);
apply(command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', source: 'Outros: Evento no bairro' }));
assert.equal(record(caseId).data.source, 'Outros: Evento no bairro');
assert.equal(record('demo-lead-1').data.source, 'Outros: Evento no bairro');
const beforeLegacySource = 'Campanha antiga com rótulo específico';
record(caseId).data.source = beforeLegacySource; record('demo-lead-1').data.source = beforeLegacySource;
apply(command('attendance', { channel: 'Telefone', outcome: 'Contato realizado' }));
assert.equal(record(caseId).data.source, beforeLegacySource, 'an old client omitting source preserves the exact legacy value');
apply(command('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', source: beforeLegacySource }));
apply(command('attendance', { channel: 'Telefone', outcome: 'Contato realizado', source: 'Parceiro local' }));
assert.equal(record('demo-lead-1').data.source, 'Parceiro local');
const limited = structuredClone(state), broker = { ...actor, brokerId: 'broker-source', role: 'broker' };
limited.members.push({ id: broker.brokerId, name: broker.name, role: 'broker', specialization: 'Ambos' });
limited.records.find(item => item.id === caseId).data.assignedTo = broker.brokerId;
assert.throws(() => model.applyCommand(limited, broker, command('attendance', { channel: 'Telefone', outcome: 'Contato realizado', source: 'Instagram' }), now), /permissão/, 'case access alone cannot grant permission to edit its lead');
const historicalSourceState = structuredClone(state);
for (const id of [caseId, 'demo-lead-1']) {
  const item = historicalSourceState.records.find(record => record.id === id);
  item.legacy = { table: 'leads', id: 'legacy-contact', access: 'assigned', assignedTo: actor.brokerId };
  item.data.source = '  Campanha histórica  ';
}
const historicalUnchanged = model.applyCommand(historicalSourceState, actor, command('attendance', { channel: 'Telefone', outcome: 'Contato realizado' }), now);
assert.equal(historicalUnchanged.records.find(record => record.id === caseId).data.source, '  Campanha histórica  ', 'omitting source must not silently trim an unchanged canonical legacy source');
assert.equal(historicalUnchanged.records.find(record => record.id === 'demo-lead-1').data.source, '  Campanha histórica  ');
const historicalCorrected = model.applyCommand(historicalUnchanged, actor, command('attendance', { channel: 'Telefone', outcome: 'Contato realizado', source: 'Instagram' }), now);
assert.equal(historicalCorrected.records.find(record => record.id === caseId).data.source, 'Instagram');
assert.equal(historicalCorrected.records.find(record => record.id === 'demo-lead-1').data.source, 'Instagram');

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
const acceptedAt = record(proposal.id).data.acceptedAt, closedAt = record(caseId).data.closedAt, originalOrigin = record(caseId).data.source;
const correction = (mode, extra = {}) => command('correct_close', { mode, proposalId: proposal.id, reason: 'Correção solicitada pelo responsável.', confirmed: true, ...extra });
for (const invalid of [
  correction('edit', { amount: 0, conditions: 'Revisada' }), correction('edit', { amount: 420000, conditions: '' }),
  correction('edit', { amount: 420000, conditions: 'Revisada', reason: ' ' }), correction('edit', { amount: 420000, conditions: 'Revisada', confirmed: false }),
  correction('edit', { amount: 420000, conditions: 'Revisada', source: 'Facebook' }), correction('edit', { amount: 420000, conditions: 'Revisada', purpose: 'Aluguel' }),
  correction('reopen', { amount: 420000 }), correction('reopen', { notes: 'Not allowed' }), correction('unknown'),
]) rejected(invalid);
const editClosed = correction('edit', { amount: 420000, conditions: 'Condições corrigidas pelo responsável.' });
apply(editClosed);
assert.equal(record(proposal.id).data.amount, 420000);
assert.equal(record(proposal.id).data.acceptedAt, acceptedAt);
assert.equal(record(caseId).data.closedAt, closedAt);
assert.equal(record(caseId).data.source, originalOrigin);
assert.equal(record(propertyId).data.status, 'Vendido');
assert.equal(model.applyCommand(state, actor, editClosed, now), state);
rejected({ ...editClosed, data: { ...editClosed.data, amount: 430000 } }, /identificador/);
rejected({ type: 'save', kind: 'proposals', id: proposal.id, data: { amount: 430000 } }, /Corrigir fechamento/);
rejected({ type: 'save', kind: 'cases', id: caseId, data: { status: 'Aberto', stage: 'Proposta' } }, /resultado confirmado/);
for (const tamper of [
  value => { value.events = value.events.filter(event => event.recordId !== propertyId); },
  value => { value.events.push({ id: 'later-property-status', recordId: propertyId, at: '2026-10-09T16:00:00Z', actorId: actor.brokerId, changes: { status: { from: 'Disponível', to: 'Vendido' } } }); },
  value => { value.records.find(item => item.id === propertyId).data.status = 'Reservado'; },
  value => { value.records.push({ ...structuredClone(value.records.find(item => item.id === proposal.id)), id: 'another-accepted', data: { ...value.records.find(item => item.id === proposal.id).data, caseId: 'another-case' } }); },
  value => { value.records.find(item => item.id === caseId).data.closedAt = ''; },
]) {
  const conflicted = structuredClone(state); tamper(conflicted);
  const before = JSON.stringify(conflicted);
  assert.throws(() => model.applyCommand(conflicted, actor, correction('reopen'), now), /revisão|outro fechamento/);
  assert.equal(JSON.stringify(conflicted), before);
}
const reopen = correction('reopen');
apply(reopen);
assert.equal(record(caseId).data.status, 'Aberto'); assert.equal(record(caseId).data.stage, 'Proposta');
assert.equal(record(caseId).data.closedAt, ''); assert.equal(record(proposal.id).data.acceptedAt, '');
assert.equal(record(proposal.id).data.status, 'Em negociação'); assert.equal(record(propertyId).data.status, 'Disponível');
assert.equal(record(caseId).data.source, originalOrigin);
assert(state.events.some(event => event.recordId === caseId && event.changes?.status?.from === 'Ganho' && event.changes.status.to === 'Aberto' && event.changes.closedAt.from === closedAt));
assert.equal(model.applyCommand(state, actor, reopen, now), state);
rejected(correction('reopen'), /não possui/);
// The same flow restores a rental that was reserved before its acceptance.
record(caseId).data.purpose = 'Aluguel'; record('demo-lead-1').data.purpose = 'Aluguel'; record(propertyId).data.purpose = 'Aluguel'; record(propertyId).data.status = 'Reservado';
apply(command('close', { proposalId: proposal.id, confirmed: true }));
assert.equal(record(propertyId).data.status, 'Alugado');
apply(correction('reopen'));
assert.equal(record(propertyId).data.status, 'Reservado');
for (const previousStatus of ['Rascunho', 'Enviada', 'Em negociação', 'Recusada', 'Expirada']) {
  const ordinary = structuredClone(state);
  ordinary.records.find(item => item.id === proposal.id).data.status = previousStatus;
  const accepted = model.applyCommand(ordinary, actor, { type: 'save', kind: 'proposals', id: proposal.id, data: { status: 'Aceita' } }, now);
  const undone = model.applyCommand(accepted, actor, correction('reopen'), now);
  assert.equal(undone.records.find(item => item.id === proposal.id).data.status, previousStatus, 'ordinary proposal editor acceptance restores its exact recorded previous status');
}
const directAccepted = model.applyCommand(state, actor, { type: 'save', kind: 'proposals', data: { name: 'Proposta criada já aceita', caseId, propertyId, amount: 440000, conditions: 'Condição sintética', expiresAt: '2026-10-09', status: 'Aceita' } }, now);
const directProposal = directAccepted.records.find(item => item.kind === 'proposals' && item.data.status === 'Aceita');
const directUndone = model.applyCommand(directAccepted, actor, correction('reopen', { proposalId: directProposal.id }), now);
assert.equal(directUndone.records.find(item => item.id === directProposal.id).data.status, 'Rascunho', 'a proposal created as accepted is preserved as a draft');
const imported = structuredClone(state), importedCase = imported.records.find(item => item.id === caseId);
imported.records = imported.records.filter(item => item.id !== proposal.id);
importedCase.legacy = { table: 'leads', id: 'imported-id', access: 'owner', lifecycleStatus: 'Convertido' };
importedCase.data.status = 'Ganho'; importedCase.data.stage = 'Negociado'; importedCase.data.closedAt = '';
const importedPropertyBefore = JSON.stringify(imported.records.find(item => item.id === propertyId));
const importedOpened = model.applyCommand(imported, actor, command('correct_close', { mode: 'reopen', reason: 'Classificação importada incorreta.', confirmed: true }), now);
assert.equal(importedOpened.records.find(item => item.id === caseId).data.stage, 'Atendimento');
assert.equal(JSON.stringify(importedOpened.records.find(item => item.id === propertyId)), importedPropertyBefore);
assert.match(importedOpened.events.at(-1).summary, /Nenhum imóvel foi alterado/);
assert.equal(state.records.filter(item => item.kind === 'messages').length, 0);
assert.ok(!state.events.some(item => item.type === 'automatic'), 'all registrations record explicit human actions');
console.log('PASS registration model: strict command/data validation, immutable failures, no account reassignment, explicit missing purpose, São Paulo scheduling, no duplicate visits, valid completion only, no accidental stage regression, preserved prior history, proposal/closure separation, expiry/property/case guards and exact replay.');
