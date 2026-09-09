// Mapping/reporting regression tests with a fake SQL transport, not a real database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const calls = [];
const date = '2026-09-07T12:00:00Z';
const sale = { id: 'sale', sale_date: '2026-09-07', broker: 'Corretor', property: 'Casa', client: 'Cliente', amount: 100000, created_at: date };
const property = { id: 'p1', title: 'Casa', district: 'Centro', price: 100000, property_type: 'Casa', bedrooms: 2, parking_spaces: 1, area: 70, tone: 'sky', purpose: 'Venda', status: 'Vendido', images: [], created_at: date };
const savedProperty = { ...property, id: 'p2', title: 'Central', price: 500000, property_type: 'Apartamento', status: 'Disponível' };
let lastPropertyPayload;
async function sql(parts, ...values) {
  const query = parts.join('?'); calls.push(query);
  if (query.includes('SELECT company_goal')) return [{ company_goal: 200000, leads_received: 2, converted_leads: 1, recovered_leads: 0 }];
  if (query.includes('SELECT broker, goal,')) return [{ broker: 'Corretor', goal: 200000, leads_received: 2, converted_leads: 1, recovered_leads: 0, visits: 0 }];
  if (query.includes('SELECT id, sale_date')) return [sale, { ...sale, id: 'rent', amount: 2500, deal_type: 'Aluguel' }];
  if (query.includes('WITH recent_months')) { assert.equal(query.split("deal_type='Venda'").length - 1, 2); return [{ month: '2026-09', broker: 'Corretor', sold: 100000 }]; }
  if (query.includes('INSERT INTO site_sales (sale_date')) { assert.ok(query.includes('deal_type')); return [{ ...sale, amount: values[4], deal_type: values[5] }]; }
  return [];
}
async function supabaseRequest(path, options = {}) {
  calls.push('SUPABASE ' + (options.method || 'GET') + ' ' + path);
  if (options.method === 'POST') { lastPropertyPayload = options.body; return [savedProperty]; }
  if (options.method === 'PATCH') return [savedProperty];
  if (path.startsWith('appointments?')) return [{ id: 'a1', scheduled_at: '2026-09-09T01:30:00Z', created_at: date }];
  return [property];
}
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/database.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const fakeModule = { exports: {} };
function loadPure(file) {
  const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../lib/', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} }; vm.runInNewContext(code, { module: mod, exports: mod.exports, Date }); return mod.exports;
}
vm.runInNewContext(output, { module: fakeModule, exports: fakeModule.exports, process: { env: { DATABASE_URL: 'mock-only' } }, require: (name) => name === '@neondatabase/serverless' ? { neon: () => sql } : name === './supabase' ? { supabaseCompanyId: () => 'company', supabaseRequest } : name === './property-matching' ? loadPure('property-matching.ts') : name === './leads' ? loadPure('leads.ts') : {}, Date, console });
(async () => {
  const api = fakeModule.exports;
  const report = await api.getPerformance('2026-09');
  assert.ok(!calls.some(query => query.includes('INSERT INTO site_sales')));
  assert.ok(!calls.some(query => /Marina Oliveira|Paulo Mendes|Camila Rocha|3000000/.test(query)));
  assert.equal(report.totalSold, 100000);
  assert.equal(report.salesCount, 1);
  assert.equal(report.averageTicket, 100000);
  assert.equal(report.brokers[0].sold, 100000);
  assert.equal(report.brokers[0].salesCount, 1);
  assert.equal(report.sales.length, 2);
  assert.equal(report.sales[0].dealType, 'Venda');
  assert.equal(report.sales[1].dealType, 'Aluguel');
  const rent = await api.createSale({ date: '2026-09-07', broker: 'Corretor', property: 'Apartamento', client: 'Locatário', amount: 2500, dealType: 'Aluguel' });
  assert.equal(rent.dealType, 'Aluguel'); assert.equal(rent.amount, 2500);
  calls.length = 0;
  const properties = await api.listProperties(true);
  assert.equal(properties[0].status, 'Vendido');
  assert.ok(calls.some((query) => query.startsWith('SUPABASE GET properties?')));
  assert.equal(properties[0].propertyType, 'Casa');
  const propertyInput = { title: 'Central', district: 'Centro', price: '500 mil', meta: '2 quartos', tone: 'sky', purpose: 'Venda', status: 'Disponível', propertyType: 'Apartamento', bedrooms: 2, parkingSpaces: 1, area: 70, images: [] };
  assert.equal((await api.createProperty(propertyInput)).propertyType, 'Apartamento');
  assert.equal(lastPropertyPayload.price, 500000, '500 mil must persist as 500000');
  await api.createProperty({ ...propertyInput, price: 'R$ 2.950,75/mês' });
  assert.equal(lastPropertyPayload.price, 2950.75);
  await assert.rejects(() => api.createProperty({ ...propertyInput, price: 'abc' }), /preço válido/);
  property.price = 2950.75;
  const exactPrice = (await api.listProperties())[0].price;
  await api.createProperty({ ...propertyInput, price: exactPrice });
  assert.equal(lastPropertyPayload.price, 2950.75, 'reading and editing must preserve cents');
  const appointments = await api.listAppointments();
  assert.equal(appointments[0].date, '2026-09-08');
  assert.equal(appointments[0].time, '22:30');
  assert.equal((await api.updateProperty('p2', propertyInput)).propertyType, 'Apartamento');
  console.log('PASS: rental/sale separation, legacy records, broker totals, history query filters, rental mapping, sold status, no demo seeding for automations.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
