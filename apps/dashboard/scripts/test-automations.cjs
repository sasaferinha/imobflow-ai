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
const { evaluateAutomation, isFlowId } = load('lib/automation-rules.ts');
const now = new Date('2026-09-07T12:00:00Z');
const lead = { id: 'test-lead', name: 'Teste', phone: '11999999999', email: 'test@example.com', goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 600 mil', details: 'Varanda e garagem coberta', assignedTo: 'Corretor', lifecycleStatus: 'Novo', lastContactAt: null, createdAt: '2026-09-05T12:00:00Z' };
const properties = [{ id: 'p1', purpose: 'Venda', district: 'Centro', title: 'Apartamento', price: 'R$ 500.000' }, { id: 'p2', purpose: 'Aluguel', district: 'Centro', title: 'Outro', price: 'R$ 2.000' }];
let passed = 0;
function test(name, callback) { callback(); passed++; console.log('PASS', name); }
test('known flow IDs only', () => { assert.equal(isFlowId('followup'), true); assert.equal(isFlowId('__proto__'), false); });
test('qualification persists real score and explanation', () => { const result = evaluateAutomation('qualification', lead, [], now); assert.ok(result.detail.score >= 80); assert.match(result.detail.summary, /Teste deseja comprar/); });
test('48-hour boundary', () => { assert.ok(evaluateAutomation('followup', lead, [], now)); assert.equal(evaluateAutomation('followup', lead, [], new Date(now.getTime() - 1)), null); });
test('recent contact suppresses followup', () => assert.equal(evaluateAutomation('followup', { ...lead, lastContactAt: now.toISOString() }, [], now), null));
test('closed leads receive no commercial alerts or recommendations', () => { for (const lifecycleStatus of ['Convertido', 'Perdido']) for (const flow of ['priority', 'followup', 'recommendations']) assert.equal(evaluateAutomation(flow, { ...lead, lifecycleStatus }, properties, now), null); });
test('visit stage suppresses generic followup', () => assert.equal(evaluateAutomation('followup', { ...lead, lifecycleStatus: 'Visita' }, [], now), null));
test('new contact creates a new reminder version', () => { const later = new Date('2026-09-12T12:00:00Z'); assert.notEqual(evaluateAutomation('followup', lead, [], later).version, evaluateAutomation('followup', { ...lead, lastContactAt: now.toISOString() }, [], later).version); });
test('recommendations preserve purpose and location', () => { const result = evaluateAutomation('recommendations', lead, properties, now); assert.equal(result.detail.matches.length, 1); assert.equal(result.detail.matches[0].id, 'p1'); assert.match(result.detail.note, /Validar preço/); });
test('unknown region does not fabricate matches', () => assert.equal(evaluateAutomation('recommendations', { ...lead, region: 'Não informado' }, properties, now), null));
test('sold and rented properties are excluded from recommendations', () => { for (const status of ['Vendido', 'Alugado']) assert.equal(evaluateAutomation('recommendations', lead, properties.map((property) => ({ ...property, status })), now), null); });
test('unchanged results have stable deduplication keys', () => assert.equal(evaluateAutomation('priority', lead, [], now).version, evaluateAutomation('priority', lead, [], now).version));
test('low completeness suppresses priority', () => assert.equal(evaluateAutomation('priority', { ...lead, goal: '', region: '', propertyType: '', budget: '', details: null }, [], now), null));
console.log(`${passed} rule tests passed. Database integration tests await the real database.`);
