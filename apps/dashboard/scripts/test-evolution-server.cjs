const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  const env = { SUPABASE_URL: 'https://evolution-isolated.example.test', SUPABASE_SECRET_KEY: 'isolated-test-key' };
  const calls = [];
  try {
    await seedCompanies(db);
    await db.exec(migration('20261007190000_crm_evolution_workspace.sql'));
    for (const broker of [12, 13]) await db.query(
      "INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$3,'scrypt-v1$fixture','broker',true,$4,$4)",
      [id(broker), id(1), `Broker ${broker}`, `broker${broker}@example.test`],
    );
    const sessions = { owner: ['a'.repeat(64), 11], broker: ['b'.repeat(64), 12], otherBroker: ['c'.repeat(64), 13], otherCompany: ['d'.repeat(64), 21] };
    for (const [token, actor] of Object.values(sessions)) await db.query(
      "INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [crypto.createHash('sha256').update(token).digest('hex'), id(actor)],
    );
    await db.exec('SET ROLE service_role');
    const identifier = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return `"${value}"`; };
    async function transport(input, options = {}) {
      const url = new URL(input);
      assert.equal(url.origin, env.SUPABASE_URL, 'no external network is allowed');
      assert.equal(options.headers.apikey, 'isolated-test-key');
      const resource = url.pathname.replace('/rest/v1/', '');
      calls.push({ resource, search: url.searchParams, method: options.method || 'GET' });
      try {
        if (resource.startsWith('rpc/')) {
          const fn = resource.slice(4), entries = Object.entries(JSON.parse(options.body));
          const rows = (await db.query(`SELECT * FROM public.${identifier(fn)}(${entries.map(([key], i) => `${identifier(key)} => $${i + 1}`).join(',')})`,
            entries.map(([, value]) => typeof value === 'object' && value !== null ? JSON.stringify(value) : value))).rows;
          return Response.json(fn === 'save_crm_evolution_workspace' ? rows[0][fn] : rows);
        }
        assert.equal(options.method || 'GET', 'GET', 'store mutations only use the guarded CAS RPC');
        assert.ok(['broker_accounts', 'crm_evolution_workspaces'].includes(resource), resource);
        const values = [], conditions = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
          assert.ok(value.startsWith('eq.'), value); values.push(key === 'active' ? value.slice(3) === 'true' : value.slice(3)); conditions.push(`${identifier(key)}=$${values.length}`);
        }
        const selected = url.searchParams.get('select') || '*';
        const columns = selected === '*' ? '*' : selected.split(',').map(identifier).join(',');
        const limit = Number(url.searchParams.get('limit') || 100), offset = Number(url.searchParams.get('offset') || 0);
        assert.ok(Number.isSafeInteger(limit) && Number.isSafeInteger(offset) && limit > 0 && offset >= 0);
        const rows = (await db.query(`SELECT ${columns} FROM public.${identifier(resource)}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} LIMIT ${limit} OFFSET ${offset}`, values)).rows;
        return Response.json(rows);
      } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
    }
    const cache = new Map();
    function load(file) {
      if (cache.has(file)) return cache.get(file);
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const mod = { exports: {} };
      const localRequire = name => {
        if (name === 'next/server') return { NextResponse: { json: Response.json } };
        if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`);
        if (name.startsWith('.')) return load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`);
        return require(name);
      };
      vm.runInNewContext(output, { module: mod, exports: mod.exports, require: localRequire, process: { env }, Buffer, Date, URL, URLSearchParams,
        Response, Request, Headers, AbortSignal, structuredClone, crypto: crypto.webcrypto, console, fetch: transport });
      cache.set(file, mod.exports); return mod.exports;
    }
    const api = load('app/api/evolution/route.ts');
    const request = (method, session, body, origin = 'https://app.example.test') => {
      const req = new Request(`https://app.example.test/api/evolution?company_id=${id(2)}`, {
        method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      req.nextUrl = new URL(req.url);
      req.cookies = { get: name => name === 'imobflow_session' && session ? { value: sessions[session]?.[0] || session } : undefined };
      return req;
    };
    const get = actor => api.GET(request('GET', actor));
    const post = (actor, command, expectedVersion, origin) => api.POST(request('POST', actor, { command, expectedVersion, companyId: id(2) }, origin));
    assert.equal((await get('owner')).status, 404, 'feature defaults off');
    env.CRM_EVOLUTION_ENABLED = 'true';
    assert.equal((await get('owner')).status, 404, 'an explicit company allowlist is required');
    env.CRM_EVOLUTION_COMPANIES = '*';
    assert.equal((await get('owner')).status, 404, 'wildcard does not broaden access');
    env.CRM_EVOLUTION_COMPANIES = `${id(1)},${id(2)}`;
    assert.equal((await get(undefined)).status, 401);
    assert.equal((await get('e'.repeat(64))).status, 401);
    const emptyResponse = await get('owner');
    assert.equal(emptyResponse.status, 200);
    assert.match(emptyResponse.headers.get('cache-control'), /private.*no-store/);
    const empty = await emptyResponse.json();
    assert.equal(empty.mode, 'live'); assert.equal(empty.state.companyId, id(1));
    assert.equal(empty.state.version, 0); assert.equal(empty.state.records.length, 0);
    assert.equal(empty.state.members.length, 3);
    assert.ok(empty.state.members.every(member => !('email' in member) && !('password_hash' in member)));
    assert.equal((await db.query('SELECT count(*)::int n FROM crm_evolution_workspaces')).rows[0].n, 0, 'read has no seed or write side effect');
    const person = assignedTo => ({ type: 'save', kind: 'people', data: { name: `Cliente sintético ${assignedTo}`, personType: 'Pessoa física', category: 'Cliente', assignedTo } });
    let response = await post('owner', person(id(12)), 0);
    assert.equal(response.status, 200); const initial = (await response.json()).state; const firstId = initial.records[0].id;
    response = await post('owner', person(id(13)), 1);
    assert.equal(response.status, 200); const second = (await response.json()).state; const secondId = second.records.find(record => record.id !== firstId).id;
    const brokerState = (await (await get('broker')).json()).state;
    assert.equal(brokerState.records.length, 1); assert.equal(brokerState.records[0].id, firstId);
    assert.ok(brokerState.events.every(event => event.recordId === firstId));
    assert.equal((await post('broker', { type: 'save', kind: 'people', id: secondId, data: { name: 'Forbidden' } }, 2)).status, 403);
    assert.equal((await post('broker', { type: 'settings', settings: { sources: ['Forbidden'] } }, 2)).status, 403);
    assert.equal((await post('owner', person(id(12)), 0)).status, 409, 'stale writes are rejected');
    assert.equal((await post('otherCompany', { type: 'save', kind: 'people', id: firstId, data: { name: 'Foreign' } }, 0)).status, 404);
    assert.equal((await post('owner', person(id(12)), 2, 'https://evil.example.test')).status, 403);
    assert.equal((await post('owner', person(id(12)), 2, '')).status, 403);
    assert.equal((await post('owner', { type: 'unknown' }, 2)).status, 400);
    assert.equal((await post('owner', { type: 'comment', id: firstId, text: 'x'.repeat(70000) }, 2)).status, 413);
    const concurrent = await Promise.all([
      post('owner', { type: 'comment', id: firstId, text: 'Primeiro comentário sintético' }, 2),
      post('owner', { type: 'comment', id: firstId, text: 'Segundo comentário sintético' }, 2),
    ]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409], 'exactly one command wins the same version');
    const accepted = (await (await get('owner')).json()).state;
    assert.equal(accepted.version, 3); assert.equal(accepted.events.length, 3);
    assert.equal((await (await get('otherCompany')).json()).state.records.length, 0, 'other company never sees first company records');
    env.CRM_EVOLUTION_ENABLED = 'false';
    assert.equal((await get('owner')).status, 404);
    env.CRM_EVOLUTION_ENABLED = 'true';
    const restored = (await (await get('owner')).json()).state;
    assert.equal(restored.version, 3); assert.equal(restored.records.length, 2); assert.equal(restored.events.length, 3, 'turning feature off/on preserves data');
    await db.exec('RESET ROLE');
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(12)]);
    await db.exec('SET ROLE service_role');
    assert.equal((await get('broker')).status, 401, 'deactivated account loses access');
    assert.equal((await (await get('owner')).json()).state.members.length, 2, 'inactive member is removed from authoritative roster');
    assert.ok(calls.filter(call => ['crm_evolution_workspaces', 'broker_accounts'].includes(call.resource)).every(call => call.search.get('company_id')?.startsWith('eq.')));
    assert.equal((await db.query('SELECT count(*)::int n FROM leads')).rows[0].n, 2, 'legacy leads untouched');
    console.log('PASS CRM evolution API: real session/ALS/route/model/store, default-off allowlist, two tenants, broker portfolios, history redaction, CAS race, CSRF, size limit, no seeds and reversible feature gate.');
    console.log('Tests use isolated PGlite and a denied-external-network transport; no production credentials or services.');
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
