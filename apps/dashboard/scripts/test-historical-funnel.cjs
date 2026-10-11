const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib/evolution', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: id => { assert.equal(id, './schema'); return load('schema'); } });
  cache.set(name, module.exports); return module.exports;
}
const { historicalFunnel } = load('historical-funnel');
const now = '2026-10-12T15:00:00.000Z', start = '2026-10-05T03:00:00.000Z';
const record = (id, extra = {}, createdAt = start) => ({ id, kind: 'cases', createdAt, data: { name: id, personId: 'same-person', purpose: 'Venda', journey: 'Negociação', assignedTo: 'broker', status: 'Aberto', stage: 'Lead', ...extra } });
let eventId = 0;
const stage = (recordId, to, at, from = '') => ({ id: `event-${++eventId}`, recordId, at, changes: { stage: { from, to } } });
const registered = (recordId, action, at, data = {}) => ({ id: `event-${++eventId}`, recordId, at, registration: { requestId: `request-${eventId}`, action, fingerprint: JSON.stringify({ caseId: recordId, action, data }) } });
const gained = (recordId, at) => ({ ...stage(recordId, 'Negociado', at, 'Proposta'), changes: { stage: { from: 'Proposta', to: 'Negociado' }, status: { from: 'Aberto', to: 'Ganho' }, closedAt: { from: '', to: at } } });
const state = { records: [record('a', { stage: 'Proposta' }), record('b', { stage: 'Visita' }), record('import', { stage: 'Proposta' }), record('old', {}, '2026-10-05T02:59:59Z'), record('end', {}, '2026-10-12T03:00:00Z'), record('other', { assignedTo: 'other-broker' }), record('rental', { purpose: 'Aluguel' }), record('capture', { journey: 'Captação' })], events: [
  stage('a', 'Lead', start), stage('a', 'Atendimento', '2026-10-06T12:00:00Z'), stage('a', 'Proposta', '2026-10-09T12:00:00Z', 'Atendimento'),
  stage('b', 'Visita', '2026-10-06T12:00:00Z'), stage('b', 'Atendimento', '2026-10-07T12:00:00Z', 'Visita'),
  registered('b', 'visit', '2026-10-08T12:00:00Z'), registered('b', 'attendance', '2026-10-09T12:00:00Z', { outcome: 'Tentativa sem resposta' }),
  stage('a', 'Visita', '2026-10-13T12:00:00Z'), stage('a', 'Lead', 'invalid'), stage('a', 'Visita', '2026-10-01T12:00:00Z'),
  stage('missing', 'Lead', start), stage('rental', 'Lead', start), stage('other', 'Lead', start), stage('capture', 'Avaliação', start),
] };
const before = JSON.stringify(state), filter = { from: '2026-10-05', to: '2026-10-11', assignedTo: 'broker', purpose: 'Venda', journey: 'Negociação' };
let result = historicalFunnel(state, filter, now), row = name => result.rows.find(item => item.stage === name);
assert.deepEqual(Array.from(result.cohortIds), ['a', 'b', 'import'], 'creation dates use São Paulo start-inclusive/end-exclusive, purpose, current assignee and journey');
assert.deepEqual(Array.from(result.noEvidenceIds), ['import'], 'current imported stage alone is not historical evidence');
assert.equal(row('Lead').count, 1); assert.equal(row('Atendimento').count, 2, 'two negotiations belonging to one person count separately');
assert.equal(row('Agendamento').count, 0, 'skipped stages are never filled');
assert.equal(row('Visita').count, 1, 'future, pre-creation and invalid events do not count');
assert.equal(row('Atendimento').cohortRate, 2 / 3); assert.equal(row('Atendimento').conversionRate, 1, 'conversion uses intersection, never the 200% ratio of stage totals');
assert.equal(row('Visita').conversionRate, null, 'no recorded previous stage means no base, not zero percent');
assert.equal(row('Proposta').conversionRate, 0, 'a proposal for another case is not a visit-to-proposal conversion');
assert.equal(JSON.stringify(state), before, 'analysis does not fabricate events or modify the source');

const chronological = { records: [record('order')], events: [stage('order', 'Visita', '2026-10-06T10:00:00Z'), stage('order', 'Agendamento', '2026-10-07T10:00:00Z')] };
result = historicalFunnel(chronological, filter, now); assert.equal(row('Visita').conversionRate, 0, 'a visit recorded before the scheduling is not subsequent progression');
chronological.events.unshift(registered('order', 'visit', '2026-10-08T10:00:00Z'));
chronological.events.push(chronological.events[0]);
result = historicalFunnel(chronological, filter, now); assert.equal(row('Visita').conversionRate, 1); assert.equal(row('Visita').count, 1, 'a later visit proves progression, independent of array ordering and duplicate evidence');

