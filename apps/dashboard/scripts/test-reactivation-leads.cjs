const assert = require('node:assert/strict');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');
(async () => {
  const db = await createDatabase();
  try {
    await seedCompanies(db);
    await db.exec(migration('20260915180000_reactivation_leads.sql'));
    await db.exec('BEGIN');
    // Remove only fictional messages inside this isolated in-memory database.
    await db.exec('DELETE FROM messages');
    await db.query("UPDATE leads SET last_contact_at=now()-interval '15 days' WHERE id=$1", [id(101)]);
    await db.query("UPDATE leads SET last_contact_at=now()-interval '30 days' WHERE id=$1", [id(201)]);
    const list = async (company=1,broker=11,offset=0) => (await db.query('SELECT list_reactivation_leads($1,$2,$3) data',[id(company),id(broker),offset])).rows[0].data;
    let rows = await list();
    assert.equal(rows.length,1); assert.equal(rows[0].id,id(101)); assert.equal(rows[0].inactivityDays,15);
    assert.deepEqual(await list(2,11),[], 'foreign actor must not access another tenant');
    await db.query("UPDATE leads SET last_contact_at=now()-interval '15 days'+interval '1 second' WHERE id=$1",[id(101)]);
    assert.equal((await list()).length,0,'exactly 15 complete days required');
    await db.query("UPDATE leads SET last_contact_at=NULL,created_at=now()-interval '16 days' WHERE id=$1",[id(101)]);
    rows=await list(); assert.equal(rows[0].lastContactAt,null); assert.equal(rows[0].inactivityDays,16);
    await db.query("UPDATE leads SET created_at=now()+interval '1 day' WHERE id=$1",[id(101)]);
    assert.equal((await list()).length,0,'future dates excluded');
    await db.query("UPDATE leads SET last_contact_at=now()-interval '20 days' WHERE id=$1",[id(101)]);
    for(const status of ['Convertido','Perdido']) {
      await db.query('UPDATE leads SET lifecycle_status=$1 WHERE id=$2',[status,id(101)]);
      assert.equal((await list()).length,0,'closed lead excluded');
    }
    await db.query("UPDATE leads SET lifecycle_status='Proposta' WHERE id=$1",[id(101)]);
    assert.equal((await list()).length,1,'open proposals included');
    await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,created_at) VALUES($1,$2,$3,'incoming',now())",[id(701),id(1),id(501)]);
    assert.equal((await list()).length,0,'recent incoming contact wins over old lead date');
    await db.query("UPDATE messages SET direction='outgoing',delivery_status='failed' WHERE id=$1",[id(701)]);
    assert.equal((await list()).length,1,'failed send is not contact');
    await db.query("UPDATE messages SET delivery_status='pending' WHERE id=$1",[id(701)]);
    assert.equal((await list()).length,1,'pending send is not contact');
    await db.query("UPDATE messages SET delivery_status='sent' WHERE id=$1",[id(701)]);
    assert.equal((await list()).length,0,'confirmed outgoing send counts');
    await db.query("UPDATE messages SET created_at=now()-interval '20 days' WHERE id=$1",[id(701)]);
    await db.query("INSERT INTO message_outbox(id,company_id,conversation_id,request_key,state,updated_at) VALUES($1,$2,$3,'retry-sent','sent',now())",[id(701),id(1),id(501)]);
    assert.equal((await list()).length,0,'recent delivery of an older queued message counts');
    await db.exec('DELETE FROM message_outbox; DELETE FROM messages');
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active) VALUES($1,$2,'Corretor Teste','corretor teste','fixture','broker',true)",[id(12),id(1)]);
    assert.equal((await list(1,12)).length,0,'other broker cannot read assigned lead');
    await db.query("UPDATE leads SET assigned_to='Corretor Teste' WHERE id=$1",[id(101)]);
    assert.equal((await list(1,12)).length,1,'own lead is visible');
    await db.query('UPDATE leads SET assigned_to=NULL WHERE id=$1',[id(101)]);
    assert.equal((await list(1,12)).length,1,'unassigned follows existing opportunities access');
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1',[id(12)]);
    assert.equal((await list(1,12)).length,0,'inactive actor denied');
    await db.exec("INSERT INTO leads(company_id,name,phone,last_contact_at) SELECT '"+id(1)+"','Teste '||n,'000'||n,now()-interval '30 days' FROM generate_series(1,55) n");
    assert.equal((await list()).length,51,'one extra row signals next page');
    assert.equal((await list(1,11,50)).length,6);
    const grants=await db.query("SELECT has_function_privilege('anon','list_reactivation_leads(uuid,uuid,integer)','EXECUTE') anon,has_function_privilege('authenticated','list_reactivation_leads(uuid,uuid,integer)','EXECUTE') authenticated,has_function_privilege('service_role','list_reactivation_leads(uuid,uuid,integer)','EXECUTE') service");
    assert.deepEqual(grants.rows[0],{anon:false,authenticated:false,service:true});
    await db.exec('ROLLBACK');
    console.log('PASS reactivation: exact 15d, contact history, failed/pending sends, delayed delivery, closed leads, tenants, brokers, pagination and privileges');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
