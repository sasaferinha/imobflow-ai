// Real session -> assistant route/provider -> UI contract -> evolution API -> SQL.
// Only synthetic in-memory PGlite and a simulated OpenAI HTTP response are used.
// Unexpected network requests and non-atomic customer/message writes fail.
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
    SUPABASE_URL: 'https://assistant-isolated.example.test', SUPABASE_SECRET_KEY: 'synthetic-supabase-key',
    OPENAI_API_KEY: 'synthetic-openai-key', OPENAI_MODEL: 'gpt-4o-mini',
    CRM_EVOLUTION_ENABLED: 'true', CRM_EVOLUTION_INTEGRATED: 'true', CRM_EVOLUTION_COMPANIES: `${id(1)},${id(2)}`,
  };
  const calls = [], providerCalls = [], afterCallbacks = [];
  let providerHook;
  const incoming = 'Quero comprar um apartamento na Vila Nova. Meu orçamento máximo é 450 mil.';
  const analysis = () => ({
    reply: 'Entendi! Quantos quartos você procura no apartamento?', explanation: 'Confirme as preferências antes de salvar.',
    changes: [
      { field: 'propertyType', value: 'Apartamento', messageId: id(702), evidence: 'comprar um apartamento' },
      { field: 'region', value: 'Vila Nova', messageId: id(702), evidence: 'na Vila Nova' },
      { field: 'budgetMax', value: 450000, messageId: id(702), evidence: 'Meu orçamento máximo é 450 mil.' },
    ], missing: ['features'],
  });
  try {
    await seedCompanies(db);
    await db.exec(`UPDATE leads SET score=0,temperature='Frio' WHERE score IS NULL;
      ALTER TABLE leads ALTER COLUMN score SET DEFAULT 0,ALTER COLUMN score SET NOT NULL,
        ALTER COLUMN temperature SET DEFAULT 'Frio',ALTER COLUMN temperature SET NOT NULL;
      ALTER TABLE properties ALTER COLUMN images DROP DEFAULT;
      ALTER TABLE properties ALTER COLUMN images TYPE text[] USING '{}'::text[];
      ALTER TABLE properties ALTER COLUMN images SET DEFAULT '{}'::text[],ALTER COLUMN images SET NOT NULL;`);
    for (const n of [12, 13]) {
      await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$3,'fixture','broker',true,$4,$4)", [id(n), id(1), `Broker ${n}`, `broker${n}@example.test`]);
    }
    await db.query("INSERT INTO leads(id,company_id,name,phone,goal,property_type,region,budget_max,assigned_to,source,lifecycle_status,details) VALUES($1,$2,'NOME_NAO_ENVIAR_A_IA','5535999990012','Comprar','Casa','Centro',500000,'Broker 12','WhatsApp','Novo','Observação preservada')", [id(102), id(1)]);
    await db.query("INSERT INTO conversations(id,company_id,lead_id,channel,status,assigned_broker_id,assigned_to) VALUES($1,$2,$3,'WhatsApp','Aberta',$4,'Broker 12')", [id(502), id(1), id(102), id(12)]);
    await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,external_message_id,created_at) VALUES($1,$2,$3,'incoming','client',$4,'wamid.synthetic.assistant',now()-interval '2 minutes')", [id(702), id(1), id(502), incoming]);
    await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'outgoing','human','Tenho uma casa de 700 mil em outro bairro.',now()-interval '1 minute')", [id(703), id(1), id(502)]);
    await db.exec(migration('20261007190000_crm_evolution_workspace.sql'));
    await db.exec(migration('20261007210000_crm_evolution_legacy_bridge.sql'));
    const sessions = { owner: ['a'.repeat(64), 11], broker: ['b'.repeat(64), 12], otherBroker: ['c'.repeat(64), 13], otherCompany: ['d'.repeat(64), 21] };
    for (const [token, actor] of Object.values(sessions)) {
      await db.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest('hex'), id(actor)]);
    }
    const messagesBefore = (await db.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) data FROM messages m')).rows[0].data;
    const foreignBefore = (await db.query('SELECT to_jsonb(l) data FROM leads l WHERE id=$1', [id(201)])).rows[0].data;
    await db.exec('SET ROLE service_role');
    const identifier = value => { assert.match(value, /^[a-z_][a-z0-9_]*$/); return `"${value}"`; };
    async function transport(input, options = {}) {
      const url = new URL(input);
      if (url.href === 'https://api.openai.com/v1/responses') {
        assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer synthetic-openai-key');
        const body = JSON.parse(options.body); providerCalls.push(body);
        assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
        assert.doesNotMatch(options.body, /NOME_NAO_ENVIAR_A_IA|5535999990012|Mensagem 1|Mensagem 2/, 'Only the target conversation and commercial profile reach the provider');
        assert.deepEqual(JSON.parse(body.input[0].content).recentMessages.map(message => message.id), [id(702), id(703)], 'Real database chronology is preserved');
        if (providerHook) { const hook = providerHook; providerHook = undefined; await hook(); }
        return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis()) }] }] });
      }
      assert.equal(url.origin, env.SUPABASE_URL, 'External network is forbidden');
      assert.equal(options.headers.apikey, 'synthetic-supabase-key');
      const resource = url.pathname.replace('/rest/v1/', ''); calls.push({ resource, method: options.method || 'GET', query: url.searchParams });
      try {
        if (resource.startsWith('rpc/')) {
          const fn = resource.slice(4), entries = Object.entries(JSON.parse(options.body));
          assert.ok(['account_session', 'consume_rate_limit', 'commit_crm_evolution_changes', 'save_crm_evolution_workspace'].includes(fn), `Unexpected RPC ${fn}`);
          const rows = (await db.query(`SELECT * FROM public.${identifier(fn)}(${entries.map(([key], i) => `${identifier(key)}=>$${i + 1}`).join(',')})`, entries.map(([, value]) => typeof value === 'object' && value !== null ? JSON.stringify(value) : value))).rows;
          return Response.json(fn === 'account_session' ? rows : rows[0][fn]);
        }
        assert.equal(options.method || 'GET', 'GET', 'No direct canonical/message writes are allowed');
        assert.ok(['broker_accounts', 'crm_evolution_workspaces', 'leads', 'properties', 'appointments', 'conversations', 'messages'].includes(resource), resource);
        const values = [], conditions = [];
        for (const [key, value] of url.searchParams) {
          if (['select', 'order', 'offset', 'limit'].includes(key)) continue;
          if (value.startsWith('in.(') && value.endsWith(')')) {
            const members = value.slice(4, -1).split(','); assert.ok(members.length > 0);
            conditions.push(`${identifier(key)} IN (${members.map(member => { values.push(member); return `$${values.length}`; }).join(',')})`);
          } else {
            assert.ok(value.startsWith('eq.')); values.push(key === 'active' ? value.slice(3) === 'true' : value.slice(3));
            conditions.push(`${identifier(key)}=$${values.length}`);
          }
        }
        const selected = url.searchParams.get('select') || '*';
        const columns = selected === '*' ? '*' : selected.split(',').map(identifier).join(',');
        const order = (url.searchParams.get('order') || (resource === 'crm_evolution_workspaces' ? 'company_id.asc' : 'id.asc')).split(',').map(item => {
          const [key, direction = 'asc'] = item.split('.'); assert.ok(['asc', 'desc'].includes(direction)); return `${identifier(key)} ${direction}`;
        }).join(',');
        const limit = Number(url.searchParams.get('limit') || 100), offset = Number(url.searchParams.get('offset') || 0);
        assert.ok(Number.isSafeInteger(limit) && Number.isSafeInteger(offset) && limit > 0 && offset >= 0);
        const rows = (await db.query(`SELECT to_jsonb(q) payload FROM (SELECT ${columns} FROM public.${identifier(resource)}${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}) q`, values)).rows;
        return Response.json(rows.map(row => row.payload));
      } catch (error) { if (error instanceof assert.AssertionError) throw error; return Response.json({ message: error.message, code: error.code }, { status: 400 }); }
    }
    const cache = new Map();
    function load(file) {
      if (cache.has(file)) return cache.get(file);
      let source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      if (file === 'app/conversation-assistant.tsx') source += '\nexport { isResult as acceptsAnalysisResponse };';
      const output = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
      const mod = { exports: {} }; cache.set(file, mod.exports);
      const localRequire = name => {
        if (name === 'server-only' || name.endsWith('.module.css')) return {};
        if (name === 'next/server') return { NextResponse: { json: Response.json }, after: callback => afterCallbacks.push(callback) };
        if (name === '@/lib/opportunities' || name === '../opportunities') return { onPropertyChanged: () => { throw Error('Analysis/profile update must not offer properties to customers'); } };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
        return require(name);
      };
      vm.runInNewContext(output, { module: mod, exports: mod.exports, require: localRequire, process: { env }, Buffer, Date, URL, URLSearchParams, Response, Request, Headers, AbortSignal, AbortController, structuredClone, crypto: crypto.webcrypto, console, fetch: transport });
      cache.set(file, mod.exports); return mod.exports;
    }
    const assist = load('app/api/conversations/assist/route.ts'), evolution = load('app/api/evolution/route.ts'), ui = load('app/conversation-assistant.tsx');
    const request = (route, method, actor, body, origin = 'https://app.example.test') => {
      const req = new Request(`https://app.example.test/api/${route}?company_id=${id(2)}`, { method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      req.nextUrl = new URL(req.url); req.cookies = { get: name => name === 'imobflow_session' && actor ? { value: sessions[actor]?.[0] || actor } : undefined }; return req;
    };
    const analyze = (actor = 'broker', leadId = id(102), origin) => assist.POST(request('conversations/assist', 'POST', actor, { leadId, sector: 'automatic' }, origin));
    const snapshot = async actor => { const response = await evolution.GET(request('evolution', 'GET', actor)); assert.equal(response.status, 200); return (await response.json()).state; };
    const canonical = async () => (await db.query('SELECT to_jsonb(l) data FROM leads l WHERE id=$1', [id(102)])).rows[0].data;
    const saveReviewed = (actor, result) => evolution.POST(request('evolution', 'POST', actor, {
      expectedVersion: result.review.expectedVersion, expectedSourceRevision: result.review.expectedSourceRevision,
      command: { type: 'save', kind: 'leads', id: result.review.record.id, data: { ...result.review.record.data, ...Object.fromEntries(result.assistance.changes.map(change => [change.field, change.value])) } },
    }));
    assert.equal((await analyze('')).status, 401); assert.equal((await analyze('otherBroker')).status, 403);
    assert.equal((await analyze('otherCompany')).status, 403); assert.equal((await analyze('broker', id(102), 'https://foreign.example.test')).status, 403);
    assert.equal(providerCalls.length, 0, 'Unauthorized requests cannot reach the provider');
    const initial = await canonical();
    const response = await analyze(); const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    assert.equal(ui.acceptsAnalysisResponse(result), true, 'Actual UI parser accepts the full real-route/provider contract');
    assert.deepEqual(result.assistance, analysis()); assert.equal(result.messageCount, 2);
    assert.deepEqual(await canonical(), initial, 'Analyzing alone never modifies the customer');
    assert.equal(calls.filter(call => call.resource === 'rpc/commit_crm_evolution_changes').length, 0);
    assert.equal((await saveReviewed('otherBroker', result)).status, 403); assert.equal((await saveReviewed('otherCompany', result)).status, 409);
    const saved = await saveReviewed('broker', result); const savedBody = await saved.json();
    assert.equal(saved.status, 200, JSON.stringify(savedBody));
    const row = await canonical();
    assert.equal(row.property_type, 'Apartamento'); assert.equal(row.region, 'Vila Nova'); assert.equal(row.budget_max, 450000);
    assert.equal(row.name, initial.name); assert.equal(row.phone, initial.phone); assert.equal(row.details, initial.details);
    assert.equal(row.assigned_to, 'Broker 12'); assert.equal(row.lifecycle_status, 'Novo', 'Catalog review does not advance the funnel');
    const reopened = await snapshot('broker'), lead = reopened.records.find(record => record.id === `lead:${id(102)}`);
    assert.equal(lead.data.propertyType, 'Apartamento'); assert.equal(lead.data.region, 'Vila Nova'); assert.equal(lead.data.budgetMax, 450000);
    assert.equal(reopened.records.find(record => record.id === `case:${id(102)}`).data.stage, 'Lead');
    assert.ok(reopened.events.length > 0, 'Reviewed save has real CRM audit history');
    assert.equal((await saveReviewed('broker', result)).status, 409, 'Stale review cannot overwrite a later saved version');
    providerHook = () => db.query("UPDATE properties SET title='Unrelated synthetic update' WHERE id=$1", [id(301)]);
    const unrelated = await analyze(); const unrelatedBody = await unrelated.json(); assert.equal(unrelated.status, 200, JSON.stringify(unrelatedBody));
    assert.equal(ui.acceptsAnalysisResponse(unrelatedBody), true); assert.notEqual(unrelatedBody.review.expectedSourceRevision, reopened.sourceRevision);
    assert.equal((await saveReviewed('broker', unrelatedBody)).status, 200, 'Fresh CAS returned after unrelated updates is usable by the actual save API');
    providerHook = () => db.query("UPDATE leads SET region='Customer changed concurrently' WHERE id=$1", [id(102)]);
    assert.equal((await analyze()).status, 409, 'Actual canonical target change during analysis is rejected');
    providerHook = () => db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Broker 13' WHERE id=$2", [id(13), id(502)]);
    assert.equal((await analyze()).status, 403, 'Real portfolio reassignment during analysis revokes the response');
    assert.equal(providerCalls.length, 4);
    assert.equal((await db.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) data FROM messages m')).rows[0].data.length, messagesBefore.length);
    assert.deepEqual((await db.query('SELECT jsonb_agg(to_jsonb(m) ORDER BY id) data FROM messages m')).rows[0].data, messagesBefore, 'No message was sent, edited or deleted');
    assert.deepEqual((await db.query('SELECT to_jsonb(l) data FROM leads l WHERE id=$1', [id(201)])).rows[0].data, foreignBefore);
    assert.equal(afterCallbacks.length, 0, 'Profile review schedules no customer delivery');
    assert.ok(calls.filter(call => !call.resource.startsWith('rpc/')).every(call => call.query.get('company_id')?.startsWith('eq.')));
    console.log('PASS integrated assistant: real session/protectedRoute, tenant+portfolio isolation, rate-limit SQL, real provider parsing with synthetic HTTP, actual UI contract, reviewed save via atomic CRM SQL, canonical reload, untouched identity/stage/messages, stale CAS, unrelated-update recovery and target/access races.');
    console.log('Synthetic PGlite only. OpenAI HTTP was simulated; no production credentials, external network or customer delivery.');
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
