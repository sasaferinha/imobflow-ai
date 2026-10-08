const assert = require('node:assert/strict');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  let checks = 0;
  const row = async (table, n) => (await db.query(`SELECT to_jsonb(t) data FROM ${table} t WHERE id=$1`, [id(n)])).rows[0]?.data;
  const patch = async (table, n, data) => ({ table, id: id(n), operation: 'update', expected: await row(table, n), data });
  const insert = (table, n, data, company = 1) => ({ table, id: id(n), operation: 'insert', expected: null, data: { id: id(n), company_id: id(company), ...data } });
  const doc = async (company = 1) => {
    const stored = (await db.query('SELECT document FROM crm_evolution_workspaces WHERE company_id=$1', [id(company)])).rows[0]?.document;
    const version = Number(stored?.version || 0);
    return { expected: version, document: { companyId: id(company), version: version + 1, records: [], settings: {}, members: [], events: [...stored?.events || [], { id: `event-${version + 1}`, type: 'synthetic' }] } };
  };
  const commit = async (writes, actor = 11, company = 1, plan) => {
    const next = plan || await doc(company);
    return (await db.query('SELECT commit_crm_evolution_changes($1,$2,$3,$4,$5) accepted',
      [id(company), id(actor), next.expected, JSON.stringify(next.document), JSON.stringify(writes)])).rows[0].accepted;
  };
  const snapshot = async () => (await db.query(`SELECT jsonb_build_object(
    'workspace',(SELECT jsonb_agg(to_jsonb(t) ORDER BY company_id) FROM crm_evolution_workspaces t),
    'leads',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM leads t),
    'properties',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM properties t),
    'appointments',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM appointments t)) state`)).rows[0].state;
  const reject = async (writes, code, actor = 11, company = 1) => {
    const before = await snapshot();
    await assert.rejects(() => commit(writes, actor, company), error => error.code === code);
    assert.deepEqual(await snapshot(), before, 'a rejected write changes neither canonical data nor workspace/audit'); checks++;
  };
  const conflict = async (writes, plan) => {
    const before = await snapshot(); assert.equal(await commit(writes, 11, 1, plan), false);
    assert.deepEqual(await snapshot(), before, 'a conflict rolls back all writes, including an earlier accepted canonical patch'); checks++;
  };
  try {
    await seedCompanies(db);
    // Match remote schema metadata, not the weaker historical fixture defaults.
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
      ALTER TABLE appointments ALTER COLUMN scheduled_at SET NOT NULL,ALTER COLUMN status SET DEFAULT 'Agendada',ALTER COLUMN status SET NOT NULL;`);
    for (const [n, name] of [[12, 'Corretor A'], [13, 'Corretor B']]) await db.query(
      "INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active) VALUES($1,$2,$3,$3,'fixture','broker',true)", [id(n), id(1), name]);
    await db.query("UPDATE properties SET images=ARRAY['https://example.test/one.jpg','https://example.test/two.jpg'],match_features=ARRAY['Elevador'] WHERE id=$1", [id(301)]);
    await db.query("UPDATE leads SET interest_profile=interest_profile || '{\"financing\":{\"approved\":true},\"confirmationFlag\":true}'::jsonb WHERE id=$1", [id(101)]);
    await db.exec(migration('20261007190000_crm_evolution_workspace.sql'));
    await db.exec(migration('20261007210000_crm_evolution_legacy_bridge.sql'));
    assert.equal((await db.query('SELECT count(*)::int n FROM crm_evolution_workspaces')).rows[0].n, 0, 'additive migrations seed no workspace or customer');
    await db.exec('SET ROLE service_role');

    const initialLead = await row('leads', 101), initialProperty = await row('properties', 301);
    assert.equal(await commit([await patch('leads', 101, { name: 'Nome atualizado' }), await patch('properties', 301, { title: 'Título atualizado' })]), true);
    assert.equal((await row('leads', 101)).name, 'Nome atualizado');
    assert.equal((await row('properties', 301)).title, 'Título atualizado');
    assert.deepEqual((await row('properties', 301)).images, initialProperty.images, 'text[] photo gallery is untouched by unrelated fields');
    assert.deepEqual((await row('properties', 301)).match_features, ['Elevador']);
    assert.deepEqual((await row('leads', 101)).interest_profile, initialLead.interest_profile, 'qualification history survives unrelated update'); checks++;

    const fresh = await doc();
    assert.equal(await commit([]), true);
    await conflict([await patch('leads', 101, { name: 'Stale workspace' })], fresh);
    const staleProperty = await patch('properties', 301, { title: 'Stale source' });
    staleProperty.expected.price = -1;
    await conflict([await patch('leads', 101, { name: 'Must roll back' }), staleProperty]);
    await reject([await patch('leads', 101, { name: 'Must roll back too' }), await patch('properties', 301, { company_id: id(2) })], '23514');
    await reject([await patch('leads', 101, { 'name=(SELECT password_hash FROM broker_accounts LIMIT 1)': 'injection' })], '23514');
    await reject([{ table: 'broker_accounts', id: id(11), operation: 'update', expected: {}, data: { role: 'owner' } }], '23514');
    await reject([{ ...await patch('leads', 101, {}), operation: 'delete' }], '23514');
    await reject([await patch('leads', 101, { id: id(201) })], '23514');
    await reject([{ ...await patch('leads', 101, { name: 'Invalid source identity' }), expected: {} }], '23514');
    await reject([await patch('leads', 101, { interest_profile: { features: ['Piscina'] } })], '23514');
    const preservedProfile = { ...(await row('leads', 101)).interest_profile, features: ['Piscina'] };
    assert.equal(await commit([await patch('leads', 101, { interest_profile: preservedProfile })]), true); checks++;
    await conflict([await patch('leads', 201, { name: 'Foreign company' })]);
    await reject([insert('leads', 107, { name: 'Wrong tenant', phone: null }, 2)], '23514');
    await reject([await patch('leads', 101, { name: 'Other tenant actor' })], '42501', 21);
    await reject([await patch('leads', 101, { assigned_to: 'Dono 2' })], '42501');
    await reject([await patch('leads', 101, { assigned_to: 'Corretor A' })], '42501');
    await reject([await patch('leads', 101, { name: 'Not assigned' })], '42501', 12);
    await reject([await patch('properties', 301, { title: 'Broker cannot alter catalog' })], '42501', 12);
    await reject([await patch('appointments', 901, { notes: 'Other lead' })], '42501', 12);

    await db.exec('RESET ROLE');
    await db.query('UPDATE conversations SET assigned_broker_id=$1 WHERE id=$2', [id(12), id(501)]);
    await db.exec('SET ROLE service_role');
    assert.equal(await commit([await patch('leads', 101, { details: 'Assigned UUID permits this broker' })], 12), true);
    await reject([await patch('leads', 101, { details: 'Another broker' })], '42501', 13);
    assert.equal(await commit([await patch('appointments', 901, { status: 'Realizada' })], 12), true); checks++;
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO conversations(id,company_id,lead_id,channel,status,assigned_broker_id) VALUES($1,$2,$3,'WhatsApp','Aberta',$4)", [id(511), id(1), id(101), id(13)]);
    await db.exec('SET ROLE service_role');
    await reject([await patch('leads', 101, { details: 'Ambiguous conversation ownership' })], '42501', 12);
    await db.exec('RESET ROLE');
    await db.query("UPDATE conversations SET assigned_broker_id=NULL,assigned_to='Corretor B' WHERE id=$1", [id(511)]);
    await db.exec('SET ROLE service_role');
    await reject([await patch('leads', 101, { details: 'Mixed UUID and name conflict' })], '42501', 12);
    await db.exec('RESET ROLE');
    await db.query('DELETE FROM conversations WHERE id=$1', [id(511)]);
    await db.exec('SET ROLE service_role');
    await reject([await patch('appointments', 901, { property_id: id(401) })], '42501');
    await reject([await patch('appointments', 901, { lead_id: id(201) })], '23514');
    await reject([await patch('appointments', 901, { assigned_to: 'Corretor B' })], '42501', 12);

    // Valid new canonical data and its workspace history are one transaction.
    assert.equal(await commit([
      insert('leads', 108, { name: 'Novo contato', phone: null, assigned_to: 'Corretor A', interest_profile: {} }),
      insert('properties', 308, { code: 'AP-308', title: 'Imóvel novo', purpose: 'Venda', price: 450000, district: 'Centro', city: 'Lavras', property_type: 'Apartamento', images: ['https://example.test/new.jpg'] }),
      insert('appointments', 908, { lead_id: id(108), property_id: id(308), scheduled_at: '2026-10-08T12:00:00Z', assigned_to: 'Corretor A', status: 'Aguardando' }),
    ]), true);
    assert.deepEqual((await row('properties', 308)).images, ['https://example.test/new.jpg']);
    assert.equal((await row('properties', 308)).parking_spaces, 0);
    assert.equal((await row('appointments', 908)).lead_id, id(108));
    assert.equal(await commit([await patch('leads', 108, { details: 'Unique name grants portfolio' })], 12), true); checks++;
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active) VALUES($1,$2,'Corretor A','ambiguous-fixture','fixture','broker',true)", [id(14), id(1)]);
    await db.exec('SET ROLE service_role');
    await reject([await patch('leads', 108, { details: 'Ambiguous display name' })], '42501', 12);
    await db.exec('RESET ROLE');
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(14)]);
    await db.exec('SET ROLE service_role');
    await reject([await patch('leads', 108, { assigned_to: 'Corretor B' })], '42501', 12);
    await reject([insert('appointments', 909, { lead_id: id(201), property_id: id(308), scheduled_at: '2026-10-08T13:00:00Z', status: 'Aguardando' })], '42501');
    await reject([insert('leads', 109, { name: 'Rollback insert', phone: null }), insert('properties', 309, { title: 'Missing required code' })], '23502');
    await conflict([insert('leads', 108, { name: 'Duplicate existing', phone: null })]);
    await reject([await patch('leads', 101, { name: 'Duplicate plan A' }), await patch('leads', 101, { name: 'Duplicate plan B' })], '23514');

    await db.exec('RESET ROLE');
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(12)]);
    await db.exec('SET ROLE service_role');
    await reject([await patch('leads', 101, { name: 'Inactive actor' })], '42501', 12);
    await reject([await patch('leads', 108, { assigned_to: 'Corretor A' })], '42501');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(() => db.query('SELECT commit_crm_evolution_changes($1,$2,0,$3,$4)', [id(1), id(11), '{}', '[]']), error => error.code === '42501'); checks++;
      await assert.rejects(() => db.query('SELECT crm_evolution_can_edit_lead($1,$2,$3)', [id(1), id(11), id(101)]), error => error.code === '42501'); checks++;
    }
    await db.exec('RESET ROLE; SET ROLE service_role');
    await assert.rejects(() => db.query('SELECT crm_evolution_can_edit_lead($1,$2,$3)', [id(1), id(11), id(101)]), error => error.code === '42501'); checks++;
    assert.equal((await row('leads', 201)).name, 'Lead 2', 'other company unchanged');
    console.log(`PASS canonical CRM SQL bridge: ${checks} adversarial/atomic groups, workspace+canonical CAS rollback, company/portfolio/assignee restrictions, text[] photos, native defaults, preserved qualification and denied browser roles.`);
    console.log('Isolated PGlite only; no production data or network. Multi-connection load remains a separate production-readiness check.');
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode=1; });
