// Workflow regression tests with a fake transport. No real DB or messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const now = Date.now();
let lead = { id: 'lead', name: 'João', phone: '(11) 99999-9999', goal: 'Comprar', propertyType: 'Apartamento', region: 'Centro', budget: 'Até R$ 500 mil', details: '2 quartos', lifecycleStatus: 'Novo', createdAt: new Date(now - 14 * 86400000).toISOString() };
let properties = ['p1', 'p2'].map(id => ({ id, title: 'Apartamento Central', propertyType: 'Apartamento', district: 'Centro', price: 'R$ 500.000', meta: '2 quartos', purpose: 'Venda', status: 'Disponível', createdAt: new Date(now - 3600000).toISOString() }));
const records = new Map();
let savedResult = { lead_id: lead.id, detail: { propertyId: 'p1' } };
let propertyReads = 0;
let writes = 0;
let auth = true;
async function sql(parts, ...values) {
  const query = parts.join('?');
  if (query.includes('INSERT INTO site_automation_lock')) return [{ token: values[0] }];
  if (query.trim().startsWith('SELECT id FROM site_automation_settings')) return [{ id: 'new-property' }];
  if (query.includes("UPDATE site_automation_results r SET status='cancelled'")) {
    assert.ok(!query.includes('site_leads'));
    const states = JSON.parse(values.find(value => typeof value === 'string' && value.startsWith('[')));
    assert.equal(states[0].lifecycle_status, lead.lifecycleStatus);
    assert.equal(states[0].contact_version, lead.lastContactAt || lead.createdAt);
    return [];
  }
  if (query.includes('WITH enabled AS')) {
    const payload = JSON.parse(values.find(value => typeof value === 'string' && value.startsWith('[{')) || '[]');
    let processed = 0;
    for (const item of payload) {
      const key = item.lead_id + item.fingerprint;
      if (!records.has(key)) { records.set(key, item); processed++; }
    }
    writes++;
    assert.ok(query.includes('ON CONFLICT DO NOTHING'));
    assert.ok(query.includes('active=TRUE FOR SHARE'));
    return [{ processed }];
  }
  if (query.includes('SELECT lead_id, detail')) return savedResult ? [savedResult] : [];
  return [];
}
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  function localRequire(name) {
    if (name === '@neondatabase/serverless') return { neon: () => sql };
    if (name === './database') return {
      listLeads: async () => [lead],
      listProperties: async (automationOnly) => { assert.equal(automationOnly, true); propertyReads++; return properties; }
    };
    if (name === './supabase') return { supabaseCompanyId: () => 'test-company' };
    if (name === '@/lib/admin-auth') return { isAdminRequest: () => auth };
    if (name === '@/lib/accounts') return { protectedRoute: (handler) => handler };
    if (name === '@/lib/supabase') return { supabaseCompanyId: () => 'test-company' };
    if (name === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(relative), name + '.ts'));
    return require(name);
  }
  vm.runInNewContext(output, { module, exports: module.exports, require: localRequire, process: { env: { DATABASE_URL: 'mock-only' } }, Date, console });
  cache.set(relative, module.exports);
  return module.exports;
}
(async () => {
  const api = load('lib/automations.ts');
  const first = await api.runAutomations('manual', 'new-property');
  assert.equal(first.processed, 2); assert.equal(first.failed, 0); assert.equal(records.size, 2);
  const second = await api.runAutomations('event', 'new-property');
  assert.equal(second.processed, 0); assert.equal(propertyReads, 2);
  console.log('PASS new flow loads actual property source, saves each opportunity and does not duplicate');
  const draft = await api.prepareMatchMessage('draft');
  assert.equal(draft.phone, '5511999999999'); assert.match(draft.message, /Olá, João!/);
  const beforeReview = writes;
  properties = properties.map(p => ({ ...p, status: 'Vendido' }));
  assert.ok((await api.prepareMatchMessage('draft')).error);
  properties = properties.map(p => ({ ...p, status: 'Disponível' }));
  lead = { ...lead, budget: 'Até R$ 400 mil' };
  assert.ok((await api.prepareMatchMessage('draft')).error);
  lead = { ...lead, budget: 'Até R$ 500 mil', phone: '' };
  assert.equal((await api.prepareMatchMessage('draft')).phone, null);
  assert.equal(writes, beforeReview);
  savedResult = null;
  assert.ok((await api.prepareMatchMessage('draft')).error);
  console.log('PASS review revalidates sold/changed/missing data; never records a send');
  const route = load('app/api/automations/route.ts');
  const request = (body, origin = 'https://example.test') => ({ headers: { get: () => origin }, nextUrl: { origin: 'https://example.test' }, json: async () => body });
  auth = false;
  assert.equal((await route.POST(request({ action: 'prepare-message', id: 'bad' }))).status, 401);
  auth = true;
  assert.equal((await route.POST(request({}, 'https://other.test'))).status, 403);
  assert.equal((await route.POST(request({ action: 'prepare-message', id: 'bad' }))).status, 400);
  assert.equal((await route.POST(request({ action: 'prepare-message', id: '00000000-0000-0000-0000-000000000001' }))).status, 409);
  console.log('PASS authenticated, same-origin draft endpoint validates IDs and rejects unavailable drafts');
})().catch(error => { console.error(error); process.exitCode = 1; });
