// Real protectedRoute/session lookup, async tenant context, request guards and
// Meta library behind mocked storage and Graph HTTP. No live network or ad spend.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = { NODE_ENV: 'production', META_APP_ID: '1234567', META_APP_SECRET: 'synthetic-app-secret', SUPABASE_SECRET_KEY: 'synthetic-server-secret' };
const accounts = { owner: { broker_id: id(11), company_id: id(1), name: 'Owner A', company: 'Tenant A', role: 'owner' }, broker: { broker_id: id(12), company_id: id(1), name: 'Broker A', company: 'Tenant A', role: 'broker' }, foreign: { broker_id: id(21), company_id: id(2), name: 'Owner B', company: 'Tenant B', role: 'owner' } };
const tokens = { owner: 'a'.repeat(64), broker: 'b'.repeat(64), foreign: 'c'.repeat(64) };
const sessionRows = new Map(Object.entries(tokens).map(([key, token]) => [crypto.createHash('sha256').update(token).digest('hex'), accounts[key]]));
const database = [], graphCalls = [], connections = new Map(), creations = new Map(), cache = new Map();
let allowRate = true, connectionOverride, connectionMissing = false;
const responseJson = (value, options) => { const response = Response.json(value, options); response.savedCookies = []; response.cookies = { set: (...args) => response.savedCookies.push(args) }; return response; };
async function storage(resource, options = {}) {
  database.push({ resource, options });
  if (resource === 'rpc/account_session') { const account = sessionRows.get(options.body.p_hash); return account ? [account] : []; }
  if (resource === 'rpc/consume_rate_limit') return allowRate;
  const [table, query] = resource.split('?'), params = new URLSearchParams(query), company = params.get('company_id')?.slice(3);
  if (table === 'meta_ads_connections' && (!options.method || options.method === 'GET')) return connectionMissing ? [] : [connectionOverride || connections.get(company)].filter(Boolean);
  if (table === 'meta_ads_connections' && options.method === 'DELETE') { connections.delete(company); return undefined; }
  if (table === 'meta_ads_connections' && options.method === 'PATCH') { Object.assign(connections.get(company), options.body); return undefined; }
  if (table === 'meta_ads_oauth_requests' && options.method === 'POST') return undefined;
  if (table === 'meta_ads_campaign_requests') {
    if (options.method === 'POST') { const key = `${options.body.company_id}:${options.body.request_id}`; if (creations.has(key)) return []; creations.set(key, { ...options.body, campaign_id: null }); return [{ request_id: options.body.request_id }]; }
    const row = creations.get(`${company}:${params.get('request_id')?.slice(3)}`);
    if (options.method === 'PATCH') { Object.assign(row, options.body); return undefined; }
    return row ? [row] : [];
  }
  assert.fail(`Unexpected storage call: ${resource}`);
}
async function graphFetch(input, options) {
  const url = new URL(input); assert.equal(url.origin, 'https://graph.facebook.com');
  graphCalls.push({ url, options });
  const token = options.headers.Authorization, account = token === 'Bearer synthetic-token-A' ? '11111' : token === 'Bearer synthetic-token-B' ? '22222' : assert.fail('Unexpected provider credential');
  const resource = url.pathname.replace(/^\/v\d+\.\d+\//, '');
  if (options.method === 'POST') return Response.json(resource.endsWith('/campaigns') ? { id: '9001' } : { success: true });
  if (resource === 'me/adaccounts') return Response.json({ data: [{ id: `act_${account}`, name: `Account ${account}`, currency: 'BRL', account_status: 1 }] });
  if (/^act_\d+\/(campaigns|insights)$/.test(resource)) { assert.ok(resource.startsWith(`act_${account}/`), 'Metrics stay on the authorized account'); return Response.json({ data: [] }); }
  if (/^\d+$/.test(resource)) return Response.json({ id: resource === '3333' ? '4444' : resource, account_id: resource === '2222' ? '22222' : '11111', daily_budget: '2000', lifetime_budget: resource === '5555' ? '200000' : '0' });
  assert.fail(`Unexpected Graph resource: ${resource}`);
}
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} }; cache.set(file, module.exports);
  const localRequire = name => {
    if (name === 'next/server') return { NextResponse: { json: responseJson } };
    if (name === 'server-only') return {};
    if (name === '@/lib/supabase' || name === './supabase') return { supabaseRequest: storage, supabaseServiceRequest: storage };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
    return require(name);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: localRequire, process: { env }, Buffer, Date, URL, URLSearchParams, Response, Request, Headers, AbortSignal, console, fetch: graphFetch });
  return module.exports;
}
const meta = load('lib/meta-ads.ts');
const connection = (company, token, account) => ({ company_id: company, token_ciphertext: meta.encryptAdsToken(token, company), account_id: account, account_name: account, currency: 'BRL', expires_at: null });
connections.set(id(1), connection(id(1), 'synthetic-token-A', 'act_11111')); connections.set(id(2), connection(id(2), 'synthetic-token-B', 'act_22222'));
const route = load('app/api/integrations/meta/ads/route.ts');
function request(method, { actor = 'owner', query = '', body, raw, origin = 'https://app.example.test', length } = {}) {
  const headers = { ...(origin ? { origin } : {}), ...(length === undefined ? {} : { 'content-length': String(length) }) };
  const req = new Request(`https://app.example.test/api/integrations/meta/ads${query}`, { method, headers, ...(method === 'POST' ? { body: raw === undefined ? JSON.stringify(body) : raw } : {}) });
  req.nextUrl = new URL(req.url); req.cookies = { get: name => name === 'imobflow_session' && tokens[actor] ? { value: tokens[actor] } : undefined }; return req;
}
const posts = () => graphCalls.filter(call => call.options.method === 'POST');
const nonSessionReads = start => database.slice(start).filter(call => call.resource !== 'rpc/account_session');
(async () => {
  for (const method of ['GET', 'POST']) {
    let start = database.length;
    assert.equal((await route[method](request(method, { actor: 'missing', body: { action: 'disconnect' } }))).status, 401); assert.equal(database.length, start);
    start = database.length;
    assert.equal((await route[method](request(method, { actor: 'broker', query: `?role=owner&company_id=${id(2)}`, body: { action: 'disconnect', role: 'owner', companyId: id(2) } }))).status, 403);
    assert.equal(nonSessionReads(start).length, 0, 'Broker forbidden before connection, provider or rate-limit reads');
  }
  for (const origin of ['', 'https://attacker.example.test']) {
    const start = database.length;
    assert.equal((await route.POST(request('POST', { origin, body: { action: 'disconnect' } }))).status, 403); assert.equal(nonSessionReads(start).length, 0);
  }
  assert.equal((await route.POST(request('POST', { length: 8193, body: { action: 'disconnect' } }))).status, 413);
  const beforeOversize = graphCalls.length;
  for (const length of [undefined, 1]) assert.equal((await route.POST(request('POST', { length, raw: JSON.stringify({ action: 'connect', padding: 'á'.repeat(4200) }) }))).status, 413, 'Actual UTF-8 bytes checked even without/trusting-small Content-Length');
  assert.equal(graphCalls.length, beforeOversize);
  for (const raw of ['{bad', 'null', '[]', '"text"']) assert.equal((await route.POST(request('POST', { raw }))).status, 400);
  allowRate = false; assert.equal((await route.POST(request('POST', { body: { action: 'connect' } }))).status, 429); allowRate = true;
  const start = database.length;
  const status = await route.GET(request('GET', { query: `?company_id=${id(2)}&companyId=${id(2)}&accountId=act_22222` }));
  assert.equal(status.status, 200); assert.equal((await status.json()).accountId, 'act_11111'); assert.match(status.headers.get('cache-control'), /private, no-store/);
  assert.ok(nonSessionReads(start).every(call => call.resource.includes(`company_id=eq.${id(1)}`)), 'Tenant always comes from the authenticated session');
  const foreignStatus = await route.GET(request('GET', { actor: 'foreign' })); assert.equal((await foreignStatus.json()).accountId, 'act_22222');
  connectionOverride = connections.get(id(2)); const beforeInvalid = graphCalls.length;
  assert.equal((await route.GET(request('GET', { query: '?action=accounts' }))).status, 503); assert.equal(graphCalls.length, beforeInvalid); connectionOverride = undefined;
  assert.equal((await route.GET(request('GET', { query: `?action=metrics&company_id=${id(2)}&since=2026-10-01&until=2026-10-30` }))).status, 200);
  assert.ok(graphCalls.slice(beforeInvalid).every(call => call.options.headers.Authorization === 'Bearer synthetic-token-A'));
  const base = { action: 'update-campaign', campaignId: '1234', status: 'ACTIVE', dailyBudget: 25 };
  for (const confirmSpend of [undefined, false, 'true']) {
    const before = posts().length; const result = await route.POST(request('POST', { body: { ...base, confirmSpend } })); assert.equal(result.status, 422); assert.equal(posts().length, before, 'Activation requires explicit boolean confirmation');
  }
  for (const campaignId of ['2222', '3333']) {
    const before = posts().length; assert.equal((await route.POST(request('POST', { body: { ...base, campaignId, confirmSpend: true, accountId: 'act_22222' } }))).status, 403); assert.equal(posts().length, before, 'Campaign ID and owning account both verified before mutation');
  }
  for (const extra of [{ dailyBudget: 0 }, { dailyBudget: '25' }, { dailyBudget: 100001 }, { campaignId: '5555' }, { campaignId: '../other' }, { status: 'DELETED' }]) {
    const before = posts().length; assert.equal((await route.POST(request('POST', { body: { ...base, ...extra, confirmSpend: true } }))).status, 422); assert.equal(posts().length, before);
  }
  const active = await route.POST(request('POST', { query: `?company_id=${id(2)}`, body: { ...base, confirmSpend: true, companyId: id(2), accountId: 'act_22222', accessToken: 'caller-forged' } }));
  assert.equal(active.status, 200); assert.equal((await active.json()).campaign.status, 'ACTIVE');
  assert.equal(posts().at(-1).url.pathname, '/v26.0/1234'); assert.equal(posts().at(-1).options.headers.Authorization, 'Bearer synthetic-token-A');
  assert.equal(new URLSearchParams(posts().at(-1).options.body).get('daily_budget'), '2500');
  const paused = await route.POST(request('POST', { body: { action: 'update-campaign', campaignId: '1234', status: 'PAUSED', dailyBudget: 99999 } }));
  assert.equal(paused.status, 200); assert.equal(new URLSearchParams(posts().at(-1).options.body).get('status'), 'PAUSED'); assert.equal(new URLSearchParams(posts().at(-1).options.body).has('daily_budget'), false);
  const create = { action: 'create-campaign', name: 'Fictional house', dailyBudget: 30, objective: 'OUTCOME_LEADS', requestId: id(40), status: 'ACTIVE', companyId: id(2) };
  assert.equal((await route.POST(request('POST', { body: create }))).status, 200); assert.equal(new URLSearchParams(posts().at(-1).options.body).get('status'), 'PAUSED');
  const createdCount = posts().length; assert.equal((await route.POST(request('POST', { body: create }))).status, 200); assert.equal(posts().length, createdCount, 'Route retries reuse the creation ledger');
  const oauth = await route.POST(request('POST', { body: { action: 'connect', companyId: id(2), brokerId: id(21), redirectUri: 'https://attacker.example.test' } }));
  assert.equal(oauth.status, 200); const cookie = oauth.savedCookies[0]; assert.equal(cookie[2].httpOnly, true); assert.equal(cookie[2].secure, true); assert.equal(cookie[2].sameSite, 'lax');
  const oauthRow = database.findLast(call => call.resource === 'meta_ads_oauth_requests').options.body;
  assert.equal(oauthRow.company_id, id(1)); assert.equal(oauthRow.broker_id, id(11)); assert.equal(oauthRow.redirect_uri, 'https://app.example.test/api/integrations/meta/ads/callback');
  connectionMissing = true; const beforeMissing = posts().length; assert.equal((await route.POST(request('POST', { body: { ...base, confirmSpend: true } }))).status, 422); assert.equal(posts().length, beforeMissing);
  console.log('PASS Meta Ads routes: actual session/tenant context, owner-only early gates, Origin and byte bounds, authenticated account binding, explicit spend confirmation, safe pause, private caching, OAuth scope and idempotent paused creation. Synthetic Graph/storage only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
