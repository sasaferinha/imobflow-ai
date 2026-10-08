const assert = require('node:assert/strict');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  let rejected = 0;
  const deny = async (sql, values = [], code = '42501') => {
    await assert.rejects(() => db.query(sql, values), error => error.code === code);
    rejected++;
  };
  const document = (company, version, events = []) => ({ companyId: id(company), version, records: [], events, settings: {}, members: [] });
  const save = async (company, actor, version, doc) => (await db.query(
    'SELECT save_crm_evolution_workspace($1,$2,$3,$4) accepted',
    [id(company), id(actor), version, JSON.stringify(doc)],
  )).rows[0].accepted;
  try {
    await seedCompanies(db);
    const legacyBefore = (await db.query('SELECT id,name,company_id,lifecycle_status FROM leads ORDER BY id')).rows;
    await db.exec(migration('20261007190000_crm_evolution_workspace.sql'));
    assert.equal((await db.query('SELECT count(*)::int n FROM crm_evolution_workspaces')).rows[0].n, 0, 'migration never seeds live data');
    await db.exec('SET ROLE service_role');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await deny('SELECT * FROM crm_evolution_workspaces');
      await deny('DELETE FROM crm_evolution_workspaces');
      await deny('SELECT save_crm_evolution_workspace($1,$2,0,$3)', [id(1), id(11), JSON.stringify(document(1, 1))]);
    }
    await db.exec('RESET ROLE; SET ROLE service_role');
    await deny('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2,$3)', [id(1), JSON.stringify(document(1, 1)), id(11)]);
    await deny('SELECT save_crm_evolution_workspace($1,$2,0,$3)', [id(1), id(21), JSON.stringify(document(1, 1))]);
    await deny('SELECT save_crm_evolution_workspace($1,$2,0,$3)', [id(1), id(11), JSON.stringify(document(2, 1))], '23514');
    await deny('SELECT save_crm_evolution_workspace($1,$2,0,$3)', [id(1), id(11), JSON.stringify(document(1, 2))], '23514');
    assert.equal(await save(1, 11, 3, document(1, 4)), false, 'a missing workspace cannot skip versions');
    const first = { id: 'event-1', type: 'created', at: '2026-10-07T19:00:00.000Z' };
    assert.equal(await save(1, 11, 0, document(1, 1, [first])), true);
    assert.equal(await save(1, 11, 0, document(1, 1, [])), false, 'repeated initial write cannot replace accepted data');
    assert.equal(await save(2, 21, 0, document(2, 1)), true);
    await deny('UPDATE crm_evolution_workspaces SET version=2 WHERE company_id=$1', [id(1)]);
    await deny('DELETE FROM crm_evolution_workspaces WHERE company_id=$1', [id(1)]);
    await deny('SELECT save_crm_evolution_workspace($1,$2,1,$3)', [id(1), id(11), JSON.stringify(document(1, 2, []))], '23514');
    await deny('SELECT save_crm_evolution_workspace($1,$2,1,$3)', [id(1), id(11), JSON.stringify(document(1, 2, [{ ...first, type: 'changed' }]))], '23514');
    const second = { id: 'event-2', type: 'updated' };
    assert.equal(await save(1, 11, 1, document(1, 2, [first, second])), true);
    assert.equal(await save(1, 11, 1, document(1, 2, [first, { id: 'losing-race' }])), false, 'stale compare-and-swap fails');
    assert.deepEqual((await db.query('SELECT document FROM crm_evolution_workspaces WHERE company_id=$1', [id(1)])).rows[0].document.events, [first, second]);
    assert.equal(Number((await db.query('SELECT version FROM crm_evolution_workspaces WHERE company_id=$1', [id(2)])).rows[0].version), 1, 'other tenant version untouched');
    await db.exec('RESET ROLE');
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(11)]);
    await db.exec('SET ROLE service_role');
    await deny('SELECT save_crm_evolution_workspace($1,$2,2,$3)', [id(1), id(11), JSON.stringify(document(1, 3, [first, second]))]);
    await db.exec('RESET ROLE');
    await db.exec('GRANT SELECT ON crm_evolution_workspaces TO authenticated; SET ROLE authenticated');
    assert.equal((await db.query('SELECT count(*)::int n FROM crm_evolution_workspaces')).rows[0].n, 0, 'restrictive policy survives an accidental SELECT grant');
    await db.exec('RESET ROLE');
    assert.deepEqual((await db.query('SELECT id,name,company_id,lifecycle_status FROM leads ORDER BY id')).rows, legacyBefore, 'new CRM never alters legacy records');
    assert.equal((await db.query('SELECT count(*)::int n FROM crm_evolution_workspaces')).rows[0].n, 2, 'rollback means disable code, not drop evaluation records');
    console.log(`PASS CRM evolution SQL: ${rejected} rejected writes/reads, tenant actor checks, CAS conflicts, immutable event history, no live seeds and legacy preservation.`);
    console.log('Concurrency limit: this embedded connection verifies stale-version arbitration, not independent production connections.');
  } finally { await db.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
