// Real session -> API -> model -> canonical bridge -> PostgreSQL transaction.
// Synthetic in-memory database only. Unexpected network or message writes fail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  const env = {
    SUPABASE_URL: 'https://registration-isolated.example.test', SUPABASE_SECRET_KEY: 'synthetic-key',
    CRM_EVOLUTION_ENABLED: 'true', CRM_EVOLUTION_INTEGRATED: 'true', CRM_EVOLUTION_COMPANIES: `${id(1)},${id(2)}`,
  };
  const calls = [], afterCallbacks = [], matchingCalls = [];
  let beforeCommit, failAfterCommit = false, failedReadPending = false;
  try {
    await seedCompanies(db);
    await db.exec(`ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;
      UPDATE leads SET score=0,temperature='Frio' WHERE score IS NULL;
      ALTER TABLE leads ALTER COLUMN score SET DEFAULT 0,ALTER COLUMN score SET NOT NULL,
        ALTER COLUMN temperature SET DEFAULT 'Frio',ALTER COLUMN temperature SET NOT NULL;
      ALTER TABLE properties ALTER COLUMN images DROP DEFAULT;
      ALTER TABLE properties ALTER COLUMN images TYPE text[] USING '{}'::text[];
      ALTER TABLE properties ALTER COLUMN images SET DEFAULT '{}'::text[],ALTER COLUMN images SET NOT NULL;
      UPDATE properties SET code=id::text;
      ALTER TABLE properties ALTER COLUMN code SET NOT NULL,ALTER COLUMN purpose SET NOT NULL,
        ALTER COLUMN price SET NOT NULL,ALTER COLUMN district SET NOT NULL,ALTER COLUMN city SET NOT NULL,
        ALTER COLUMN property_type SET NOT NULL,ALTER COLUMN bedrooms SET DEFAULT 0,ALTER COLUMN bedrooms SET NOT NULL,
        ALTER COLUMN parking_spaces SET DEFAULT 0,ALTER COLUMN parking_spaces SET NOT NULL;
      ALTER TABLE appointments ALTER COLUMN scheduled_at SET NOT NULL,ALTER COLUMN status SET DEFAULT 'Agendada',ALTER COLUMN status SET NOT NULL;
      ALTER TABLE appointments ADD CONSTRAINT registration_synthetic_failure
        CHECK(position('ROLLBACK_REGISTRATION' in coalesce(notes,''))=0);`);
    for (const n of [12, 13]) {
      await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$3,'fixture','broker',true,$4,$4)", [id(n), id(1), `Broker ${n}`, `broker${n}@example.test`]);
    }
    await db.query("INSERT INTO leads(id,company_id,name,phone,goal,property_type,region,budget_max,assigned_to,source,lifecycle_status) VALUES($1,$2,'Contato sintético','5535999990012','Comprar','Casa','Centro',500000,'Broker 12','WhatsApp','Novo')", [id(102), id(1)]);
    await db.query("INSERT INTO conversations(id,company_id,lead_id,channel,status,assigned_broker_id,assigned_to) VALUES($1,$2,$3,'WhatsApp','Aberta',$4,'Broker 12')", [id(502), id(1), id(102), id(12)]);
    await db.query("INSERT INTO properties(id,company_id,code,title,purpose,price,district,city,property_type) VALUES($1,$2,'RENT-TEST','Aluguel sintético','Aluguel',2000,'Centro','Lavras','Casa')", [id(302), id(1)]);
    await db.exec(migration('20261007190000_crm_evolution_workspace.sql'));
    await db.exec(migration('20261007210000_crm_evolution_legacy_bridge.sql'));
    const sessions = { owner: ['a'.repeat(64), 11], broker: ['b'.repeat(64), 12], otherBroker: ['c'.repeat(64), 13], otherCompany: ['d'.repeat(64), 21] };
    for (const [token, actor] of Object.values(sessions)) {
      await db.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest('hex'), id(actor)]);
    }
    const untouched = (await db.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) data FROM messages m')).rows[0].data;
    await db.exec('SET ROLE service_role');
    const identifier = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return `"${value}"`; };
    async function transport(input, options = {}) {
      const url = new URL(input);
      assert.equal(url.origin, env.SUPABASE_URL, 'external network is forbidden');
      assert.equal(options.headers.apikey, 'synthetic-key');
      const resource = url.pathname.replace('/rest/v1/', '');
      calls.push({ resource, method: options.method || 'GET', query: url.searchParams });
      try {
        if (resource.startsWith('rpc/')) {
          const fn = resource.slice(4), entries = Object.entries(JSON.parse(options.body));
          assert.ok(['account_session', 'commit_crm_evolution_changes', 'save_crm_evolution_workspace'].includes(fn), `unexpected RPC ${fn}`);
          if (fn === 'commit_crm_evolution_changes' && beforeCommit) { const callback = beforeCommit; beforeCommit = undefined; await callback(); }
          const rows = (await db.query(`SELECT * FROM public.${identifier(fn)}(${entries.map(([key], i) => `${identifier(key)}=>$${i + 1}`).join(',')})`, entries.map(([, value]) => typeof value === 'object' && value !== null ? JSON.stringify(value) : value))).rows;
          const result = ['save_crm_evolution_workspace', 'commit_crm_evolution_changes'].includes(fn) ? rows[0][fn] : rows;
          if (fn === 'commit_crm_evolution_changes' && result === true && failAfterCommit) { failAfterCommit = false; failedReadPending = true; }
          return Response.json(result);
        }
        if (resource === 'leads' && failedReadPending) { failedReadPending = false; return Response.json({ error: 'synthetic_post_commit_failure' }, { status: 503 }); }
        assert.equal(options.method || 'GET', 'GET', 'canonical writes must share the atomic RPC');
        assert.ok(['broker_accounts', 'crm_evolution_workspaces', 'leads', 'properties', 'appointments', 'conversations'].includes(resource), `unexpected resource ${resource}`);
        const values = [], conditions = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
          assert.ok(value.startsWith('eq.')); values.push(key === 'active' ? value.slice(3) === 'true' : value.slice(3));
          conditions.push(`${identifier(key)}=$${values.length}`);
        }
        const selected = url.searchParams.get('select') || '*';
        const columns = selected === '*' ? '*' : selected.split(',').map(identifier).join(',');
        const limit = Number(url.searchParams.get('limit') || 100), offset = Number(url.searchParams.get('offset') || 0);
        assert.ok(Number.isSafeInteger(limit) && Number.isSafeInteger(offset) && limit > 0 && offset >= 0);
        const rows = (await db.query(`SELECT to_jsonb(q) payload FROM (SELECT ${columns} FROM public.${identifier(resource)}${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY ${resource === 'crm_evolution_workspaces' ? 'company_id' : 'id'} LIMIT ${limit} OFFSET ${offset}) q`, values)).rows;
        return Response.json(rows.map(row => row.payload));
      } catch (error) { return Response.json({ message: error.message, code: error.code }, { status: 400 }); }
    }
    const cache = new Map();
    function load(file) {
      if (cache.has(file)) return cache.get(file);
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const mod = { exports: {} }; cache.set(file, mod.exports);
      const localRequire = name => {
        if (name === 'next/server') return { NextResponse: { json: Response.json }, after: callback => afterCallbacks.push(callback) };
        if (name === '@/lib/opportunities' || name === '../opportunities') return { onPropertyChanged: async (...args) => matchingCalls.push(args) };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
        return require(name);
      };
      vm.runInNewContext(output, { module: mod, exports: mod.exports, require: localRequire, process: { env }, Buffer, Date, URL, URLSearchParams, Response, Request, Headers, AbortSignal, structuredClone, crypto: crypto.webcrypto, console, fetch: transport });
      cache.set(file, mod.exports); return mod.exports;
    }
    const api = load('app/api/evolution/route.ts');
    const request = (method, session, body, origin = 'https://app.example.test') => {
      const req = new Request('https://app.example.test/api/evolution?company_id=' + id(2), { method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      req.nextUrl = new URL(req.url); req.cookies = { get: name => name === 'imobflow_session' && session ? { value: sessions[session]?.[0] || session } : undefined }; return req;
    };
    const snapshot = async actor => { const response = await api.GET(request('GET', actor)); assert.equal(response.status, 200); return (await response.json()).state; };
    const post = (actor, command, state, origin) => api.POST(request('POST', actor, { command, expectedVersion: state.version, expectedSourceRevision: state.sourceRevision, companyId: id(2) }, origin));
    const save = async (actor, command, state) => { const response = await post(actor, command, state); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body.state; };
    const row = async (table, uuid) => (await db.query(`SELECT to_jsonb(t) data FROM ${table} t WHERE id=$1`, [uuid])).rows[0]?.data;
    const workspace = async () => (await db.query('SELECT document FROM crm_evolution_workspaces WHERE company_id=$1', [id(1)])).rows[0]?.document;
    const appointmentCount = async () => Number((await db.query('SELECT count(*) n FROM appointments WHERE lead_id=$1', [id(102)])).rows[0].n);
    const caseId = `case:${id(102)}`, propertyId = `property:${id(301)}`;
    const register = (action, data = {}, target = caseId, requestId = crypto.randomUUID()) => ({ type: 'register', caseId: target, requestId, action, data });
    const stage = state => state.records.find(item => item.id === caseId).data.stage;
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    let state = await snapshot('broker');
    assert.equal(stage(state), 'Lead');
    assert.equal((await api.POST(request('POST', undefined, { command: register('lead'), expectedVersion: 0 }))).status, 401);
    assert.equal((await post('broker', register('lead'), state, 'https://evil.example.test')).status, 403);
    assert.equal((await post('otherBroker', register('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado' }), await snapshot('otherBroker'))).status, 403);
    assert.equal((await post('otherCompany', register('lead'), await snapshot('otherCompany'))).status, 404);
    assert.equal(await workspace(), undefined, 'reads and rejected commands create no workspace');

    const attendance = register('attendance', { channel: 'WhatsApp', outcome: 'Tentativa sem resposta', notes: 'Contato sintético sem envio de mensagem.' });
    const initial = state;
    state = await save('broker', attendance, state);
    assert.equal(stage(state), 'Atendimento');
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Em atendimento');
    assert.match(JSON.stringify(state.events), /Tentativa sem resposta/);
    const version = state.version, eventCount = state.events.length;
    state = await save('broker', attendance, initial);
    assert.equal(state.version, version, 'retry after an uncertain response returns existing result');
    assert.equal(state.events.length, eventCount, 'idempotent replay never duplicates timeline');
    assert.equal((await post('broker', { ...attendance, data: { channel: 'Telefone', outcome: 'Contato realizado' } }, state)).status, 409, 'one id cannot represent a different event');
    assert.equal((await post('owner', attendance, await snapshot('owner'))).status, 409, 'one request id cannot be reused by another actor');
    beforeCommit = () => db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 13' WHERE id=$2", [id(13), id(502)]);
    const reassigned = await post('broker', register('attendance', { channel: 'Telefone', outcome: 'Contato realizado' }), state);
    assert.ok([403, 409, 503].includes(reassigned.status), 'read-to-commit assignment race rejects even a timeline-only event');
    assert.equal((await workspace()).version, state.version, 'ownership races cannot persist an unauthorized audit event');
    assert.equal((await workspace()).events.length, state.events.length);
    await db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 12' WHERE id=$2", [id(12), id(502)]);
    state = await snapshot('broker');
    beforeCommit = () => db.query('UPDATE leads SET budget_max=budget_max+1 WHERE id=$1', [id(102)]);
    assert.equal((await post('broker', register('attendance', { channel: 'Telefone', outcome: 'Contato realizado' }), state)).status, 409, 'timeline-only registrations still guard canonical source changes at SQL commit');
    assert.equal((await workspace()).version, state.version);
    state = await snapshot('broker');
    assert.equal((await post('broker', register('lead'), state)).status, 400, 'returning to Lead requires explanation');
    state = await save('broker', register('lead', { reason: 'Classificação inicial corrigida pelo responsável.' }), state);
    assert.equal(stage(state), 'Lead');

    for (const [action, data] of [
      ['schedule', { propertyId: `property:${id(401)}`, dueAt: future }],
      ['schedule', { propertyId: `property:${id(302)}`, dueAt: future }],
      ['schedule', { propertyId, dueAt: '2026-02-31T10:30' }],
      ['proposal', { propertyId, amount: 0, conditions: 'À vista', expiresAt: '2030-01-01', status: 'Enviada' }],
      ['proposal', { propertyId, amount: 400000, conditions: 'À vista', expiresAt: '2030-01-01', status: 'Aceita' }],
    ]) {
      const response = await post('broker', register(action, data), state);
      assert.ok([400, 403, 404, 409].includes(response.status), `${action} must reject invalid target or fields: ${await response.text()}`);
      assert.equal((await workspace()).version, state.version);
    }
    const unchangedLead = await row('leads', id(102));
    const rollback = await post('broker', register('schedule', { propertyId, dueAt: future, notes: 'ROLLBACK_REGISTRATION' }), state);
    assert.ok([400, 409, 503].includes(rollback.status), 'a real SQL constraint failure is reported');
    assert.equal((await workspace()).version, state.version, 'SQL failure rolls back the event and workspace');
    assert.deepEqual(await row('leads', id(102)), unchangedLead, 'SQL failure rolls back the lead stage');
    assert.equal(await appointmentCount(), 0, 'SQL failure cannot leave an orphan appointment');

    const schedule = register('schedule', { propertyId, dueAt: future, notes: 'Visita combinada no atendimento.' });
    state = await save('broker', schedule, state);
    assert.equal(stage(state), 'Agendamento');
    assert.notEqual((await row('leads', id(102))).lifecycle_status, 'Visita', 'scheduled is not attended');
    assert.equal(await appointmentCount(), 1);
    let visit = state.records.find(item => item.kind === 'tasks' && item.data.caseId === caseId);
    assert.equal(Date.parse((await row('appointments', visit.legacy.id)).scheduled_at), Date.parse(future));
    assert.equal((await post('broker', register('visit', { taskId: visit.id }), state)).status, 400, 'future appointment cannot be completed');
    const rescheduled = new Date(Date.now() + 4 * 86400000).toISOString();
    state = await save('broker', register('schedule', { taskId: visit.id, propertyId, dueAt: rescheduled }), state);
    assert.equal(await appointmentCount(), 1, 'rescheduling edits its appointment instead of duplicating it');
    assert.equal(Date.parse((await row('appointments', visit.legacy.id)).scheduled_at), Date.parse(rescheduled));
    await db.query("UPDATE appointments SET scheduled_at=now()-interval '1 hour' WHERE id=$1", [visit.legacy.id]);
    state = await snapshot('broker');
    state = await save('broker', register('visit', { taskId: visit.id, notes: 'Visita realizada, confirmação sintética.' }), state);
    assert.equal(stage(state), 'Visita');
    assert.equal((await row('appointments', visit.legacy.id)).status, 'Realizada');
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Visita');
    assert.equal((await post('broker', register('visit', { taskId: visit.id }), state)).status, 409, 'a different request cannot repeat a completed visit');
    const historicalTime = new Date(Date.now() - 2 * 86400000).toISOString();
    const historicalVisit = register('visit', { propertyId, occurredAt: historicalTime, notes: 'Visita passada sem agendamento prévio.' });
    state = await save('broker', historicalVisit, state);
    assert.equal(await appointmentCount(), 2, 'an unscheduled actual visit is recorded once in the canonical agenda');
    const historical = state.records.find(item => item.kind === 'tasks' && item.data.notes === 'Visita passada sem agendamento prévio.');
    assert.equal((await row('appointments', historical.legacy.id)).status, 'Realizada');
    assert.equal(Date.parse((await row('appointments', historical.legacy.id)).scheduled_at), Date.parse(historicalTime));
    assert.equal((await post('broker', register('visit', { propertyId, occurredAt: historicalTime }), state)).status, 409);
    assert.equal((await post('broker', register('visit', { propertyId, occurredAt: future }), state)).status, 400);

    const proposalCommand = register('proposal', { propertyId, amount: 550000, conditions: 'Pagamento à vista, dados sintéticos.', expiresAt: '2030-01-01', status: 'Enviada' });
    const beforeProposal = state;
    failAfterCommit = true;
    const uncertain = await post('broker', proposalCommand, state);
    assert.equal(uncertain.status, 503);
    assert.match((await uncertain.json()).error, /salv|registr/i, 'post-commit failure must not claim nothing was saved');
    state = await save('broker', proposalCommand, beforeProposal);
    assert.equal(state.version, beforeProposal.version + 1, 'explicit replay reconciles an already committed proposal');
    assert.equal(stage(state), 'Proposta');
    const proposals = state.records.filter(item => item.kind === 'proposals' && item.data.caseId === caseId);
    assert.equal(proposals.length, 1);
    const proposal = proposals[0];
    assert.equal(proposal.data.status, 'Enviada');
    assert.equal((await row('properties', id(301))).status, 'Disponível', 'received proposal must not sell the property');
    assert.equal((await post('broker', register('close', { proposalId: proposal.id, confirmed: true }), state)).status, 403, 'shared property write access cannot be bypassed through quick registration');

    let ownerState = await snapshot('owner');
    assert.equal((await post('owner', register('close', { proposalId: proposal.id, confirmed: false }), ownerState)).status, 400);
    const beforeRace = ownerState.version;
    beforeCommit = () => db.query('UPDATE properties SET price=price+1 WHERE id=$1', [id(301)]);
    assert.equal((await post('owner', register('close', { proposalId: proposal.id, confirmed: true }), ownerState)).status, 409, 'canonical source race prevents a stale closing');
    assert.equal((await workspace()).version, beforeRace);
    assert.equal((await row('properties', id(301))).status, 'Disponível');
    assert.notEqual((await row('leads', id(102))).lifecycle_status, 'Convertido');
    ownerState = await snapshot('owner');
    const results = await Promise.all([
      post('owner', register('attendance', { channel: 'Telefone', outcome: 'Contato realizado' }, `case:${id(101)}`), ownerState),
      post('owner', register('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado' }, `case:${id(101)}`), ownerState),
    ]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409], 'same-version concurrent writes cannot both commit');
    ownerState = await snapshot('owner');
    ownerState = await save('owner', register('close', { proposalId: proposal.id, confirmed: true }), ownerState);
    assert.equal(stage(ownerState), 'Negociado');
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Convertido');
    assert.equal((await row('properties', id(301))).status, 'Vendido');
    assert.equal((await post('owner', register('lead', { reason: 'Não deve apagar fechamento.' }), ownerState)).status, 409);

    const messages = (await db.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) data FROM messages m')).rows[0].data;
    assert.deepEqual(messages, untouched, 'registration never sends, edits or deletes WhatsApp/client messages');
    assert.ok(calls.filter(call => !call.resource.startsWith('rpc/')).every(call => call.query.get('company_id')?.startsWith('eq.')), 'reads are scoped to authenticated company');
    for (const callback of afterCallbacks) await callback();
    assert.equal(matchingCalls.length, 1, 'property matching only runs once for the confirmed committed closing');
    assert.deepEqual(matchingCalls[0], [id(1), id(301)]);
    console.log('PASS conversation registration API: authenticated tenant/portfolio isolation, explicit six-stage flow, real agenda writes, attendance vs scheduled/realized, immutable confirmed closure, SQL atomic rollback, stale/concurrent protection and idempotent recovery after committed 503. Synthetic PGlite only; no external network, messages or finance writes.');
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
