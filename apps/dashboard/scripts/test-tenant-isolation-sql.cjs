const assert = require('node:assert/strict');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  let checks = 0;
  const denied = async (sql, values = [], code = '23503') => {
    await assert.rejects(() => db.query(sql, values), error => error.code === code, sql);
    checks++;
  };
  try {
    await seedCompanies(db);
    // Run hostile writes as the actual privileged role, not as a toy JWT role.
    await db.exec('SET ROLE service_role');
    for (const [sql, values] of [
      ['INSERT INTO conversations(company_id,lead_id) VALUES($1,$2)', [id(1),id(201)]],
      ['UPDATE conversations SET lead_id=$1 WHERE id=$2', [id(201),id(501)]],
      ['UPDATE conversations SET assigned_broker_id=$1 WHERE id=$2', [id(21),id(501)]],
      ['INSERT INTO messages(company_id,conversation_id) VALUES($1,$2)', [id(1),id(601)]],
      ['UPDATE messages SET conversation_id=$1 WHERE id=$2', [id(601),id(701)]],
      ['INSERT INTO appointments(company_id,lead_id,property_id) VALUES($1,$2,$3)', [id(1),id(201),id(301)]],
      ['UPDATE appointments SET property_id=$1 WHERE id=$2', [id(401),id(901)]],
      ['INSERT INTO lead_property_events(company_id,lead_id,property_id) VALUES($1,$2,$3)', [id(1),id(201),id(301)]],
      ['INSERT INTO lead_property_events(company_id,lead_id,property_id) VALUES($1,$2,$3)', [id(1),id(101),id(401)]],
      ['INSERT INTO account_invitations(token_hash,company_id,created_by,expires_at) VALUES($1,$2,$3,now())', ['foreign-owner',id(1),id(21)]],
      ['INSERT INTO demo_conversation_threads(company_id,contact_id,assigned_broker_id) VALUES($1,$2,$3)', [id(1),'mariana',id(21)]],
    ]) await denied(sql, values);
    await denied('UPDATE leads SET company_id=$1 WHERE id=$2', [id(2),id(101)], '23514');
    await denied('UPDATE properties SET company_id=$1 WHERE id=$2', [id(2),id(301)], '23514');
    await denied('INSERT INTO messages(company_id,conversation_id) VALUES(NULL,$1)', [id(501)], '23502');

    // Historical delivery IDs deliberately have no live-row FKs: prove their
    // RPC boundary and retention behavior instead of breaking property removal.
    await db.query('UPDATE leads SET assigned_to=NULL WHERE id=$1', [id(201)]);
    await db.query("UPDATE conversations SET status='open',external_conversation_id=$1 WHERE id=$2", ['meta:12345:5535999990002',id(601)]);
    await db.query("INSERT INTO properties(id,company_id,title,purpose,price,district,city,property_type,bedrooms) VALUES($1,$2,'Audit fixture','Venda',500000,'Centro','Lavras','Apartamento',3)", [id(402),id(2)]);
    const claimSql = `SELECT claim_property_auto_delivery($1,$2,$3,$4,'Oferta de teste',
      (SELECT updated_at FROM leads WHERE id=$2),(SELECT updated_at FROM properties WHERE id=$3),'12345','5535999990002') id`;
    await denied(claimSql,[id(1),id(201),id(402),id(801)],'P0001');
    await denied(claimSql,[id(2),id(201),id(301),id(801)],'P0001');
    await denied(claimSql,[id(2),id(201),id(402),id(701)],'P0001');
    const reservation = (await db.query(claimSql,[id(2),id(201),id(402),id(801)])).rows[0].id;
    assert.ok(reservation);
    await denied('SELECT finish_property_auto_delivery($1,$2,$3)', [id(1),reservation,'wamid.foreign'], 'P0001');
    await denied('SELECT mark_property_auto_delivery_uncertain($1,$2)', [id(1),reservation], 'P0001');
    await db.query('SELECT finish_property_auto_delivery($1,$2,$3)', [id(2),reservation,'wamid.audit']);
    await db.query('DELETE FROM properties WHERE company_id=$1 AND id=$2', [id(2),id(402)]);
    assert.equal((await db.query('SELECT state FROM property_auto_deliveries WHERE id=$1',[reservation])).rows[0].state,'accepted');

    await db.query('INSERT INTO conversation_settings(company_id,whatsapp_phone_number_id) VALUES($1,$2)',[id(1),'77777']);
    await denied('INSERT INTO conversation_settings(company_id,whatsapp_phone_number_id) VALUES($1,$2)',[id(2),'77777'],'23505');

    // Existing SQL RPCs must reject mismatched tenant/actor/object combinations.
    assert.equal((await db.query('SELECT change_conversation_owner($1,$2,$3,false) ok', [id(1),id(101),id(21)])).rows[0].ok, false);
    assert.equal((await db.query('SELECT change_conversation_owner($1,$2,$3,false) ok', [id(1),id(201),id(11)])).rows[0].ok, false);
    assert.equal((await db.query('SELECT claim_attendance_reply($1,$2,$3,$4) ok', [id(1),id(601),'wamid.2','attack']) ).rows[0].ok, false);
    assert.equal((await db.query("SELECT merge_attendance_profile($1,$2,now(),'{\"city\":\"Invadida\"}') ok", [id(1),id(201)])).rows[0].ok, false);
    await denied('SELECT enqueue_conversation_message($1,$2,$3,$4,$5)', [id(1),id(601),'attack','Intrusão',id(11)], 'P0001');
    await denied('SELECT finish_property_auto_delivery($1,$2,$3)', [id(1),id(2001),'wamid.attack'], 'P0001');
    assert.equal((await db.query('SELECT generate_property_opportunities($1,$2,7) n', [id(1),id(401)])).rows[0].n, 0);
    for (const company of [1,2]) await db.query('SELECT generate_property_opportunities($1,$2,7)', [id(company),id(company*100+201)]);
    const own = (await db.query('SELECT list_opportunities($1,$2,0) data', [id(1),id(11)])).rows[0].data;
    const foreign = (await db.query('SELECT list_opportunities($1,$2,0) data', [id(2),id(21)])).rows[0].data;
    assert.equal(own.length,1); assert.equal(foreign.length,1);
    assert.deepEqual((await db.query('SELECT list_opportunities($1,$2,0) data', [id(2),id(11)])).rows[0].data, []);
    for (const action of ['draft','read','contacted','dismissed','converted']) {
      await denied('SELECT opportunity_action($1,$2,$3,$4)', [id(1),id(11),foreign[0].id,action], 'P0001');
      await denied('SELECT opportunity_action($1,$2,$3,$4)', [id(2),id(11),foreign[0].id,action], 'P0001');
    }
    await db.query('SELECT opportunity_action($1,$2,$3,$4)', [id(1),id(11),own[0].id,'read']);
    assert.equal((await db.query('SELECT change_conversation_owner($1,$2,$3,false) ok', [id(1),id(101),id(11)])).rows[0].ok,true);
    const outbox = (await db.query('SELECT enqueue_conversation_message($1,$2,$3,$4,$5) id', [id(1),id(501),'own-send','Olá',id(11)])).rows[0].id;
    assert.equal((await db.query('SELECT claim_outbox_message($1,$2) ok', [id(2),outbox])).rows[0].ok,false);
    await denied('UPDATE message_outbox SET broker_id=$1 WHERE id=$2', [id(21),outbox]);
    await denied('UPDATE message_outbox SET id=$1 WHERE id=$2', [id(801),outbox]);
    // Same company but wrong conversation must also fail the message identity FK.
    await db.query('INSERT INTO conversations(id,company_id,lead_id) VALUES($1,$2,$3)', [id(502),id(1),id(101)]);
    await denied('UPDATE message_outbox SET conversation_id=$1 WHERE id=$2', [id(502),outbox]);

    // Bypass is a deliberate limitation, recorded as executable evidence.
    assert.equal((await db.query('SELECT count(*)::int n FROM leads')).rows[0].n,2, 'service_role can read both companies without a filter');
    await db.exec('RESET ROLE');
    const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      for (const { tablename } of tables) {
        await denied(`SELECT * FROM public.${tablename}`, [], '42501');
        await denied(`DELETE FROM public.${tablename}`, [], '42501');
      }
      await denied('UPDATE leads SET name=$1 WHERE id=$2', ['Intrusão',id(201)], '42501');
      await denied('INSERT INTO leads(company_id,name,phone) VALUES($1,$2,$3)', [id(2),'Intrusão','1'], '42501');
      await denied('SELECT account_session($1)', ['anything'], '42501');
      await denied('SELECT list_opportunities($1,$2,0)', [id(2),id(21)], '42501');
      await denied('SELECT enqueue_conversation_message($1,$2,$3,$4,$5)', [id(2),id(601),'attack','Intrusão',id(21)], '42501');
      await db.exec('RESET ROLE');
    }
    // Even restoring all grants cannot reactivate an old permissive RLS policy.
    await db.exec('GRANT ALL ON leads TO authenticated; SET ROLE authenticated');
    assert.equal((await db.query('SELECT count(*)::int n FROM leads')).rows[0].n,0);
    assert.equal((await db.query("UPDATE leads SET name='Intrusão' RETURNING id")).rows.length,0);
    assert.equal((await db.query('DELETE FROM leads RETURNING id')).rows.length,0);
    await denied('INSERT INTO leads(company_id,name,phone) VALUES($1,$2,$3)', [id(1),'Intrusão','1'], '42501');
    await db.exec('RESET ROLE; REVOKE ALL ON leads FROM authenticated');

    // Existing ON DELETE SET NULL/CASCADE still work with the additive FKs.
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query('DELETE FROM properties WHERE company_id=$1 AND id=$2 RETURNING id', [id(1),id(301)])).rows.length,1);
    assert.equal((await db.query('SELECT property_id FROM appointments WHERE id=$1', [id(901)])).rows[0].property_id,null);
    assert.equal((await db.query('SELECT title FROM properties WHERE id=$1', [id(401)])).rows[0].title,'Imóvel 2');
    await db.query('DELETE FROM messages WHERE company_id=$1 AND id=$2', [id(1),outbox]);
    assert.equal((await db.query('SELECT count(*)::int n FROM message_outbox WHERE company_id=$1',[id(1)])).rows[0].n,0,'existing message/outbox cascades are preserved');
    assert.equal((await db.query('SELECT name FROM leads WHERE id=$1',[id(201)])).rows[0].name,'Lead 2');
    await db.exec('RESET ROLE');
    console.log(`PASS tenant SQL: ${checks} rejected attacks; real grants/RLS, composite FKs, immutable company IDs, RPC identity checks, allowed operations and explicit service-role bypass`);
  } finally { await db.close(); }

  // A bad pre-existing relationship causes atomic rollback; it is never fixed
  // by deleting customer records or silently changing their company.
  const legacy = await createDatabase({ hardened:false });
  try {
    await seedCompanies(legacy);
    await legacy.query('UPDATE conversations SET lead_id=$1 WHERE id=$2', [id(201),id(501)]);
    await assert.rejects(() => legacy.exec(migration(isolationMigration)), error => error.code === '23503');
    await legacy.exec('ROLLBACK');
    assert.equal((await legacy.query('SELECT lead_id FROM conversations WHERE id=$1',[id(501)])).rows[0].lead_id,id(201));
    assert.equal((await legacy.query('SELECT count(*)::int n FROM leads')).rows[0].n,2);
    assert.equal((await legacy.query("SELECT count(*)::int n FROM pg_policies WHERE policyname='imobflow_server_only'")).rows[0].n,0);
    console.log('PASS invalid legacy relationship aborts the entire migration and preserves every fixture row');
  } finally { await legacy.close(); }

  const minimal = await createDatabase({ propertyAutoDeliveries:false });
  try {
    await seedCompanies(minimal);
    assert.equal((await minimal.query("SELECT to_regclass('public.property_auto_deliveries') name")).rows[0].name,null,'optional historical flow is not recreated');
    assert.equal((await minimal.query("SELECT count(*)::int n FROM pg_policies WHERE policyname='imobflow_server_only'")).rows[0].n,24);
    await minimal.exec('SET ROLE service_role');
    await assert.rejects(()=>minimal.query('UPDATE conversations SET lead_id=$1 WHERE id=$2',[id(201),id(501)]),error=>error.code==='23503');
    await minimal.query("UPDATE leads SET lifecycle_status='Em atendimento' WHERE company_id=$1 AND id=$2",[id(1),id(101)]);
    console.log('PASS production variant without optional property_auto_deliveries: 24 protected tables, tenant FKs and allowed lead writes; retired flow is not recreated');
  } finally {await minimal.close();}
}
run().catch(error => { console.error(error); process.exitCode = 1; });
