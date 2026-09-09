/* Rules tests; no database, credentials or network needed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(filename) {
  const full = path.resolve(__dirname, '..', filename);
  if (cache.has(full)) return cache.get(full);
  const source = fs.readFileSync(full, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => name.startsWith('.') ? load(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(full), name + '.ts'))) : require(name);
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire, Date, console });
  cache.set(full, module.exports);
  return module.exports;
}
const { automationFlows, evaluateAutomation, isFlowId } = load('lib/automation-rules.ts');
const now = new Date('2026-09-07T12:00:00Z');
const lead = { id: 'test-lead', name: 'Teste', phone: '11999999999', email: 'test@example.com', goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 600 mil', details: 'Varanda e garagem coberta', assignedTo: 'Corretor', lifecycleStatus: 'Novo', lastContactAt: null, createdAt: '2026-09-05T12:00:00Z' };
const properties = [{ id: 'p1', purpose: 'Venda', district: 'Centro', title: 'Apartamento', price: 'R$ 500.000' }, { id: 'p2', purpose: 'Aluguel', district: 'Centro', title: 'Outro', price: 'R$ 2.000' }];
let passed = 0;
function test(name, callback) { callback(); passed++; console.log('PASS', name); }
test('known flow IDs only', () => { assert.equal(isFlowId('followup'), true); assert.equal(isFlowId('__proto__'), false); });
test('removed flows cannot appear or execute, including from old clients', () => {
  assert.equal(automationFlows.map(flow => flow.id).join(','), 'followup,priority,new-property');
  for (const flow of ['qualification', 'recommendations', '__proto__']) {
    assert.equal(isFlowId(flow), false);
    assert.equal(evaluateAutomation(flow, lead, properties, now), null);
  }
});
test('48-hour boundary', () => { assert.ok(evaluateAutomation('followup', lead, [], now)); assert.equal(evaluateAutomation('followup', lead, [], new Date(now.getTime() - 1)), null); });
test('recent contact suppresses followup', () => assert.equal(evaluateAutomation('followup', { ...lead, lastContactAt: now.toISOString() }, [], now), null));
test('closed leads receive no commercial alerts', () => { for (const lifecycleStatus of ['Convertido', 'Perdido']) for (const flow of ['priority', 'followup', 'new-property']) assert.equal(evaluateAutomation(flow, { ...lead, lifecycleStatus }, properties, now), null); });
test('visit stage suppresses generic followup', () => assert.equal(evaluateAutomation('followup', { ...lead, lifecycleStatus: 'Visita' }, [], now), null));
test('new contact creates a new reminder version', () => { const later = new Date('2026-09-12T12:00:00Z'); assert.notEqual(evaluateAutomation('followup', lead, [], later).version, evaluateAutomation('followup', { ...lead, lastContactAt: now.toISOString() }, [], later).version); });
test('unchanged results have stable deduplication keys', () => assert.equal(evaluateAutomation('priority', lead, [], now).version, evaluateAutomation('priority', lead, [], now).version));
test('low completeness suppresses priority', () => assert.equal(evaluateAutomation('priority', { ...lead, goal: '', region: '', propertyType: '', budget: '', details: null }, [], now), null));
const { newPropertyCandidates, moneyValue, budgetCeiling, whatsappNumber } = load('lib/property-matching.ts');
const buyer = { ...lead, name: 'João Silva', details: '2 quartos', budget: 'Até R$ 500 mil', createdAt: '2026-08-24T12:00:00Z' };
const newProperty = { ...properties[0], title: 'Residencial Central', propertyType: 'Apartamento', status: 'Disponível', meta: '2 quartos • 1 vaga • 75 m²', createdAt: '2026-09-07T10:00:00Z' };
const matches = (leadChanges = {}, propertyChanges = {}, clock = now) => newPropertyCandidates({ ...buyer, ...leadChanges }, [{ ...newProperty, ...propertyChanges }], clock);
test('new-property is registered; João receives his exact 500k match after two weeks', () => {
  assert.ok(isFlowId('new-property'));
  const result = matches()[0]; assert.ok(result); assert.match(result.detail.message, /Olá, João!/);
  assert.match(result.detail.message, /Residencial Central/); assert.match(result.detail.note, /Nenhuma mensagem enviada/);
});
test('prices parse BRL, mil, milhões and monthly rent without losing decimals', () => {
  for (const [text, expected] of [['R$ 500.000,00', 500000], ['500 mil', 500000], ['1,5 milhão', 1500000], ['R$ 2.950/mês', 2950]]) assert.equal(moneyValue(text), expected);
  for (const text of ['Sob consulta', '500k', 'R$ 0', '-500', 'R$ 1.2', '500 euros']) assert.equal(moneyValue(text), null);
  assert.equal(budgetCeiling('R$ 300 mil a R$ 600 mil'), 600000); assert.equal(budgetCeiling('Acima de R$ 500 mil'), null);
});
test('rejects over-budget, wrong rooms, district, kind and purpose', () => {
  for (const change of [{ price: 'R$ 500.000,01' }, { meta: '3 quartos' }, { district: 'Centro Sul' }, { propertyType: 'Casa' }, { purpose: 'Aluguel' }]) assert.equal(matches({}, change).length, 0);
});
test('rejects unavailable properties and closed leads', () => {
  for (const status of ['Vendido', 'Alugado']) assert.equal(matches({}, { status }).length, 0);
  for (const lifecycleStatus of ['Convertido', 'Perdido']) assert.equal(matches({ lifecycleStatus }).length, 0);
});
test('requires clear complete criteria and actual listing room count', () => {
  for (const change of [{ details: '' }, { details: '2 ou 3 quartos' }, { budget: '' }, { region: '' }, { propertyType: '' }, { goal: 'Comprar ou alugar' }]) assert.equal(matches(change).length, 0);
  for (const change of [{ price: 'Sob consulta' }, { meta: 'Varanda' }, { propertyType: '', title: 'Residencial Central' }, { meta: 'No mínimo 2 quartos' }]) assert.equal(matches({}, change).length, 0);
});
test('supports accent/case, spelled-out rooms, explicit minimum and multiple listed regions', () => {
  assert.equal(matches({ region: 'CENTRO; Vila Nova', details: 'dois quartos' }).length, 1);
  assert.equal(matches({ details: 'Pelo menos 2 quartos' }, { meta: '3 quartos' }).length, 1);
  assert.equal(matches({ details: 'No mínimo 3 quartos' }).length, 0);
});
test('newness boundary, future date, pre-contact listing and missing dates', () => {
  assert.equal(matches({}, {}, new Date('2026-09-14T10:00:00Z')).length, 1);
  assert.equal(matches({}, {}, new Date('2026-09-14T10:00:00.001Z')).length, 0);
  for (const createdAt of ['', '2026-08-23T12:00:00Z', '2026-09-08T12:00:00Z']) assert.equal(matches({}, { createdAt }).length, 0);
  assert.equal(matches({ lastContactAt: '2026-09-07T11:00:00Z' }).length, 0);
  assert.equal(matches({ createdAt: now.toISOString(), lastContactAt: '2026-08-24T12:00:00Z' }).length, 1);
});
test('rental matching uses monthly budget and preserves transaction purpose', () => {
  assert.equal(matches({ goal: 'Alugar', budget: 'Até R$ 3 mil' }, { purpose: 'Aluguel', price: 'R$ 2.950/mês' }).length, 1);
  assert.equal(matches({ goal: 'Alugar', budget: 'Até R$ 3 mil' }, { purpose: 'Aluguel', price: 'R$ 3.001/mês' }).length, 0);
});
test('each property gets its own stable deduplication key despite edits', () => {
  const results = newPropertyCandidates(buyer, [newProperty, { ...newProperty, id: 'p3' }], now);
  assert.equal(results.length, 2); assert.notEqual(results[0].version, results[1].version);
  assert.equal(matches()[0].version, matches({ name: 'João Souza' }, { price: 'R$ 490.000' })[0].version);
});
test('phone handoff normalizes domestic BR, preserves explicit international and rejects missing numbers', () => {
  assert.equal(whatsappNumber('(11) 99999-9999'), '5511999999999');
  assert.equal(whatsappNumber('+55 11 99999-9999'), '5511999999999');
  assert.equal(whatsappNumber('+1 415 555 2671'), '14155552671');
  assert.equal(whatsappNumber(''), null); assert.equal(whatsappNumber('123'), null);
});
console.log(`${passed} rule tests passed. Database integration tests await the real database.`);
