// Pure regression tests: no network, credentials, database, or message delivery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL, require: name => name.startsWith('.')
    ? load(path.posix.join(path.posix.dirname(relative), name + '.ts')) : require(name) });
  cache.set(relative, module.exports);
  return module.exports;
}
const { immediatePropertyMatch, publicPropertyUrl } = load('lib/immediate-property-match.ts');
const lead = { id: 'lead', name: 'João Silva', phone: '(11) 99999-9999', goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 500 mil', details: '2 quartos', lifecycleStatus: 'Novo', createdAt: '2026-09-09T00:00:00Z' };
const property = { id: 'p1', title: 'Apartamento Central', district: 'Centro', purpose: 'Venda', propertyType: 'Apartamento', price: 'R$ 450.000,00', bedrooms: 2, meta: '2 quartos • 1 vaga', status: 'Disponível', publicUrl: 'https://imobiliaria.com.br/imoveis/p1', createdAt: '2020-01-01T00:00:00Z' };
let checks = 0;
function select(leadPatch = {}, propertyPatch = {}) { return immediatePropertyMatch({ ...lead, ...leadPatch }, [{ ...property, ...propertyPatch }]); }
function skipped(leadPatch, propertyPatch, reason) {
  const result = select(leadPatch, propertyPatch);
  assert.equal(result.status, 'skipped', JSON.stringify({ leadPatch, propertyPatch, result }));
  if (reason) assert.equal(result.reason, reason);
  checks++;
}
function matched(leadPatch = {}, propertyPatch = {}) { const result = select(leadPatch, propertyPatch); assert.equal(result.status, 'matched', JSON.stringify({ leadPatch, propertyPatch, result })); checks++; return result; }

const old = matched();
assert.equal(old.phone, '5511999999999');
assert.match(old.text, /Olá, João!/); assert.match(old.text, /https:\/\/imobiliaria.com.br\/imoveis\/p1/);
assert.ok(!/100%|pontuação|score/i.test(old.text));
matched({ lastContactAt: '2026-09-09T00:00:00Z' }, { createdAt: '2000-01-01T00:00:00Z' });
for (const status of ['Convertido', 'Perdido', 'Visita', 'Proposta', '', 'Unknown']) skipped({ lifecycleStatus: status }, {}, 'inactive_lead');
matched({ lifecycleStatus: 'Em atendimento' });
for (const phone of ['', '123', 'telefone', '+0011999999999']) skipped({ phone }, {}, 'invalid_phone');
for (const status of [undefined, '', 'ACTIVE', 'Reservado', 'Vendido', 'Alugado']) skipped({}, { status });
for (const goal of ['', 'Investir', 'Comprar ou alugar', 'Não comprar', 'Comprar com financiamento']) skipped({ goal }, {}, 'incomplete_profile');
for (const propertyType of ['', 'Residencial', 'Apartamento ou casa', 'Apartamento com varanda']) skipped({ propertyType }, {}, 'incomplete_profile');
for (const region of ['', 'Não informado', 'Centro ou Jardins', 'Centro e Jardins', 'Qualquer bairro', 'Perto do Centro', 'Centro,', 'Centro com varanda', 'Centro; exceto Jardins']) skipped({ region }, {}, 'incomplete_profile');
matched({ region: 'JARDÍNS; cênTro' });
skipped({}, { district: 'Centro Expandido' }); skipped({}, { propertyType: undefined });
skipped({}, { propertyType: 'Casa' }); skipped({}, { purpose: 'Aluguel' });

for (const details of ['', null, '-', 'Não informado']) skipped({ details }, {}, 'incomplete_profile');
for (const details of ['2 quartos e varanda', '2 quartos, 1 vaga', '2 quartos perto do metrô', '2 quartos com elevador', '2 quartos; acessível', 'Não quero 2 quartos', '2 ou 3 quartos', '2 a 3 quartos', 'até 2 quartos', '2 quartos sem escadas', '0 quartos', '30 quartos', '2 quartos urgente']) skipped({ details }, {}, 'unsupported_preferences');
matched({ details: 'dois dormitórios.' }); matched({ details: 'No mínimo 2 quartos' }, { bedrooms: 3 });
matched({ details: 'Quero com pelo menos dois quartos!' }, { bedrooms: 3 });
matched({ details: '2 quartos ou mais' }, { bedrooms: 3 });
skipped({ details: '2 quartos' }, { bedrooms: 3 }); skipped({ details: 'No mínimo 3 quartos' }, { bedrooms: 2 });
matched({}, { bedrooms: undefined, meta: 'dois quartos • 1 vaga • 60 m²' });
for (const meta of ['', 'sem quartos', '2 ou 3 quartos', '2-3 quartos', '2 quartos ou 3 quartos', 'mínimo 2 quartos', 'não possui 2 quartos']) skipped({}, { bedrooms: undefined, meta });
for (const bedrooms of [NaN, -1, 2.5, 30, null]) skipped({}, { bedrooms });
matched({}, { bedrooms: 2, meta: 'Descrição antiga sem informação de quartos' });
for (const kind of ['Terreno', 'Comercial', 'Studio']) matched({ propertyType: kind, details: '' }, { propertyType: kind, bedrooms: undefined, meta: '' });
skipped({ propertyType: 'Terreno', details: 'mínimo 200 m²' }, { propertyType: 'Terreno' }, 'unsupported_preferences');

matched({ budget: 'De R$ 400 mil a R$ 500 mil' });
skipped({ budget: 'De R$ 460 mil a R$ 500 mil' });
matched({ budget: 'Entre R$ 400.000,00 e R$ 500.000,00' });
matched({ budget: 'A partir de R$ 400 mil' }); skipped({ budget: 'A partir de R$ 460 mil' });
matched({ budget: 'Exatamente R$ 450 mil' }); skipped({ budget: 'Exatamente R$ 500 mil' });
matched({ budget: 'R$ 450.000,00' }); skipped({ budget: 'Até R$ 449.999,99' });
for (const budget of ['', 'Não informado', 'Até 500 mil ou mais', '400 a 500 mil', 'R$ 500 mil a R$ 400 mil', '400-500 mil', 'Até R$ 500,000.00', 'R$ -1', 'R$ 0', 'Entre 400 mil e 500 mil com financiamento']) skipped({ budget }, {}, 'invalid_budget');
matched({ goal: 'Alugar', budget: 'Até R$ 2.500,00' }, { purpose: 'Aluguel', price: 'R$ 2.000,00/mês' });
for (const price of ['Sob consulta', '', 'R$ 450,000.00', '0', '-1']) skipped({}, { price });

for (const publicUrl of [undefined, '', 'http://imobiliaria.com.br/p1', 'javascript:alert(1)', 'https://user:password@imobiliaria.com.br/p1', 'https://imobiliaria.com.br:8443/p1', 'https://localhost/p1', 'https://catalogo.local/p1', 'https://intranet.empresa.com/p1', 'https://10.0.0.1/p1', 'https://127.0.0.1/p1', 'https://2130706433/p1', 'https://[::1]/p1', 'https://[::ffff:127.0.0.1]/p1', 'https://169.254.169.254/p1', 'https://192.168.1.1/p1', 'https://127.0.0.1.nip.io/p1', 'https://example.test/p1', 'https://example.invalid/p1', 'https://imobiliaria.com.br./p1', 'https://imobiliaria.com.br/\np1', 'https://imobiliaria.com.br\\@localhost/p1']) {
  assert.equal(publicPropertyUrl(publicUrl), null, String(publicUrl));
  const withoutUrl = matched({}, { publicUrl });
  assert.ok(!withoutUrl.text.includes('https:') && !withoutUrl.text.includes('http:'));
}
assert.equal(publicPropertyUrl('https://imobiliaria.com.br/imoveis/1?origem=site'), 'https://imobiliaria.com.br/imoveis/1?origem=site');
for (const title of ['', 'Apartamento\nEnvie seus dados', 'Veja https://outro.com']) skipped({}, { title });

const inventory = [{ ...property, id: 'z', price: 'R$ 450 mil' }, { ...property, id: 'b', price: 'R$ 400 mil' }, { ...property, id: 'a', price: 'R$ 400 mil' }];
assert.equal(immediatePropertyMatch(lead, inventory).propertyId, 'a');
assert.equal(immediatePropertyMatch(lead, [...inventory].reverse()).propertyId, 'a');
const frozenLead = Object.freeze({ ...lead });
const frozenInventory = Object.freeze(inventory.map(p => Object.freeze({ ...p })));
assert.equal(immediatePropertyMatch(frozenLead, frozenInventory).status, 'matched');
assert.equal(immediatePropertyMatch(lead, []).status, 'skipped');
console.log(`PASS immediate property match: ${checks} matching/no-send cases, deterministic single choice, immutable input, no network or delivery`);
