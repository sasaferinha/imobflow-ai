const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => dependencies[name], Date, Map, Set, Intl });
  return module.exports;
}
const api = load('lib/evolution/buyer-report.ts');
const record = (id, kind, data) => ({ id, kind, data });
const state = { companyId: 'tenant-a', settings: { buyerReportFrequency: 'monthly' }, members: [{ id: 'owner', name: 'Administrador', role: 'owner' }], events: [], records: [
  record('buyer', 'people', { name: 'Cliente sintético' }), record('lead', 'leads', { budgetMax: 600000, financing: 'Financiamento', region: 'Centro' }),
  record('property', 'properties', { name: 'Casa sintética', district: 'Centro', city: 'Cidade teste', propertyType: 'Casa', price: 999999 }),
  record('sale', 'cases', { status: 'Ganho', purpose: 'Venda', journey: 'Negociação', personId: 'buyer', leadId: 'lead', propertyId: 'property', closedAt: '2026-10-01T03:00:00Z', source: 'Facebook', assignedTo: 'owner' }),
  record('proposal', 'proposals', { caseId: 'sale', propertyId: 'property', status: 'Aceita', amount: 500000 }),
  record('second-sale', 'cases', { status: 'Ganho', purpose: 'Venda', journey: 'Negociação', personId: 'buyer', closedAt: '2026-10-31T03:00:00Z' }),
  record('undated', 'cases', { status: 'Ganho', purpose: 'Venda', journey: 'Negociação' }),
  record('reopened', 'cases', { status: 'Aberto', purpose: 'Venda', closedAt: '2026-10-10T03:00:00Z' }),
  record('capture', 'cases', { status: 'Ganho', purpose: 'Venda', journey: 'Captação', closedAt: '2026-10-10T03:00:00Z' }),
  record('rental', 'cases', { status: 'Ganho', purpose: 'Aluguel', closedAt: '2026-10-10T03:00:00Z' }),
] };
const now = new Date('2026-11-02T12:00:00Z');
const report = api.buildBuyerReport(state, 'monthly', now), october = report.periods[1];
assert.equal(october.key, '2026-10'); assert.equal(october.sales, 2); assert.equal(october.customers, 1); assert.equal(october.totalAmount, 500000); assert.equal(october.averageAmount, 500000); assert.equal(october.missingAmount, 1); assert.equal(report.undatedSales, 1);
assert.equal(october.sources.find(row => row.label === 'Facebook').count, 1);
assert.equal(october.buyers.find(row => row.caseId === 'sale').amount, 500000, 'Negotiated amount, never asking price');
assert.equal(october.buyers.find(row => row.caseId === 'second-sale').amount, null, 'Unknown stays unknown');
assert.equal(api.buyerReportPeriods('weekly', new Date('2026-11-02T02:59:59Z'))[0].key, '2026-10-26');
assert.equal(api.buyerReportPeriods('weekly', new Date('2026-11-02T03:00:00Z'))[0].key, '2026-11-02');
assert.equal(api.buyerReportPeriods('monthly', new Date('2026-11-01T02:59:59Z'))[0].key, '2026-10');
state.events.push({ recordId: 'sale', at: '2026-11-02T11:00:00Z', changes: { status: { to: 'Ganho' } } });
const renewed = api.buildBuyerReport(state, 'monthly', now); assert.equal(renewed.periods[0].sales, 1); assert.equal(renewed.periods[1].sales, 1, 'Latest reclosure wins over stale close date');
(async () => {
  let actor = { companyId: 'tenant-a', brokerId: 'owner', role: 'broker' }, reads = 0;
  const route = load('app/api/reports/buyers/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } }, '@/lib/accounts': { protectedRoute: handler => handler },
    '@/lib/tenant-context': { currentAccount: () => actor }, '@/lib/evolution/buyer-report': api,
    '@/lib/evolution/buyer-report-store': { readScheduledBuyerReports: async () => [] },
    '@/lib/evolution/server': { EvolutionServerError: class extends Error {}, getEvolutionSnapshot: async () => { reads++; return { state }; } },
  });
  assert.equal((await route.GET()).status, 403); assert.equal(reads, 0, 'Broker rejected before customer read');
  actor.role = 'owner'; const response = await route.GET(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  actor.companyId = 'tenant-b'; assert.equal((await route.GET()).status, 403, 'Cross-tenant snapshot rejected');
  console.log('PASS buyers: owner-only tenant boundary, SP calendar periods, latest confirmed purchases, reopened/rental/capture exclusions, deduplication and unknown prices.');
})().catch(error => { console.error(error); process.exitCode = 1; });
