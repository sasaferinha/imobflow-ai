const assert=require('node:assert/strict');
const {createDatabase,seedCompanies,migration,id}=require('./helpers/tenant-test-database.cjs');
(async()=>{
 const db=await createDatabase();
 try {
  await db.exec(migration('20260914120000_inbound_recovery.sql'));
  await seedCompanies(db);
  await db.query("UPDATE conversations SET assigned_to=NULL,bot_paused=false,external_conversation_id='whatsapp:5535999990001',phone_number_id='12345'");
  const due=()=>db.query("UPDATE inbound_reply_jobs SET next_attempt_at=now()-interval '1 minute'");
  const claim=async()=>(await db.query('SELECT claim_missing_inbound_reply() AS job')).rows[0].job;
  await due();
  const job=await claim(); assert.equal(job.companyId,id(1));
  assert.equal((await claim()).companyId,id(2));
  assert.equal(await claim(),null,'leased jobs not reclaimed');
  await db.query("INSERT INTO attendance_replies(company_id,conversation_id,dedup_key,created_at,state) VALUES($1,$2,'reply:wamid.1',now()-interval '3 minutes','uncertain')",[id(1),id(501)]);
  await due(); await claim();
  assert.equal((await db.query("SELECT count(*) n FROM attendance_replies WHERE company_id=$1",[id(1)])).rows[0].n,0,'un-enqueued reservation released');
  assert.equal((await db.query("SELECT claim_attendance_reply($1,$2,'wamid.1','reply:wamid.1') ok",[id(1),id(501)])).rows[0].ok,true);
  await db.query("SELECT enqueue_conversation_message($1,$2,'reply:wamid.1','Fixture reply',NULL)",[id(1),id(501)]);
  await due(); await claim(); await claim();
  assert.equal((await db.query('SELECT state FROM inbound_reply_jobs WHERE company_id=$1',[id(1)])).rows[0].state,'done','existing outbox not replayed');
  await db.query('UPDATE conversations SET bot_paused=true WHERE company_id=$1',[id(2)]);
  await due(); await claim();
  assert.equal((await db.query('SELECT state FROM inbound_reply_jobs WHERE company_id=$1',[id(2)])).rows[0].state,'cancelled');
  await db.query("UPDATE conversations SET bot_paused=false WHERE company_id=$1",[id(2)]);
  await db.query("UPDATE messages SET created_at=now()-interval '10 minutes' WHERE company_id=$1",[id(2)]);
  const add=async(external,age)=>db.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,external_message_id,created_at) VALUES($1,$2,'incoming','client','Fixture',$3,now()-($4||' minutes')::interval)",[id(2),id(601),external,String(age)]);
  await add('older',5); await add('latest',1); await due();
  assert.equal((await claim()).incomingExternalMessageId,'latest','newer inbound supersedes older work');
  assert.equal((await db.query("SELECT state FROM inbound_reply_jobs j JOIN messages m ON m.id=j.message_id WHERE m.external_message_id='older'")).rows[0].state,'cancelled');
  await due(); await claim(); await due(); await claim(); await due();
  assert.equal(await claim(),null,'bounded to three recovery attempts');
  assert.equal((await db.query("SELECT state FROM inbound_reply_jobs j JOIN messages m ON m.id=j.message_id WHERE m.external_message_id='latest'")).rows[0].state,'failed');
  await add('expired',1500); await due(); assert.equal(await claim(),null,'expired inbound not contacted');
  for(const role of ['anon','authenticated']){
   await db.exec('SET ROLE '+role);
   await assert.rejects(()=>db.query('SELECT claim_missing_inbound_reply()'),e=>e.code==='42501');
   await assert.rejects(()=>db.query('SELECT * FROM inbound_reply_jobs'),e=>e.code==='42501');
   await db.exec('RESET ROLE');
  }
  console.log('PASS inbound recovery: durable insertion, lease, missing reply release, no outbox replay, human pause and permissions');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
