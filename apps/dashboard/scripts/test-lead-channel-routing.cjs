const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');
const root = path.join(__dirname, '..');

function runtime(overrides = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} }; cache.set(file, module.exports);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, Buffer, Date, URL, URLSearchParams, Request, Response, Headers, AbortSignal, process: { env: {} }, console: { error() {} }, require(name) {
      const target = name.startsWith('@/') ? name.slice(2) + '.ts' : name.startsWith('.') ? path.posix.join(path.posix.dirname(file), name) + '.ts' : name;
      if (overrides[target]) return overrides[target];
      if (name === 'next/server') return { NextRequest: Request, NextResponse: Response };
      if (name.startsWith('node:')) return require(name);
      return load(target);
    } }, { filename: file });
    cache.set(file, module.exports); return module.exports;
  }
  return load;
}

async function routingAndRoute() {
  let source = 'Instagram Direct', stored = 'instagram', thread = { threadId: id(4), leadId: id(3), channel: 'instagram' }, allowed = true, rate = true;
  const calls = [], sent = [], image = 'https://cdn.example.com/photo.jpg';
  const account = { company_id: id(1), broker_id: id(11), name: 'Owner', company: 'Company', role: 'owner' };
  const db = async (resource, options = {}) => {
    calls.push(resource);
    if (resource === 'rpc/account_session') return [account];
    if (resource === 'rpc/consume_rate_limit') return rate;
    if (resource === 'rpc/opportunity_delivery_context') {
      assert.equal(options.body.p_company_id, id(1)); assert.equal(options.body.p_broker_id, id(11));
      if (!allowed) throw Error('opportunity_not_found');
      return { lead_id: id(3), property_id: id(5) };
    }
    assert.ok(resource.includes('company_id=eq.' + id(1)));
    if (resource.startsWith('leads?')) return [{ source, interest_profile: { socialChannel: stored } }];
    if (resource.startsWith('properties?')) return [{ images: [image] }];
    throw Error('Unexpected direct read ' + resource);
  };
  const load = runtime({
    'lib/supabase.ts': { supabaseServiceRequest: db, supabaseRequest: db },
    'lib/social-messaging.ts': {
      resolveSocialThreadForLead: async leadId => { assert.equal(leadId, id(3)); return thread; },
      sendSocialMessage: async input => { sent.push(input); assert.equal(input.threadId, id(4)); assert(input.deadline > Date.now() + 40000 && input.deadline <= Date.now() + 45000); return { threadId: id(4), messages: [{ status: 'sent' }] }; },
    },
  });
  const pure = load('lib/lead-channel.ts'), server = load('lib/lead-channel-server.ts');
  const { withAccount } = load('lib/tenant-context.ts');
  const actor = { companyId: id(1), brokerId: id(11), name: 'Owner', company: 'Company', role: 'owner' };
  assert.equal(pure.leadChannel('Instagram Direct'), 'instagram');
  assert.equal(pure.leadChannel('Facebook Messenger'), 'facebook');
  assert.equal(pure.leadChannel('WhatsApp'), 'whatsapp');
  assert.equal(pure.leadChannel('Facebook Lead Ads'), 'whatsapp');
  await withAccount(actor, async () => {
    assert.equal((await server.opportunityMessageDestination(id(6))).channel, 'instagram');
    thread = null; await assert.rejects(() => server.leadMessageDestination(id(3)), /canal de origem/);
    source = 'WhatsApp'; stored = undefined;
    assert.equal((await server.leadMessageDestination(id(3))).channel, 'whatsapp');
    thread = { threadId: id(4), leadId: id(3), channel: 'facebook' };
    await assert.rejects(() => server.leadMessageDestination(id(3)), /origem/);
    source = 'Facebook Messenger'; stored = 'instagram';
    await assert.rejects(() => server.leadMessageDestination(id(3)), /cadastro/);
    allowed = false; const before = calls.length;
    await assert.rejects(() => server.opportunityMessageDestination(id(6)), /opportunity_not_found/);
    assert.deepEqual(calls.slice(before), ['rpc/opportunity_delivery_context']);
  });
  await assert.rejects(() => server.leadMessageDestination(id(3)), /indisponível/);
  const route = load('app/api/opportunities/social-send/route.ts');
  const payload = { opportunityId: id(6), requestId: id(7), content: 'Imóvel do seu interesse', images: [image], confirmed: true };
  function request(body = payload, headers = {}, authenticated = true) {
    const r = new Request('https://app.example.com/api/opportunities/social-send', { method: 'POST', headers: { origin: 'https://app.example.com', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    r.nextUrl = new URL(r.url); r.cookies = { get: name => name === 'imobflow_session' && authenticated ? { value: 'a'.repeat(64) } : undefined }; return r;
  }
  allowed = true; source = 'Instagram Direct'; stored = 'instagram'; thread = { threadId: id(4), leadId: id(3), channel: 'instagram' };
  assert.equal((await route.POST(request(payload, {}, false))).status, 401);
  assert.equal((await route.POST(request(payload, { origin: 'https://foreign.example.com' }))).status, 403);
  assert.equal((await route.POST(request(payload, { origin: '' }))).status, 403);
  const beforeSize = calls.length;
  assert.equal((await route.POST(request(payload, { 'content-length': '18001' }))).status, 413);
  assert(!calls.slice(beforeSize).includes('rpc/consume_rate_limit'), 'header size rejected before body/rate work');
  assert.equal((await route.POST(request('x'.repeat(18001)))).status, 413);
  assert.equal((await route.POST(request('null'))).status, 400);
  assert.equal((await route.POST(request('{'))).status, 400);
  assert.equal((await route.POST(request({ ...payload, channel: 'facebook' }))).status, 400, 'client cannot choose channel');
  rate = false; assert.equal((await route.POST(request())).status, 429); rate = true;
  assert.equal(sent.length, 0);
  assert.equal((await route.POST(request({ ...payload, images: ['https://foreign.example.com/photo.jpg'] }))).status, 400);
  const success = await route.POST(request());
  assert.equal(success.status, 200); assert.match(success.headers.get('cache-control'), /no-store/); assert.equal(sent.length, 1);
  source = 'WhatsApp'; stored = undefined; thread = null;
  assert.equal((await route.POST(request())).status, 409); assert.equal(sent.length, 1, 'social route never switches to WhatsApp');
  assert(!calls.some(resource => resource.startsWith('opportunities?')), 'private opportunity table is only accessed through authorized RPC');
}

async function sqlPrivileges() {
  const db = await createDatabase();
  try {
    await seedCompanies(db);
    await db.exec(migration('20261108121000_social_messaging.sql'));
    await db.query('INSERT INTO opportunities(id,company_id,lead_id,property_id,match_score,reasons) VALUES($1,$2,$3,$4,100,$5)', [id(991), id(1), id(101), id(301), '[]']);
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'Other','other','scrypt-v1$fixture','broker',true,'other@example.test','other@example.test')", [id(12), id(1)]);
    const context = (company = 1, broker = 11) => db.query('SELECT opportunity_delivery_context($1,$2,$3) result', [id(company), id(broker), id(991)]);
    await db.exec('SET ROLE service_role');
    await assert.rejects(() => db.query('SELECT * FROM opportunities'), /permission denied/, 'no broad table grant added');
    assert.deepEqual((await context()).rows[0].result, { lead_id: id(101), property_id: id(301) });
    await assert.rejects(() => context(2, 21), /opportunity_not_found/);
    await assert.rejects(() => context(1, 21), /opportunity_not_found/);
    await assert.rejects(() => context(1, 12), /opportunity_not_found/);
    await db.exec('RESET ROLE');
    await db.query("UPDATE broker_accounts SET active=false WHERE id=$1", [id(11)]);
    await db.exec('SET ROLE service_role'); await assert.rejects(() => context(), /opportunity_not_found/); await db.exec('RESET ROLE');
    await db.query('UPDATE broker_accounts SET active=true WHERE id=$1', [id(11)]);
    await db.query("UPDATE properties SET status='Vendido' WHERE id=$1", [id(301)]);
    await db.exec('SET ROLE service_role'); await assert.rejects(() => context(), /opportunity_unavailable/); await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec('SET ROLE ' + role); await assert.rejects(() => context(), /permission denied/); await db.exec('RESET ROLE');
    }
  } finally { await db.close(); }
}
(async () => { await routingAndRoute(); await sqlPrivileges(); console.log('PASS channel routing: real session/ALS, authorized narrow SQL RPC with service-role SELECT denied, tenant/portfolio checks, property availability, Origin/rate/body limits, correct channel and no WhatsApp fallback.'); })().catch(error => { console.error(error); process.exit(1); });
