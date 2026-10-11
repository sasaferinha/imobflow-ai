// Real session -> API -> model -> canonical bridge -> PostgreSQL transaction.
// Synthetic in-memory database only. Unexpected network or message writes fail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');
const { stageMessageQuery } = require('./helpers/stage-message-query.cjs');

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
      ALTER TABLE properties ADD CONSTRAINT synthetic_reopen_failure CHECK(NOT(status='Disponível' AND code='ROLLBACK_REOPEN'));
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
        if (['messages', 'message_delivery_events'].includes(resource)) return Response.json(await stageMessageQuery(db, resource, url.searchParams));
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
    assert.equal((await post('otherBroker', register('attendance', { channel: 'WhatsApp', outcome: 'Contato realizado', source: 'Instagram' }), await snapshot('otherBroker'))).status, 403);
    assert.equal((await post('otherCompany', register('lead', { source: 'Instagram' }), await snapshot('otherCompany'))).status, 404);
    assert.equal(await workspace(), undefined, 'reads and rejected commands create no workspace');

    const attendance = register('attendance', { channel: 'WhatsApp', outcome: 'Tentativa sem resposta', notes: 'Contato sintético sem envio de mensagem.', source: 'Facebook' });
    const initial = state;
    state = await save('broker', attendance, state);
    assert.equal(stage(state), 'Atendimento');
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Em atendimento');
    assert.equal((await row('leads', id(102))).source, 'Facebook');
    assert.equal(state.records.find(item => item.id === caseId).data.source, 'Facebook');
    assert.equal(state.records.find(item => item.id === `lead:${id(102)}`).data.source, 'Facebook');
    assert(state.events.some(event => event.recordId === caseId && event.changes?.source?.from === 'WhatsApp' && event.changes.source.to === 'Facebook'));
    const reloadedSource = await snapshot('broker');
    assert.equal(reloadedSource.records.find(item => item.id === caseId).data.source, 'Facebook', 'canonical source survives a fresh read and overlay merge');
    assert.match(JSON.stringify(state.events), /Tentativa sem resposta/);
    const version = state.version, eventCount = state.events.length;
    state = await save('broker', attendance, initial);
    assert.equal(state.version, version, 'retry after an uncertain response returns existing result');
    assert.equal(state.events.length, eventCount, 'idempotent replay never duplicates timeline');
    assert.equal((await post('broker', { ...attendance, data: { ...attendance.data, source: 'Instagram' } }, state)).status, 409, 'source participates in the idempotency fingerprint');
    assert.equal((await post('broker', { type: 'save', kind: 'cases', id: caseId, data: { source: 'Instagram' } }, state)).status, 400, 'generic case edit cannot bypass the registration flow');
    assert.equal((await post('broker', { type: 'save', kind: 'leads', id: `lead:${id(102)}`, data: { source: 'Instagram' } }, state)).status, 409, 'generic lead edit cannot bypass canonical origin protection');
    for (const source of ['Unlisted source', ' Facebook', 'Outros: ', 'Outros: Invalid\nsource', 'x'.repeat(201)]) {
      assert.equal((await post('broker', register('attendance', { channel: 'Telefone', outcome: 'Contato realizado', source }), state)).status, 400);
      assert.equal((await row('leads', id(102))).source, 'Facebook');
      assert.equal((await workspace()).version, state.version);
    }
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
    beforeCommit = () => db.query("UPDATE leads SET source='  Campanha histórica específica  ' WHERE id=$1", [id(102)]);
    assert.equal((await post('broker', register('attendance', { channel: 'Telefone', outcome: 'Contato realizado', source: 'Instagram' }), state)).status, 409, 'concurrent canonical source correction is never overwritten');
    assert.equal((await workspace()).version, state.version);
    state = await snapshot('broker');
    assert.equal(state.records.find(item => item.id === caseId).data.source, '  Campanha histórica específica  ');
    assert.equal((await post('broker', register('lead'), state)).status, 400, 'returning to Lead requires explanation');
    state = await save('broker', register('lead', { reason: 'Classificação inicial corrigida pelo responsável.' }), state);
    assert.equal(stage(state), 'Lead');
    assert.equal((await row('leads', id(102))).source, '  Campanha histórica específica  ', 'old clients that omit source keep the exact legacy source, including whitespace');

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
    const rollback = await post('broker', register('schedule', { propertyId, dueAt: future, notes: 'ROLLBACK_REGISTRATION', source: 'Instagram' }), state);
    assert.ok([400, 409, 503].includes(rollback.status), 'a real SQL constraint failure is reported');
    assert.equal((await workspace()).version, state.version, 'SQL failure rolls back the event and workspace');
    assert.deepEqual(await row('leads', id(102)), unchangedLead, 'SQL failure rolls back the lead stage and source together');
    assert.equal(await appointmentCount(), 0, 'SQL failure cannot leave an orphan appointment');

    const schedule = register('schedule', { propertyId, dueAt: future, notes: 'Visita combinada no atendimento.', source: 'Outros: Evento no bairro' });
    state = await save('broker', schedule, state);
    assert.equal(stage(state), 'Agendamento');
    assert.equal((await row('leads', id(102))).source, 'Outros: Evento no bairro');
    assert.equal(state.records.find(item => item.id === caseId).data.source, 'Outros: Evento no bairro');
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

    const mainLeadBeforeExtra = await row('leads', id(102));
    const mainCaseBeforeExtra = ownerState.records.find(item => item.id === caseId).data;
    const newNegotiation = register('new_negotiation', { name: 'Aluguel temporário enquanto compra', purpose: 'Aluguel', propertyId: `property:${id(302)}`, notes: 'Objetivo registrado pelo corretor.' });
    let extraState = await snapshot('broker'), beforeCreation = extraState;
    failAfterCommit = true;
    assert.equal((await post('broker', newNegotiation, extraState)).status, 503);
    extraState = await save('broker', newNegotiation, beforeCreation);
    const extraId = newNegotiation.requestId;
    assert.equal(extraState.records.find(item => item.id === extraId).data.stage, 'Lead');
    assert.equal(extraState.records.find(item => item.id === extraId).manualNegotiation, true);
    assert.equal(extraState.records.filter(item => item.kind === 'cases' && item.data.personId === `person:${id(102)}`).length, 2);
    assert.equal(extraState.records.filter(item => item.kind === 'leads' && item.data.personId === `person:${id(102)}`).length, 1);
    assert.deepEqual(await row('leads', id(102)), mainLeadBeforeExtra, 'creating another objective does not rewrite canonical qualification or closed outcome');
    assert.equal((await post('broker', { ...newNegotiation, data: { ...newNegotiation.data, purpose: 'Venda' } }, extraState)).status, 409);
    extraState = await save('broker', register('attendance', { channel: 'Telefone', outcome: 'Contato realizado', source: 'Instagram' }, extraId), extraState);
    assert.equal(extraState.records.find(item => item.id === extraId).data.source, 'Instagram');
    assert.deepEqual(await row('leads', id(102)), mainLeadBeforeExtra, 'extra source and stage are independent of the main lead');
    const beforeExtraSchedule = extraState.version;
    assert.ok([400, 409, 503].includes((await post('broker', register('schedule', { propertyId: `property:${id(302)}`, dueAt: future, notes: 'ROLLBACK_REGISTRATION' }, extraId), extraState)).status));
    assert.equal((await workspace()).version, beforeExtraSchedule, 'failed extra appointment insertion rolls back its case stage and binding');
    assert.equal((await snapshot('broker')).records.some(item => item.kind === 'tasks' && item.data.caseId === extraId), false);
    assert.deepEqual(await row('leads', id(102)), mainLeadBeforeExtra);
    const extraSchedule = register('schedule', { propertyId: `property:${id(302)}`, dueAt: future, notes: 'Visita da negociação extra.' }, extraId);
    extraState = await save('broker', extraSchedule, extraState);
    let extraTask = extraState.records.find(item => item.kind === 'tasks' && item.data.caseId === extraId);
    assert(extraTask); assert.equal(extraTask.negotiationCaseId, extraId);
    assert.equal((await row('appointments', extraTask.legacy.id)).lead_id, id(102));
    await db.query("UPDATE appointments SET notes='Alteração clássica da agenda' WHERE id=$1", [extraTask.legacy.id]);
    extraState = await snapshot('broker');
    extraTask = extraState.records.find(item => item.id === extraTask.id);
    assert.equal(extraTask.data.caseId, extraId, 'reimporting a canonical appointment preserves its exact independent negotiation');
    assert.equal(extraTask.data.notes, 'Alteração clássica da agenda');
    extraState = await save('broker', { type: 'save', kind: 'tasks', id: extraTask.id, data: { notes: 'Atualização manual na negociação extra' } }, extraState);
    assert.equal(extraState.records.find(item => item.id === extraTask.id).data.caseId, extraId);
    const versionBeforeExtraRace = extraState.version;
    beforeCommit = () => db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 13' WHERE id=$2", [id(13), id(502)]);
    assert.ok([403, 409, 503].includes((await post('broker', { type: 'save', kind: 'cases', id: extraId, data: { notes: 'Tentativa após transferência' } }, extraState)).status));
    assert.equal((await workspace()).version, versionBeforeExtraRace, 'generic extra-case edits recheck live portfolio at SQL commit');
    assert.equal((await snapshot('broker')).records.some(item => item.id === extraId), false);
    const transferred = await snapshot('otherBroker');
    assert.equal(transferred.records.find(item => item.id === extraId).data.assignedTo, id(13));
    assert.equal(transferred.records.find(item => item.id === extraTask.id).data.caseId, extraId);
    await db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 12' WHERE id=$2", [id(12), id(502)]);
    extraState = await snapshot('broker');
    beforeCommit = () => db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 13' WHERE id=$2", [id(13), id(502)]);
    assert.ok([403, 409, 503].includes((await post('broker', { type: 'comment', id: extraId, text: 'Comentário com carteira desatualizada' }, extraState)).status));
    assert.equal((await workspace()).version, versionBeforeExtraRace, 'comments also carry a canonical contact guard');
    await db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 12' WHERE id=$2", [id(12), id(502)]);
    extraState = await snapshot('broker');
    extraState = await save('broker', register('proposal', { propertyId: `property:${id(302)}`, amount: 2200, conditions: 'Locação temporária', expiresAt: '2030-01-01', status: 'Enviada' }, extraId), extraState);
    const extraProposal = extraState.records.find(item => item.kind === 'proposals' && item.data.caseId === extraId);
    let extraOwner = await snapshot('owner');
    extraOwner = await save('owner', register('close', { proposalId: extraProposal.id, confirmed: true }, extraId), extraOwner);
    assert.equal(extraOwner.records.find(item => item.id === extraId).data.status, 'Ganho');
    assert.equal((await row('properties', id(302))).status, 'Alugado');
    assert.deepEqual(await row('leads', id(102)), mainLeadBeforeExtra, 'closing an extra negotiation does not convert or otherwise rewrite the main case');
    extraOwner = await save('owner', register('correct_close', { mode: 'reopen', proposalId: extraProposal.id, reason: 'Correção somente da locação adicional.', confirmed: true }, extraId), extraOwner);
    assert.equal(extraOwner.records.find(item => item.id === extraId).data.stage, 'Proposta');
    assert.equal((await row('properties', id(302))).status, 'Disponível');
    assert.deepEqual(await row('leads', id(102)), mainLeadBeforeExtra);
    assert.deepEqual(extraOwner.records.find(item => item.id === caseId).data, mainCaseBeforeExtra, 'primary case and its history are independent');
    ownerState = extraOwner;

    const acceptedDate = ownerState.records.find(item => item.id === proposal.id).data.acceptedAt;
    const closedDate = ownerState.records.find(item => item.id === caseId).data.closedAt;
    const sourceBeforeCorrection = (await row('leads', id(102))).source;
    const correct = (mode, data = {}) => register('correct_close', { mode, proposalId: proposal.id, reason: 'Correção sintética solicitada pelo responsável.', confirmed: true, ...data });
    assert.equal((await post('otherBroker', correct('edit', { amount: 555000, conditions: 'Condição revisada' }), await snapshot('otherBroker'))).status, 403);
    assert.equal((await post('otherCompany', correct('reopen'), await snapshot('otherCompany'))).status, 404);
    const editing = correct('edit', { amount: 555000, conditions: 'Condição revisada' });
    state = await snapshot('broker');
    state = await save('broker', editing, state);
    assert.equal(state.records.find(item => item.id === proposal.id).data.amount, 555000);
    assert.equal(state.records.find(item => item.id === proposal.id).data.acceptedAt, acceptedDate);
    assert.equal(state.records.find(item => item.id === caseId).data.closedAt, closedDate);
    assert.equal((await row('properties', id(301))).status, 'Vendido');
    assert.equal((await row('leads', id(102))).source, sourceBeforeCorrection);
    const editedVersion = state.version;
    state = await save('broker', editing, state);
    assert.equal(state.version, editedVersion);
    assert.equal((await post('broker', correct('reopen'), state)).status, 403, 'catalog write permission is required to restore availability');
    ownerState = await snapshot('owner');
    assert.equal((await post('owner', { type: 'save', kind: 'proposals', id: proposal.id, data: { amount: 1 } }, ownerState)).status, 409);
    assert.equal((await post('owner', { type: 'save', kind: 'leads', id: `lead:${id(102)}`, data: { status: 'Pendente' } }, ownerState)).status, 409);
    const beforeUndoRace = ownerState.version;
    beforeCommit = () => db.query('UPDATE properties SET price=price+1 WHERE id=$1', [id(301)]);
    assert.equal((await post('owner', correct('reopen'), ownerState)).status, 409, 'read-to-commit property race rejects the whole reopening');
    assert.equal((await workspace()).version, beforeUndoRace);
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Convertido');
    await db.query("UPDATE properties SET status='Reservado' WHERE id=$1", [id(301)]);
    ownerState = await snapshot('owner');
    assert.equal((await post('owner', correct('reopen'), ownerState)).status, 409, 'an external current catalog status is never overwritten');
    await db.query("UPDATE properties SET status='Vendido',code='ROLLBACK_REOPEN' WHERE id=$1", [id(301)]);
    ownerState = await snapshot('owner');
    const undoFailed = await post('owner', correct('reopen'), ownerState);
    assert.ok([400, 409, 503].includes(undoFailed.status));
    assert.equal((await workspace()).version, ownerState.version, 'SQL failure rolls back all correction events');
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Convertido', 'SQL failure rolls back canonical lead reopening');
    assert.equal((await snapshot('owner')).records.find(item => item.id === proposal.id).data.status, 'Aceita');
    await db.query("UPDATE properties SET code='REOPEN-TEST' WHERE id=$1", [id(301)]);
    ownerState = await snapshot('owner');
    const undo = correct('reopen'), beforeUndo = ownerState;
    failAfterCommit = true;
    const uncertainUndo = await post('owner', undo, ownerState);
    assert.equal(uncertainUndo.status, 503);
    assert.match((await uncertainUndo.json()).error, /salva/);
    ownerState = await save('owner', undo, beforeUndo);
    assert.equal(ownerState.version, beforeUndo.version + 1, 'uncertain committed reopening replays once');
    assert.equal(stage(ownerState), 'Proposta');
    assert.equal(ownerState.records.find(item => item.id === caseId).data.status, 'Aberto');
    assert.equal(ownerState.records.find(item => item.id === caseId).data.closedAt, '');
    assert.equal(ownerState.records.find(item => item.id === proposal.id).data.status, 'Enviada');
    assert.equal(ownerState.records.find(item => item.id === proposal.id).data.acceptedAt, '');
    assert.equal((await row('properties', id(301))).status, 'Disponível');
    assert.equal((await row('leads', id(102))).lifecycle_status, 'Proposta');
    assert.equal((await row('leads', id(102))).source, sourceBeforeCorrection);
    assert(ownerState.events.some(event => event.recordId === caseId && event.changes?.status?.from === 'Ganho' && event.changes.status.to === 'Aberto'));
    assert.equal((await post('owner', correct('reopen'), ownerState)).status, 409);
    await db.query("UPDATE leads SET lifecycle_status='Convertido' WHERE id=$1", [id(101)]);
    ownerState = await snapshot('owner');
    const catalogBeforeLegacy = await row('properties', id(301));
    ownerState = await save('owner', register('correct_close', { mode: 'reopen', reason: 'Fechamento importado incorreto.', confirmed: true }, `case:${id(101)}`), ownerState);
    assert.equal((await row('leads', id(101))).lifecycle_status, 'Em atendimento');
    assert.equal(ownerState.records.find(item => item.id === `case:${id(101)}`).data.stage, 'Atendimento');
    assert.deepEqual(await row('properties', id(301)), catalogBeforeLegacy, 'imported result does not guess or alter a property');

    const messages = (await db.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) data FROM messages m')).rows[0].data;
    assert.deepEqual(messages, untouched, 'registration never sends, edits or deletes WhatsApp/client messages');
    assert.ok(calls.filter(call => !call.resource.startsWith('rpc/')).every(call => call.query.get('company_id')?.startsWith('eq.')), 'reads are scoped to authenticated company');
    for (const callback of afterCallbacks) await callback();
    assert.equal(matchingCalls.length, 4, 'property matching runs once per committed main/extra closing or reopening, never retries or rollback');
    assert(matchingCalls.every(args => args[0] === id(1) && [id(301), id(302)].includes(args[1])));
    console.log('PASS conversation registration API: authenticated tenant/portfolio isolation, explicit six-stage flow, real agenda writes, attendance vs scheduled/realized, immutable confirmed closure, SQL atomic rollback, stale/concurrent protection and idempotent recovery after committed 503. Synthetic PGlite only; no external network, messages or finance writes.');
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
