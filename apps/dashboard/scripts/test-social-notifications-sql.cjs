// Synthetic local SQL only; no provider calls, browser pushes or real accounts.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
(async () => {
 const db = await createDatabase();
 try {
  for (const file of fs.readdirSync(path.resolve(__dirname,'../../../supabase/migrations')).filter(file=>file.endsWith('.sql') && file>isolationMigration).sort()) await db.exec(migration(file));
  await seedCompanies(db);
  for (const n of [12,13]) await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$4,'scrypt-v1$fixture','broker',true,$5,$5)",[id(n),id(1),`Broker ${n}`,`broker ${n}`,`broker${n}@example.test`]);
  const document = {companyId:id(1),version:1,records:[],events:[],members:[],settings:{operations:{dutyPriorityEnabled:true,contactLimitHours:1},management:{blockNewLeads:false,registrationRequired:true,overdueTasksBlock:false,graceHours:1,offlineFallbackMinutes:5}}};
  const persist = () => db.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2,$3) ON CONFLICT(company_id) DO UPDATE SET document=EXCLUDED.document',[id(1),JSON.stringify(document),id(11)]);
  await persist();
  const account = (await db.query("SELECT bind_social_account($1,$2,'instagram','456','123','Synthetic Instagram','encrypted-fixture','v26.0') id",[id(1),id(11)])).rows[0].id;
  const facebook = (await db.query("SELECT bind_social_account($1,$2,'facebook','789','789','Synthetic Facebook','encrypted-fixture','v26.0') id",[id(1),id(11)])).rows[0].id;
  let serial=0;
  const receive = async (lead,minutes=3,channel=account) => (await db.query('SELECT receive_social_message($1,$2,$3,$4,$5,$6,NULL,$7) result',[channel,id(lead),String(lead+9000),`synthetic-${++serial}`,'Synthetic inquiry',JSON.stringify([]),new Date(Date.now()-minutes*60000).toISOString()])).rows[0].result;
  const waiting = async broker => (await db.query('SELECT * FROM broker_unassigned_waiting($1,$2)',[id(1),id(broker)])).rows;
  const handoff = (broker,thread,mode='human') => db.query('SELECT social_handoff($1,$2,$3,$4)',[id(1),id(broker),thread,mode]);
  const has = (rows,lead) => rows.find(row=>row.lead_id===id(lead));
  const first = await receive(1001);
  assert.equal((await db.query('SELECT notification_eligible FROM social_messages WHERE id=$1',[first.messageId])).rows[0].notification_eligible,true,'verified arrival marks evidence');
  assert.equal(Boolean(has(await waiting(12),1001)),false,'offline broker is not alerted immediately');
  await db.query('SELECT touch_broker_presence($1,$2)',[id(1),id(12)]);
  await db.query('SELECT touch_broker_presence($1,$2)',[id(1),id(13)]);
  await db.query("INSERT INTO lead_duty_priorities(company_id,lead_id,broker_ids,preferred_until) VALUES($1,$2,$3,now()+interval '2 minutes')",[id(1),id(1001),[id(12)]]);
  assert.equal(has(await waiting(12),1001).duty_preferred,true,'online duty broker has priority');
  await assert.rejects(()=>handoff(13,first.threadId),/duty_priority_wait/);
  const metadata = (await db.query("SELECT social_attention_state($1,$2,'instagram',$3) data",[id(1),id(13),[first.threadId]])).rows[0].data;
  assert.equal(metadata[0].claimBlockedReason,'duty_priority_wait','same reason exposed to button');
  await handoff(12,first.threadId);
  assert.equal(Boolean(has(await waiting(13),1001)),false,'claimed private lead disappears from shared queue');
  await assert.rejects(()=>handoff(13,first.threadId),/social_forbidden/);
  await handoff(11,first.threadId);
  assert.equal((await db.query('SELECT assigned_broker_id FROM social_threads WHERE id=$1',[first.threadId])).rows[0].assigned_broker_id,id(11),'owner can explicitly take over');

  // Retained history is visible but cannot become the waiting clock.
  await db.query("INSERT INTO leads(id,company_id,name,phone,source,interest_profile) VALUES($1,$2,'Imported contact','','Instagram Direct',$3)",[id(1002),id(1),JSON.stringify({socialMessages:[{id:'old-retained',text:'Historical incoming',at:new Date(Date.now()-86400000).toISOString()}]})]);
  const imported = await receive(1002,1);
  const evidence = (await db.query('SELECT external_id,notification_eligible FROM social_messages WHERE thread_id=$1 ORDER BY occurred_at',[imported.threadId])).rows;
  assert.equal(evidence[0].notification_eligible,false,'imported transcript stays silent');
  assert.equal(Date.parse(has(await waiting(11),1002).waiting_since)>Date.now()-120000,true,'queue starts at verified new event');
  const invalid = (await db.query('SELECT receive_social_message($1,$2,$3,$4,$5,$6,NULL,NULL) result',[account,id(1003),'10003','bad-time','Timestamp absent','[]'])).rows[0].result;
  assert.equal(Boolean(has(await waiting(11),1003)),false,'unverified time cannot create an alert');
  assert.equal((await db.query('SELECT notification_eligible FROM social_messages WHERE id=$1',[invalid.messageId])).rows[0].notification_eligible,false);

  // SLA is an actual human response, not AI, queued work or a failed send.
  const assigned = await receive(1004,125,facebook);
  await handoff(12,assigned.threadId);
  assert.ok(has(await waiting(11),1004),'owner sees overdue assigned Messenger contact');
  assert.equal(Boolean(has(await waiting(13),1004)),false,'ordinary broker cannot see private SLA');
  await db.query("INSERT INTO social_messages(id,company_id,thread_id,direction,content,status,source,actor_id,occurred_at,updated_at) VALUES($1,$2,$3,'outgoing','Synthetic response','pending','human',$4,now(),now())",[id(1101),id(1),assigned.threadId,id(12)]);
  assert.ok(has(await waiting(11),1004),'pending response does not reset SLA');
  await db.query("UPDATE social_messages SET status='failed' WHERE id=$1",[id(1101)]);
  assert.ok(has(await waiting(11),1004),'failed response does not reset SLA');
  await db.query("UPDATE social_messages SET source='ai',actor_id=NULL,status='sent',updated_at=now() WHERE id=$1",[id(1101)]);
  assert.ok(has(await waiting(11),1004),'AI response does not replace human follow-up');
  await db.query("UPDATE social_messages SET source='human',actor_id=$2,status='sent',updated_at=now() WHERE id=$1",[id(1101),id(12)]);
  assert.equal(Boolean(has(await waiting(11),1004)),false,'confirmed human response clears SLA');

  const fallback = await receive(1005,6);
  await db.query("UPDATE broker_presence SET last_seen_at=now()-interval '3 minutes' WHERE company_id=$1",[id(1)]);
  assert.ok(has(await waiting(13),1005),'offline fallback prevents stranded contact');
  await db.query("UPDATE leads SET management_assigned_at=now()-interval '2 hours' WHERE id=$1",[id(1004)]);
  document.settings.management.blockNewLeads=true; await persist();
  assert.equal((await db.query('SELECT broker_management_blocked($1,$2) value',[id(1),id(12)])).rows[0].value,true);
  await assert.rejects(()=>handoff(12,fallback.threadId),/broker_compliance_pending/);
  assert.equal(Boolean(has(await waiting(12),1005)),false,'blocked broker receives no new social leads');
  await handoff(12,assigned.threadId,'suggestions');
  assert.equal((await db.query('SELECT mode FROM social_threads WHERE id=$1',[assigned.threadId])).rows[0].mode,'suggestions','existing portfolio stays available to fix missing work');
  await assert.rejects(()=>db.query('SELECT social_handoff($1,$2,$3,$4)',[id(1),id(21),fallback.threadId,'human']),/social_forbidden/);
  assert.deepEqual((await db.query("SELECT social_attention_state($1,$2,'instagram',$3) data",[id(2),id(21),[fallback.threadId]])).rows[0].data,[],'foreign thread not exposed');
  await db.query('UPDATE social_accounts SET enabled=false WHERE id=$1',[account]);
  assert.equal(Boolean(has(await waiting(11),1005)),false,'disconnected channel cannot create push candidates');
  for(const role of ['anon','authenticated']) {
   await db.exec(`RESET ROLE; SET ROLE ${role}`);
   await assert.rejects(()=>waiting(11),e=>e.code==='42501');
   await assert.rejects(()=>db.query('SELECT * FROM social_messages'),e=>e.code==='42501');
   await assert.rejects(()=>handoff(11,fallback.threadId),e=>e.code==='42501');
  }
  console.log('PASS social attention SQL: verified arrivals, silent legacy history, online duty, SLA, sent human evidence, tenant isolation and compliance without blocking existing work.');
 } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
