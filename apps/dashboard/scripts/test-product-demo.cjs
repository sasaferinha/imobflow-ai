const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const location = { pathname: '/painel', origin: 'https://www.imobflow.net.br' };
const nativeCalls = [];
const nativeFetch = async (...args) => {
  nativeCalls.push(args);
  return Response.json({ native: true });
};
const browser = { location };
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../lib', `${name}.ts`), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: dependency => {
      assert.equal(dependency, './demo-conversations', 'fixture must import only the existing client-side fictional conversation examples');
      return load('demo-conversations');
    },
    window: browser, location, fetch: nativeFetch, Date, Intl, Request, Response, URL, DOMException,
    process: { env: { NEXT_PUBLIC_APP_RELEASE: 'demo-test' } },
  });
  cache.set(name, module.exports);
  return module.exports;
}

async function run() {
  const { dashboardFetch, installProductDemoTransport } = load('dashboard-transport');
  const { createProductDemoTransport } = load('product-demo-data');
  const fixture = createProductDemoTransport();

  const options = { method: 'POST', body: '{"content":"normal operation"}' };
  assert.equal((await (await dashboardFetch('/api/conversations', options)).json()).native, true);
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0][0], '/api/conversations');
  assert.equal(nativeCalls[0][1], options, 'normal dashboard must forward original options unchanged');
  assert.throws(() => installProductDemoTransport(fixture), /demonstration page/);

  location.pathname = '/demonstracao';
  assert.equal((await dashboardFetch('/api/leads')).status, 503, 'demo must fail closed before its fixture is installed');
  assert.equal(nativeCalls.length, 1, 'uninitialized demo must not use native fetch');
  const dispose = installProductDemoTransport(fixture);

  const routes = [
    'leads', 'conversations', 'conversations/demo', 'conversations/settings', 'properties',
    'appointments', 'performance', 'opportunities', 'brokers', 'account/profile', 'conversations/whatsapp',
    'integrations/meta/embedded-signup', 'version',
  ];
  for (const route of routes) {
    const result = await dashboardFetch(`/api/${route}`);
    assert.equal(result.status, 200, route);
    assert.ok(await result.json(), route);
  }
  const json = async route => (await (await dashboardFetch(route)).json()).data;
  const leads = await json('/api/leads');
  const properties = await json('/api/properties');
  const performance = await json('/api/performance');
  const opportunities = await json('/api/opportunities');
  assert.equal(leads.length, 3);
  assert.equal(performance.brokers.length, 2);
  const team = await json('/api/brokers');
  for (const broker of performance.brokers) assert.ok(team.some(member => member.id === broker.brokerId && member.active === broker.active), 'demo metrics preserve stable broker identity for goal and sale forms');
  assert.equal(performance.leadsReceived, leads.length);
  assert.equal(performance.convertedLeads, leads.filter(lead => lead.lifecycleStatus === 'Convertido').length);
  assert.equal(performance.totalSold, performance.sales.reduce((sum, sale) => sum + sale.amount, 0));
  assert.equal(performance.totalSold, performance.brokers.reduce((sum, broker) => sum + broker.sold, 0));
  assert.equal(performance.leadsReceived, performance.brokers.reduce((sum, broker) => sum + broker.leadsReceived, 0));
  for (const sale of performance.sales) {
    assert.equal(properties.find(property => property.title === sale.property)?.status, 'Vendido');
  }
  for (const opportunity of opportunities) {
    assert.ok(leads.find(lead => lead.id === opportunity.leadId));
    assert.equal(properties.find(property => property.id === opportunity.propertyId)?.status, 'Disponível');
  }
  leads[0].name = 'Modified by a caller';
  assert.notEqual((await json('/api/leads'))[0].name, leads[0].name, 'responses must not expose mutable fixture state');
  assert.equal((await json('/api/opportunities?offset=50')).length, 0);
  assert.equal((await json('/api/performance?month=2001-02')).totalSold, 0);
  assert.equal((await json('/api/integrations/meta/embedded-signup')).available, false, 'demo must not load the Meta SDK');

  const mutationRoutes = [...routes, 'admin/logout', 'account/password', 'brokers/example', 'conversations/owner'];
  for (const route of mutationRoutes) {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const result = await dashboardFetch(`/api/${route}`, { method, body: '{}' });
      assert.equal(result.status, 403, `${method} ${route} must not alter production`);
      assert.match((await result.json()).error, /demonstração/);
    }
  }
  const request = new Request(`${location.origin}/api/conversations`, { method: 'POST', body: '{}' });
  assert.equal((await dashboardFetch(request)).status, 403, 'Request objects must not bypass mutation protection');
  for (const url of ['https://example.com/api/leads', '//example.com/api/leads']) {
    assert.equal((await dashboardFetch(url)).status, 403, 'outside origins must not be forwarded');
  }
  assert.equal((await dashboardFetch('/api/not-in-the-preview')).status, 404);
  assert.equal((await dashboardFetch('/api/opportunities', { method: 'POST', body: 'null' })).status, 403);
  const draft = await dashboardFetch('/api/opportunities', {
    method: 'POST', body: JSON.stringify({ id: opportunities[0].id, action: 'draft' }),
  });
  assert.equal(draft.status, 200);
  const draftData = (await draft.json()).data;
  assert.equal(draftData.url, '#demonstracao-sem-envio', 'fictional draft must not contain a real recipient or external URL');
  assert.match(draftData.message, /nenhuma mensagem será enviada/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(dashboardFetch('/api/leads', { signal: abort.signal }), { name: 'AbortError' });
  assert.equal(nativeCalls.length, 1, 'no fixture reads, writes or errors may fall through to native fetch');
  dispose();
  assert.equal((await dashboardFetch('/api/leads')).status, 503, 'cleanup must also fail closed');
  location.pathname = '/demonstracao/';
  assert.equal((await dashboardFetch('/api/leads')).status, 503, 'trailing-slash route must be isolated');
  location.pathname = '/painel';
  assert.equal((await (await dashboardFetch('/api/leads')).json()).native, true);
  assert.equal(nativeCalls.length, 2, 'normal dashboard still uses its native transport');
  console.log(`PASS product demo: all tabs have coherent fictional data; ${mutationRoutes.length * 4} writes blocked; external and unknown requests isolated; no native fallback; production transport preserved`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
