const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function runtime(overrides = {}, env = { NODE_ENV: 'production' }, globals = {}) {
  const cache = new Map();
  function load(relative) {
    const file = path.resolve(root, relative), name = path.relative(root, file).replaceAll('\\', '/');
    if (overrides[name]) return overrides[name];
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, process: { env }, URL, URLSearchParams, Headers, Response, Request, Buffer, AbortSignal, console, Date, setTimeout, clearTimeout, fetch: () => { throw new Error('Network not authorized'); }, require(id) {
      if (overrides[id]) return overrides[id];
      if (id.startsWith('node:') || id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
      const base = id.startsWith('@/') ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const target = ['.ts', '.tsx'].map(ext => base + ext).find(fs.existsSync);
      assert(target && target.startsWith(root + path.sep), `Unexpected import ${id}`);
      return load(path.relative(root, target));
    }, ...globals }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  return { load };
}
(async () => {
  const modules = runtime(), host = modules.load('lib/website/domains-host.ts'), provider = modules.load('lib/website/domains-provider.ts');
  for (const invalid of ['https://example.com','example.com/path','example.com:443','*.example.com','user@example.com','127.0.0.1','localhost','x.internal','a..com','evil.com,imobflow.net.br','imobflow.net.br','www.imobflow.net.br','api.imobflow.net.br','tenant.vercel.app']) assert.throws(() => host.normalizeCustomHostname(invalid), invalid);
  assert.equal(host.normalizeCustomHostname(' WWW.Example.COM. '), 'www.example.com');
  assert(!host.isCoreWebsiteHost('localhost'));
  assert(host.isCoreWebsiteHost('localhost', { NODE_ENV: 'development' }));
  assert(!host.isCoreWebsiteHost('other.vercel.app', { NODE_ENV: 'production', VERCEL_URL: 'own.vercel.app' }));
  assert(host.isCoreWebsiteHost('own.vercel.app', { NODE_ENV: 'production', VERCEL_URL: 'own.vercel.app' }));
  assert(host.isCoreWebsiteHost('staging.example.com', { WEBSITE_TRUSTED_ORIGINS: 'https://staging.example.com' }));
  assert(!host.isCoreWebsiteHost('evil.com', { WEBSITE_TRUSTED_ORIGINS: 'https://evil.com/path' }));
  assert.equal(host.requestHostname(new Headers({ host: 'www.example.com:443', 'x-forwarded-host': 'imobflow.net.br' })), 'www.example.com');
  assert.equal(host.requestHostname(new Headers({ 'x-forwarded-host': 'imobflow.net.br' })), '');
  assert.equal(host.requestHostname(new Headers({ host: 'example.com,imobflow.net.br' })), '');
  for (const p of ['/painel','/api/leads','/site/editar','/api/website','/imobiliaria/other','/api/site/other','/_next/data/build/painel.json']) assert.equal(host.allowedCustomPath(p, 'tenant-a', 'GET'), null);
  assert.equal(host.allowedCustomPath('/', 'tenant-a', 'POST'), null);
  assert.equal(host.allowedCustomPath('/', 'tenant-a', 'GET'), 'root');
  assert.equal(host.allowedCustomPath('/api/site/tenant-a/inquiry', 'tenant-a', 'POST'), 'site');
  assert.equal(host.allowedCustomPath('/_next/static/chunk.js', 'tenant-a', 'GET'), 'asset');
  for (const ip of ['127.0.0.1','10.2.3.4','192.168.0.1','169.254.169.254','172.16.0.1','100.64.0.1','198.18.0.1','0.0.0.0','224.0.0.1','192.0.2.1','198.51.100.1','203.0.113.1','::1']) assert(!provider.publicDomainIPv4(ip), ip);
  assert(provider.publicDomainIPv4('8.8.8.8'));
  assert.equal(provider.domainProviderConfig({ VERCEL_TOKEN: 'cli-or-unrelated-token', VERCEL_PROJECT_ID: 'prj_test' }), null, 'No CLI/general credentials are reused');
  const hostname = 'www.example.com', token = 'a'.repeat(64), config = { token: 'synthetic-server-token', projectId: 'prj_fixture', teamId: 'team_fixture' };
  const project = { name: hostname, apexName: 'example.com', projectId: config.projectId, verified: true };
  const dns = { misconfigured: false, configuredBy: 'CNAME', recommendedCNAME: [{ rank: 1, value: 'tenant-specific.vercel-dns.com' }], recommendedIPv4: [{ rank: 1, value: ['8.8.8.8'] }] };
  const calls = [];
  const deps = { config, txt: async () => [[`imobflow-verification=${token}`]], tls: async () => true, provider: async (_config, p, method = 'GET', body) => { calls.push({ p, method, body }); return p.includes('/config?') ? dns : project; } };
  const noProof = await provider.checkWebsiteDomain(hostname, token, { ...deps, txt: async () => [['wrong']] });
  assert.equal(noProof.status, 'pending'); assert.equal(calls.length, 0, 'No Vercel mutation before independent ownership proof');
  const noRuntimeCredentials = await provider.checkWebsiteDomain(hostname, token, { ...deps, config: null });
  assert.equal(noRuntimeCredentials.status, 'verified'); assert(!noRuntimeCredentials.tlsVerified); assert.equal(calls.length, 0);
  const active = await provider.checkWebsiteDomain(hostname, token, deps);
  assert.equal(active.status, 'active'); assert(active.ownershipVerified && active.providerVerified && active.dnsValid && active.tlsVerified);
  assert.equal(active.records[0].value, 'tenant-specific.vercel-dns.com', 'DNS instruction comes from provider response, never hard-coded');
  const noTls = await provider.checkWebsiteDomain(hostname, token, { ...deps, tls: async () => false }); assert.equal(noTls.status, 'provisioning');
  let tlsCalls = 0;
  const noDns = await provider.checkWebsiteDomain(hostname, token, { ...deps, provider: async (_c, p) => p.includes('/config?') ? { ...dns, misconfigured: true } : project, tls: async () => { tlsCalls++; return true; } });
  assert.equal(noDns.status, 'provisioning'); assert.equal(tlsCalls, 0, 'DNS must be correct before probing TLS');
  const wrongProject = await provider.checkWebsiteDomain(hostname, token, { ...deps, provider: async () => ({ ...project, projectId: 'prj_foreign' }) }); assert.equal(wrongProject.status, 'error');
  const redirect = await provider.checkWebsiteDomain(hostname, token, { ...deps, provider: async () => ({ ...project, redirect: 'foreign.example.com' }) }); assert.equal(redirect.status, 'error');
  const conflicts = [];
  const occupied = await provider.checkWebsiteDomain(hostname, token, { ...deps, provider: async (_c, p, method) => { conflicts.push(method); throw new provider.DomainProviderFailure(method === 'POST' ? 409 : 404); } });
  assert.equal(occupied.status, 'error'); assert.deepEqual(conflicts, [undefined, 'POST'], 'An occupied provider domain is never transferred or force-moved');
  const pendingProject = { ...project, verified: false, verification: [{ type: 'TXT', domain: '_vercel.example.com', value: 'provider-proof' }] };
  const providerPending = await provider.checkWebsiteDomain(hostname, token, { ...deps, provider: async (_c, p) => { if (p.endsWith('/verify')) throw new provider.DomainProviderFailure(400); return p.includes('/config?') ? dns : pendingProject; } });
  assert.equal(providerPending.status, 'provisioning'); assert(providerPending.records.some(r => r.value === 'provider-proof'));
  const splitProof = await provider.checkWebsiteDomain(hostname, token, { ...deps, txt: async () => [['imobflow-verification=', token]] }); assert.equal(splitProof.status, 'active');

  let queries = 0, databaseDown = false;
  const db = { supabaseRequest: async p => { queries++; if (databaseDown) throw Error('offline'); return p.includes('hostname=eq.www.example.com') ? [{ company_id: 'tenant-a-id', companies: { slug: 'tenant-a' } }] : []; } };
  class NextResponse extends Response {
    static next() { return new Response(null, { status: 200, headers: { 'x-test-next': 'true' } }); }
    static rewrite(url) { return new Response(null, { status: 200, headers: { 'x-test-rewrite': url.href } }); }
    static json(data, options) { return Response.json(data, options); }
  }
  const isolated = runtime({ 'lib/supabase.ts': db, 'next/server': { NextResponse } });
  const routing = isolated.load('lib/website/domains-routing.ts'), proxy = isolated.load('proxy.ts');
  const headers = new Headers({ host: hostname, 'x-forwarded-host': 'imobflow.net.br', 'x-imobflow-company': 'other' });
  await routing.assertPublicWebsiteHost(headers, 'tenant-a');
  await assert.rejects(() => routing.assertPublicWebsiteHost(headers, 'tenant-b'), error => error.status === 404);
  await assert.rejects(() => routing.assertPublicWebsiteHost(new Headers({ host: 'unknown.example.com' }), 'tenant-a'), error => error.status === 404);
  assert.throws(() => routing.assertCoreWebsiteHost(headers), error => error.status === 404);
  function req(hostname, pathname = '/', method = 'GET', extra = {}) { const nextUrl = new URL(`https://${hostname}${pathname}`); nextUrl.clone = () => new URL(nextUrl.href); return { headers: new Headers({ host: hostname, ...extra }), nextUrl, method }; }
  const q = queries; assert.equal((await proxy.proxy(req('imobflow.net.br', '/painel'))).headers.get('x-test-next'), 'true'); assert.equal(queries, q, 'Core hosts do not depend on domains database availability');
  assert.equal((await proxy.proxy(req(hostname))).headers.get('x-test-rewrite'), `https://${hostname}/imobiliaria/tenant-a`);
  for (const p of ['/painel','/api/leads','/imobiliaria/tenant-b','/api/site/tenant-b','/api/website/domains']) assert.equal((await proxy.proxy(req(hostname, p))).status, 404, p);
  assert.equal((await proxy.proxy(req('unknown.example.com', '/_next/static/a.js', 'GET', { 'x-forwarded-host': 'imobflow.net.br' }))).status, 404);
  databaseDown = true; assert.equal((await proxy.proxy(req(hostname))).status, 404, 'Database failures never expose the platform on custom hosts');

  let publicReads = 0;
  const publicRoute = runtime({ 'next/server': { NextResponse }, 'lib/website/model.ts': isolated.load('lib/website/model.ts'), 'lib/website/domains-routing.ts': routing, 'lib/website/server.ts': { getPublicWebsite: async () => { publicReads++; return { content: {}, properties: [] }; } } }).load('app/api/site/[slug]/route.ts');
  databaseDown = false;
  assert.equal((await publicRoute.GET({ headers }, { params: Promise.resolve({ slug: 'tenant-b' }) })).status, 404);
  assert.equal(publicReads, 0, 'Handler independently denies cross-tenant data even when Proxy is bypassed');
  assert.equal((await publicRoute.GET({ headers }, { params: Promise.resolve({ slug: 'tenant-a' }) })).status, 200);
  assert.equal(publicReads, 1);
  console.log('PASS website domains: strict Host routing, tenant isolation, unknown-host denial, no forwarded spoof, independent public-handler guard, TXT before provisioning, no credential reuse, provider DNS, TLS gate and no domain takeover.');
})().catch(error => { console.error(error); process.exitCode = 1; });