const closedAt = '2026-10-08T12:00:00.000Z', finalClose = '2026-10-10T12:00:00.000Z';
const closings = { records: [record('won', { status: 'Ganho', stage: 'Negociado', closedAt }), record('undone', { stage: 'Proposta' }), record('reclosed', { status: 'Ganho', stage: 'Negociado', closedAt: finalClose }), record('unproven', { status: 'Ganho', stage: 'Negociado', closedAt })], events: [gained('won', closedAt), registered('won', 'close', closedAt), stage('won', 'Proposta', '2026-10-07T12:00:00Z'), gained('undone', closedAt), stage('undone', 'Proposta', '2026-10-09T12:00:00Z'), gained('reclosed', closedAt), gained('reclosed', finalClose), stage('reclosed', 'Proposta', '2026-10-09T12:00:00Z'), registered('won', 'correct_close', '2026-10-09T12:00:00Z', { mode: 'edit' }), registered('unproven', 'close', closedAt)] };
result = historicalFunnel(closings, filter, now);
assert.deepEqual(Array.from(row('Negociado').caseIds), ['won', 'reclosed'], 'only current confirmed closures with the matching latest case acceptance count');
assert.deepEqual(Array.from(row('Negociado').convertedCaseIds), ['won', 'reclosed'], 'reclosure uses the valid current closing, not its reversed acceptance');
assert.equal(row('Negociado').count, 2, 'editing amount and repeated acceptance do not double count');
for (const dates of [{ from: '2026-02-30' }, { from: '2026-10-12', to: '2026-10-05' }]) {
  const invalid = historicalFunnel(state, dates, now); assert.equal(invalid.invalidRange, true); assert.equal(invalid.cohortIds.length, 0);
}
const capture = historicalFunnel(state, { ...filter, journey: 'Captação' }, now);
assert.deepEqual(Array.from(capture.rows, item => item.stage), ['Lead', 'Avaliação', 'Captado']); assert.equal(capture.rows[1].count, 1);

// UI contract: historical selection uses the counted IDs even if the current
// stage differs, and navigating/clearing removes that explicit selection.
const { navigationHarness, find, text, click, owner, state: uiState } = require('./test-evolution-navigation.cjs');
const originalEvents = uiState.events;
const target = uiState.records.find(item => item.kind === 'cases' && item.data.purpose === 'Venda');
uiState.events = [stage(target.id, 'Visita', '2026-10-08T12:00:00Z')];
try {
  const nav = navigationHarness(owner, '#dashboard'); click(nav, 'Conversão histórica');
  assert(text(nav.tree).includes('Histórico parcial')); assert(text(nav.tree).includes('classificação automática de Lead/Atendimento'));
  const historicalVisit = find(nav.tree, node => node.props?.['aria-label']?.startsWith('Visita: 1 atendimentos com passagem comprovada'));
  assert(historicalVisit); historicalVisit.props.onClick(); nav.render();
  assert(text(nav.tree).includes('Passaram por Visita'));
  const card = find(nav.tree, node => node.props?.className === 'attendanceCard');
  assert.equal(card.props['data-record-id'], target.id);
  assert(text(card).includes(target.data.name), 'the case objective distinguishes negotiations of the same client');
  assert.equal(find(nav.tree, node => node.props?.['aria-label'] === 'Etapa').props.value, '', 'historical drill-down does not filter by the current stage');
  click(nav, 'Remover recorte histórico ×'); assert(!text(nav.tree).includes('Registros selecionados pelo histórico'));
  click(nav, 'Dashboard'); click(nav, 'Conversão histórica');
  find(nav.tree, node => node.props?.['aria-label']?.startsWith('Visita: 1 atendimentos com passagem comprovada')).props.onClick(); nav.render();
  click(nav, 'Limpar'); assert(!text(nav.tree).includes('Registros selecionados pelo histórico'));
  click(nav, 'Dashboard'); assert.equal(find(nav.tree, node => node.type === 'button' && text(node) === 'Conversão histórica').props['aria-pressed'], true);
  click(nav, 'Carteira atual'); assert(!text(nav.tree).includes('Histórico parcial'));
  assert(nav.requests.every(request => request.method === 'GET'), 'history navigation never writes customer data');
} finally { uiState.events = originalEvents; }
console.log('PASS historical funnel: documented unique-case reach, chronological conversion, São Paulo cohorts, valid current closures, incomplete history, and exact-ID drill-down.');
