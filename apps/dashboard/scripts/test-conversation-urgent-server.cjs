const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto'), ts = require('typescript');
const { NextRequest } = require('next/server');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
const root = path.resolve(__dirname, '..'), cache = new Map(), calls = [];
const tokens = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
let database, clock, unavailable = false, override = null;
class Clock extends Date { static now() { return clock; } }
async function db(url, options = {}) {
  calls.push({url, ...options});
  if (url === 'rpc/account_session') return (await database.query('SELECT * FROM account_session($1)', [options.body.p_hash])).rows;
  if (!url.startsWith('rpc/broker_unassigned_waiting?')) throw new Error('Unexpected synthetic database request');
  if (unavailable) throw new Error('Synthetic missing migration');
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('order'), 'waiting_since.asc,lead_id.asc');
  const offset = Number(params.get('offset')), limit = Number(params.get('limit'));
  if (override) return override.slice(offset, offset + limit);
  const rows = (await database.query('SELECT * FROM broker_unassigned_waiting($1,$2) ORDER BY waiting_since,lead_id LIMIT $3 OFFSET $4', [options.body.p_company_id, options.body.p_broker_id, limit, offset])).rows;
  return JSON.parse(JSON.stringify(rows));
}
function load(filename) {
  const full = path.resolve(root, filename.endsWith('.ts') ? filename : filename + '.ts');
  if (cache.has(full)) return cache.get(full);
  const module = {exports: {}}; cache.set(full, module.exports);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
  const requireLocal = specifier => {
    if (specifier === './supabase' || specifier === '@/lib/supabase') return {supabaseRequest: db};
    if (specifier.startsWith('@/')) return load(specifier.slice(2));
    if (specifier.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(full), specifier)));
    return require(specifier);
  };
  vm.runInNewContext(code, {module, exports: module.exports, require: requireLocal, process: {env: {}}, Buffer, URL, Date: Clock}, {filename: full});
  return module.exports;
}
const request = (token = tokens[0]) => new NextRequest(`https://example.test/api/conversations/urgent?companyId=${id(2)}&brokerId=${id(21)}`, {headers: token ? {cookie: `imobflow_session=${token}`} : {}});
(async () => {
  database = await createDatabase();
  try {
    for (const file of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations')).filter(file => file.endsWith('.sql') && file > isolationMigration).sort()) await database.exec(migration(file));
    await seedCompanies(database);
    clock = Date.now();
    await database.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'Other broker','other broker','fixture','broker',true,'other@example.test','other@example.test')", [id(12), id(1)]);
    for (const [index, broker] of [[0, 11], [1, 21], [2, 12]]) await database.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(tokens[index]).digest('hex'), id(broker)]);
    await database.query("UPDATE leads SET assigned_to=NULL WHERE id=$1", [id(101)]);
    await database.query('UPDATE messages SET created_at=$1 WHERE id=$2', [new Date(clock - 6 * 60000).toISOString(), id(701)]);
    // Over 200 newer messages from another contact used to evict the waiting lead
    // from the dashboard's globally paginated message history.
    await database.query("INSERT INTO leads(id,company_id,name,phone,assigned_to) VALUES($1,$2,'Synthetic busy contact','000','Dono 1'),($3,$2,'Synthetic duty contact','001',NULL)", [id(102), id(1), id(103)]);
    await database.query("INSERT INTO conversations(id,company_id,lead_id,status,bot_paused) VALUES($1,$2,$3,'Aberta',false),($4,$2,$5,'Aberta',false)", [id(502), id(1), id(102), id(503), id(103)]);
    await database.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,created_at) SELECT $1,$2,'incoming','client','Synthetic busy traffic',now()-interval '1 second' FROM generate_series(1,250)", [id(1), id(502)]);
    await database.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'incoming','client','Synthetic duty message',$4)", [id(703), id(1), id(503), new Date(clock - 3 * 60000).toISOString()]);
    const document = {companyId: id(1), version: 1, records: [], events: [], members: [], settings: {operations: {dutyPriorityEnabled: true}}};
    await database.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2::jsonb,$3)', [id(1), JSON.stringify(document), id(11)]);
    await database.query('INSERT INTO lead_duty_priorities(company_id,lead_id,broker_ids,preferred_until) VALUES($1,$2,$3,$4)', [id(1), id(103), [id(11)], new Date(clock + 2 * 60000).toISOString()]);
    const latest = (await database.query('SELECT conversation_id FROM messages ORDER BY created_at DESC LIMIT 200')).rows;
    assert(latest.every(row => row.conversation_id !== id(501)), 'old contact is absent from the former global sample');
    assert.equal((await database.query('SELECT * FROM broker_unassigned_waiting($1,$2)', [id(2), id(11)])).rows.length, 0, 'RPC rejects cross-company actor');
    const permission = (await database.query("SELECT has_function_privilege('authenticated','broker_unassigned_waiting(uuid,uuid)','EXECUTE') a,has_function_privilege('anon','broker_unassigned_waiting(uuid,uuid)','EXECUTE') b")).rows[0];
    assert.equal(permission.a || permission.b, false, 'RPC is service only');
    const api = load('app/api/conversations/urgent/route');
    assert.equal((await api.GET(request(null))).status, 401);
    let response = await api.GET(request());
    assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
    let payload = await response.json();
    assert.equal(payload.fetchedAt, clock);
    assert.deepEqual(payload.data.map(row => row.leadId), [id(101), id(103)], 'history-backed general and preferred-duty contacts survive 250 newer messages');
    assert(payload.data.every(row => Object.keys(row).sort().join(',') === 'leadId,waitingSince'), 'response contains no client text/name/phone or roster');
    assert.equal(calls.at(-1).body.p_company_id, id(1)); assert.equal(calls.at(-1).body.p_broker_id, id(11), 'query strings cannot select another actor');
    payload = await (await api.GET(request(tokens[2]))).json();
    assert.deepEqual(payload.data.map(row => row.leadId), [id(101)], 'non-duty broker cannot see the reserved contact early');
    assert.equal((await (await api.GET(request(tokens[1]))).json()).data.length, 0, 'other tenant sees no waiting contact');
    clock += 2 * 60000 - 1;
    assert.deepEqual((await (await api.GET(request(tokens[2]))).json()).data.map(row => row.leadId), [id(101)], 'five-minute boundary minus one millisecond');
    clock += 1;
    assert.deepEqual((await (await api.GET(request(tokens[2]))).json()).data.map(row => row.leadId), [id(101), id(103)], 'five-minute boundary uses server clock');
    await database.query('UPDATE conversations SET assigned_broker_id=$1 WHERE id=$2', [id(11), id(501)]);
    assert(!(await (await api.GET(request())).json()).data.some(row => row.leadId === id(101)), 'new assignment suppresses on next server fetch');
    await database.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,'outgoing','ai','Synthetic reply',now())", [id(1), id(503)]);
    assert.equal((await (await api.GET(request())).json()).data.length, 0, 'new bot reply suppresses waiting');
    unavailable = true; assert.equal((await api.GET(request())).status, 503, 'missing migration is honest failure, not an empty fallback'); unavailable = false;
    const waiting = {company_id: id(1), waiting_since: new Date(clock - 3 * 60000).toISOString(), duty_priority_until: new Date(clock + 2 * 60000).toISOString(), duty_preferred: false};
    override = Array.from({length: 200}, (_, index) => ({...waiting, lead_id: id(10000 + index)}));
    override.push({...waiting, lead_id: id(11000), duty_preferred: true});
    assert.deepEqual((await (await api.GET(request())).json()).data.map(row => row.leadId), [id(11000)], 'pagination scans past 200 not-yet-eligible contacts');
    override = Array.from({length: 70}, (_, index) => ({...waiting, lead_id: id(12000 + index), duty_priority_until: null, waiting_since: new Date(clock - (80 - index) * 60000).toISOString()}));
    payload = await (await api.GET(request())).json(); assert.equal(payload.data.length, 50); assert.equal(payload.data[0].leadId, id(12000));
    override = [{...waiting, company_id: id(2), lead_id: id(101)}]; assert.equal((await api.GET(request())).status, 503, 'unexpected scope is never exposed'); override = null;
    await database.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(11)]);
    assert.equal((await database.query('SELECT * FROM broker_unassigned_waiting($1,$2)', [id(1), id(11)])).rows.length, 0);
    assert.equal((await api.GET(request())).status, 401, 'disabled account loses session access');
    console.log('PASS urgent server: complete migrations + real authenticated API, old contact beyond 250 global messages, active tenant scope, 2/5-minute server clock, reserved-contact pagination, bounded private response, reply/assignment cancellation and honest missing-schema failure. No network.');
  } finally { await database.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
