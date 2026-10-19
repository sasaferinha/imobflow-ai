const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDatabase,seedCompanies,id,migration,isolationMigration}=require('./helpers/tenant-test-database.cjs');
const repeatMigration='20261019140000_persistent_unassigned_push.sql';
const repeatSql=migration(repeatMigration);
assert(repeatSql.indexOf('LOCK TABLE public.web_push_attempts IN SHARE ROW EXCLUSIVE MODE')<repeatSql.indexOf('INSERT INTO public.web_push_cooldowns(')
 && repeatSql.includes('LOCK TABLE public.web_push_attempts IN SHARE ROW EXCLUSIVE MODE'),'migration drains old receipt writers before backfill');
(async()=>{
 const db=await createDatabase();
 try {
  const files=fs.readdirSync(path.resolve(__dirname,'../../../supabase/migrations')).filter(file=>file.endsWith('.sql')&&file>isolationMigration).sort();
  for(const file of files.filter(file=>file<repeatMigration))await db.exec(migration(file));
  await seedCompanies(db);
  // Keep this admission fixture open regardless of the machine's wall-clock
  // hour; separate business-hours tests cover the real schedule boundaries.
  const offset=new Date().getUTCHours()-12;
  const openHours={timeZone:`Etc/GMT${offset>=0?'+':''}${offset}`,opens:'08:00',closes:'18:00',weekdays:[0,1,2,3,4,5,6],holidays:[],awayMessage:'Synthetic schedule'};
  for(const company of [1,2])await db.query('INSERT INTO conversation_settings(company_id,business_hours) VALUES($1,$2::jsonb) ON CONFLICT(company_id) DO UPDATE SET business_hours=EXCLUDED.business_hours',[id(company),JSON.stringify(openHours)]);
  const hashes=['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)];
  for(const [hash,broker] of [[hashes[0],11],[hashes[1],21],[hashes[2],11]])await db.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[hash,id(broker)]);
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:'fixture-only',auth:'fixture-only'}};
  const register=async(company=1,broker=11,hash=hashes[0],endpointHash='d'.repeat(64))=>(await db.query('SELECT register_web_push($1,$2,$3,$4,$5::jsonb) id',[id(company),id(broker),hash,endpointHash,JSON.stringify(subscription)])).rows[0].id;
  await assert.rejects(()=>register(2,11),/session_required/);
  await assert.rejects(()=>register(1,11,hashes[1]),/session_required/);
  let binding=await register();assert.equal(await register(),binding,'same device/session is idempotent');
  const candidates=async(limit=40,offset=0)=>(await db.query('SELECT list_web_push_candidates($1,$2) result',[limit,offset])).rows[0].result;
  const claim=async(wait=id(701),device=binding,lead=id(101))=>(await db.query('SELECT claim_web_push($1,$2,$3) id',[device,lead,wait])).rows[0].id;
  const target=async(attempt)=>(await db.query('SELECT web_push_dispatch_target($1) result',[attempt])).rows[0].result;
  const ageCooldown=async()=>db.query("UPDATE web_push_cooldowns SET last_attempt_at=clock_timestamp()-interval '5 minutes 1 millisecond' WHERE company_id=$1 AND broker_id=$2 AND endpoint_hash=$3 AND lead_id=$4",[id(1),id(11),'d'.repeat(64),id(101)]);
  assert.equal((await db.query('SELECT list_web_push_candidates(40) result')).rows[0].result.length,0,'assigned contact is ineligible');
  await db.query('UPDATE leads SET assigned_to=NULL WHERE id=$1',[id(101)]);
  await db.query('UPDATE conversations SET assigned_to=NULL,assigned_broker_id=NULL,bot_paused=false WHERE id=$1',[id(501)]);
  await db.query("UPDATE messages SET created_at=now()-interval '6 minutes' WHERE id=$1",[id(701)]);
  const first=(await db.query('SELECT list_web_push_candidates(40) result')).rows[0].result[0];
  assert.equal(first.waiting_message_id,id(701));
  const oldAttempt=await claim();assert(oldAttempt);
  const workspace={companyId:id(1),version:1,records:[],events:[],members:[],settings:{operations:{dutyPriorityEnabled:true}}};
  await db.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2::jsonb,$3)',[id(1),JSON.stringify(workspace),id(11)]);
  await db.query("INSERT INTO lead_duty_priorities(company_id,lead_id,broker_ids,created_at,preferred_until) VALUES($1,$2,$3,now()-interval '1 minute',now()+interval '4 minutes')",[id(1),id(101),[id(11)]]);
  const priorityBefore=(await db.query('SELECT * FROM lead_duty_priorities WHERE lead_id=$1',[id(101)])).rows[0];
  // Apply the additive migration with an existing receipt, not only empty tables.
  for(const file of files.filter(file=>file>=repeatMigration))await db.exec(migration(file));
  assert.equal((await db.query('SELECT urgent_alert_policy_version() version')).rows[0].version,3);
  const priorityAfter=(await db.query('SELECT * FROM lead_duty_priorities WHERE lead_id=$1',[id(101)])).rows[0];
  assert.equal(priorityAfter.preferred_until.getTime(),Date.parse(first.waiting_since)+300000,'backfill aligns old reservation with first valid incoming');
  assert.deepEqual(priorityAfter.broker_ids,priorityBefore.broker_ids);assert.equal(priorityAfter.created_at.getTime(),priorityBefore.created_at.getTime(),'backfill preserves roster and original reservation audit');
  assert.equal((await db.query('SELECT list_web_push_candidates(40) result')).rows[0].result.length,0,'old one-argument callers retain the offset default');
  assert.equal((await db.query('SELECT count(*)::int count FROM web_push_attempts')).rows[0].count,1,'migration preserves receipts');
  assert.equal((await candidates()).length,0,'migration backfills live cooldown');
  assert.equal(await claim(),null,'existing receipt still protects current device');
  assert.equal((await target(oldAttempt)).companyId,id(1));
  assert.equal(Date.parse((await target(oldAttempt)).waitingSince),Date.parse(first.waiting_since));
  await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'outgoing','ai','Synthetic bot reply',now()-interval '5 minutes'),($4,$2,$3,'incoming','client','Synthetic next incoming',now()-interval '4 minutes')",[id(8001),id(1),id(501),id(8002)]);
  const waiting=(await db.query('SELECT * FROM broker_unassigned_waiting($1,$2)',[id(1),id(11)])).rows;
  assert.equal(waiting.length,1);assert.equal(waiting[0].waiting_message_id,id(701),'AI reply/later incoming do not restart first arrival');
  assert.equal(Date.parse((await target(oldAttempt)).waitingSince),Date.parse(first.waiting_since),'AI is not human acceptance');
  await db.query("UPDATE lead_duty_priorities SET preferred_until=now()+interval '4 minutes' WHERE company_id=$1 AND lead_id=$2",[id(1),id(101)]);
  const lateReservation=(await db.query('SELECT * FROM broker_unassigned_waiting($1,$2)',[id(1),id(11)])).rows[0];
  assert.equal(new Date(lateReservation.waiting_since).getTime(),Date.parse(first.waiting_since),'SQL keeps original arrival when reservation is created later');
  assert.equal(lateReservation.duty_preferred,true);
  assert.equal(Date.parse((await target(oldAttempt)).waitingSince),Date.parse(first.waiting_since),'push target keeps the same first-arrival clock, not the reservation clock');
  assert.equal(await claim(id(8002)),null,'later message cannot bypass stable first-arrival identity');
  assert(!JSON.stringify(waiting).includes('Synthetic'),'candidate has no client content');
  const edge=(await db.query("SELECT web_push_retry_due('2026-10-19T12:00:00Z','2026-10-19T12:04:59.999Z') before,web_push_retry_due('2026-10-19T12:00:00Z','2026-10-19T12:05:00Z') exact,web_push_retry_due('2026-10-19T12:04:59.999Z','2026-10-19T12:05:00Z') boundary,web_push_retry_due('infinity','2026-10-19T12:05:00Z') invalid,web_push_retry_due('2026-10-20T12:00:00Z','2026-10-19T12:05:00Z') future")).rows[0];
  assert.deepEqual(edge,{before:false,exact:true,boundary:false,invalid:false,future:false},'shared admission predicate checks exact 299999/300000ms; no time buckets');
  await db.query("SELECT finish_web_push($1,'failed',false)",[oldAttempt]);
  assert.equal(await target(oldAttempt),null);assert.equal(await claim(),null,'failure preserves full cooldown');
  await ageCooldown();assert.equal((await candidates()).length,1,'after five minutes same incoming can notify again');
  // PGlite serializes its embedded engine; simultaneous callers still exercise
  // the actual conditional UPSERT admission, not a mocked lock or receipt.
  const attempts=await Promise.all(Array.from({length:12},()=>claim()));
  assert.equal(attempts.filter(Boolean).length,1,'only one caller wins admission');
  const second=attempts.find(Boolean);assert(second);assert.notEqual(second,oldAttempt);
  assert.equal(await claim(),null,'no catch-up burst');assert.equal((await candidates()).length,0,'filter recent attempts before batch limit');
  await db.query("INSERT INTO leads(id,company_id,name,phone,assigned_to) VALUES($1,$2,'Synthetic second contact','000',NULL)",[id(102),id(1)]);
  await db.query("INSERT INTO conversations(id,company_id,lead_id,status) VALUES($1,$2,$3,'Aberta')",[id(502),id(1),id(102)]);
  await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'incoming','client','Synthetic second lead',now()-interval '6 minutes')",[id(702),id(1),id(502)]);
  assert.equal((await candidates(1))[0].lead_id,id(102),'cooling old contact cannot monopolize limited list');
  assert.equal((await candidates(1,1)).length,0,'pagination offset is applied');
  await ageCooldown();
  const page1=await candidates(1),page2=await candidates(1,1);assert.equal(page1.length,1);assert.equal(page2.length,1);assert.notEqual(page1[0].lead_id,page2[0].lead_id);
  // Restore the real last admission so the following logout tests cannot retry.
  await db.query('UPDATE web_push_cooldowns SET last_attempt_at=(SELECT created_at FROM web_push_attempts WHERE id=$1) WHERE lead_id=$2',[second,id(101)]);
  await db.query('UPDATE leads SET assigned_to=$1 WHERE id=$2',['Dono 1',id(102)]);
  await db.query('UPDATE conversations SET assigned_broker_id=$1 WHERE id=$2',[id(11),id(501)]);
  assert.equal(await target(second),null,'ownership invalidates target');
  await db.query('UPDATE conversations SET assigned_broker_id=NULL,status=$1 WHERE id=$2',['closed',id(501)]);
  assert.equal(await target(second),null,'closed conversation invalidates target');
  await db.query('UPDATE conversations SET status=$1 WHERE id=$2',['Aberta',id(501)]);
  assert.equal(Date.parse((await target(second)).waitingSince),Date.parse(first.waiting_since),'reopening does not invent historical acceptance');
  await db.query('UPDATE leads SET lifecycle_status=$1 WHERE id=$2',['Convertido',id(101)]);assert.equal(await target(second),null);
  await db.query('UPDATE leads SET lifecycle_status=$1 WHERE id=$2',['Novo',id(101)]);
  const replacement=await register(2,21,hashes[1]);assert.notEqual(replacement,binding);
  assert.equal(await target(second),null);assert.equal((await candidates()).length,0,'other tenant cannot see contact');
  assert.equal((await db.query('SELECT count(*)::int count FROM web_push_attempts WHERE subscription_id IS NULL')).rows[0].count,2,'receipts survive rebinding without retaining endpoint keys');
  binding=await register(1,11,hashes[0]);assert.equal(await claim(),null,'account switch back cannot reset cooldown');
  await db.query('DELETE FROM account_sessions WHERE token_hash=$1',[hashes[0]]);
  assert.equal((await db.query('SELECT count(*)::int count FROM web_push_subscriptions WHERE id=$1',[binding])).rows[0].count,0,'logout deletes subscription');
  binding=await register(1,11,hashes[2]);assert.equal(await claim(),null,'re-login cannot reset device/contact cooldown');
  await db.query("UPDATE account_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashes[2]]);
  await ageCooldown();assert.equal((await candidates()).length,0);assert.equal(await claim(),null,'expired session cannot claim');
  await db.query("UPDATE account_sessions SET expires_at=now()+interval '1 hour' WHERE token_hash=$1",[hashes[2]]);
  const expired=await claim();assert(expired);await db.query("SELECT finish_web_push($1,'failed',true)",[expired]);
  assert.equal((await db.query('SELECT count(*)::int count FROM web_push_subscriptions WHERE id=$1',[binding])).rows[0].count,0,'404/410 retires binding');
  binding=await register(1,11,hashes[2]);assert.equal(await claim(),null,'re-subscription cannot retry immediately');
  const alternate=await register(1,11,hashes[2],'e'.repeat(64));assert(await claim(id(701),alternate),'separate opted-in device has independent cooldown');
  // A delayed webhook may arrive after the catalog-based reservation. Its first
  // valid timestamp must align both the alert and the existing acceptance RPC.
  await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'Other broker','other broker','fixture','broker',true,'other@example.test','other@example.test')",[id(12),id(1)]);
  const priorityFixture=async(n,company=1)=>{
   await db.query("INSERT INTO leads(id,company_id,name,phone,assigned_to) VALUES($1,$2,'Synthetic delayed intake',$3,NULL)",[id(n),id(company),'000'+n]);
   await db.query("INSERT INTO conversations(id,company_id,lead_id,status) VALUES($1,$2,$3,'Aberta')",[id(n+100),id(company),id(n)]);
   await db.query("INSERT INTO lead_duty_priorities(company_id,lead_id,broker_ids,created_at,preferred_until) VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '5 minutes')",[id(company),id(n),[id(company*10+1)]]);
  };
  const priorityFor=async n=>(await db.query('SELECT * FROM lead_duty_priorities WHERE lead_id=$1',[id(n)])).rows[0];
  await priorityFixture(9100);
  const delayedBefore=await priorityFor(9100);
  const incoming=(await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'incoming','client','Synthetic delayed webhook',clock_timestamp()-interval '4 minutes 59 seconds') RETURNING created_at",[id(9300),id(1),id(9200)])).rows[0];
  const shortened=await priorityFor(9100);
  assert.equal(shortened.preferred_until.getTime(),incoming.created_at.getTime()+300000);
  assert.deepEqual(shortened.broker_ids,[id(11)]);assert.equal(shortened.created_at.getTime(),delayedBefore.created_at.getTime());
  await assert.rejects(()=>db.query('SELECT change_conversation_owner($1,$2,$3,false)',[id(1),id(9100),id(12)]),/duty_priority_wait/,'non-duty broker cannot accept before five minutes');
  await db.query("UPDATE messages SET created_at=clock_timestamp()-interval '5 minutes' WHERE id=$1",[id(9300)]);
  assert.equal((await db.query('SELECT change_conversation_owner($1,$2,$3,false) result',[id(1),id(9100),id(12)])).rows[0].result,true,'non-duty broker can accept at first arrival+5 minutes');
  await priorityFixture(9101);await priorityFixture(9102,2);await priorityFixture(9103);
  const invalidBefore=await priorityFor(9101),otherTenantBefore=await priorityFor(9102);
  await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'incoming','client','Synthetic future',clock_timestamp()+interval '1 day')",[id(9301),id(1),id(9201)]);
  assert.equal((await priorityFor(9101)).preferred_until.getTime(),invalidBefore.preferred_until.getTime(),'future incoming cannot shorten reservation');
  for(const invalid of ['infinity','-infinity']){
   await db.query('UPDATE messages SET created_at=$1::timestamptz WHERE id=$2',[invalid,id(9301)]);
   assert.equal((await priorityFor(9101)).preferred_until.getTime(),invalidBefore.preferred_until.getTime(),'non-finite incoming cannot shorten reservation');
  }
  await db.query("UPDATE messages SET direction='outgoing',created_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[id(9301)]);
  assert.equal((await priorityFor(9101)).preferred_until.getTime(),invalidBefore.preferred_until.getTime(),'outgoing does not establish first arrival');
  await db.query("UPDATE messages SET direction='incoming' WHERE id=$1",[id(9301)]);
  const corrected=await priorityFor(9101);assert(corrected.preferred_until<invalidBefore.preferred_until,'direction correction establishes a valid arrival');
  // Inbox integrity intentionally prevents relocating its last-message row.
  // Exercise a supported correction using a historical, non-last message.
  await priorityFixture(9104);
  await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,$3,'incoming','client','Synthetic historical correction',$4),($5,$2,$3,'outgoing','ai','Synthetic newer reply',clock_timestamp())",[id(9302),id(1),id(9204),new Date(corrected.preferred_until.getTime()-300000).toISOString(),id(9303)]);
  await db.query('UPDATE messages SET conversation_id=$1 WHERE id=$2',[id(9203),id(9302)]);
  assert.equal((await priorityFor(9103)).preferred_until.getTime(),corrected.preferred_until.getTime(),'conversation correction shortens only the destination lead');
  await db.query("UPDATE messages SET created_at=clock_timestamp() WHERE id=$1",[id(9302)]);
  assert.equal((await priorityFor(9103)).preferred_until.getTime(),corrected.preferred_until.getTime(),'later correction never extends a reservation');
  assert.equal((await priorityFor(9102)).preferred_until.getTime(),otherTenantBefore.preferred_until.getTime(),'other tenant reservation is unchanged');
  await assert.rejects(()=>db.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,'incoming','client','Synthetic forged tenant',clock_timestamp()-interval '10 minutes')",[id(1),id(9202)]));
  assert.deepEqual((await priorityFor(9103)).broker_ids,[id(11)]);
  await db.query('UPDATE broker_accounts SET active=false WHERE id=$1',[id(11)]);
  assert.equal((await candidates()).length,0);assert.equal(await claim(),null,'disabled account cannot receive');
  const permissions=(await db.query("SELECT has_table_privilege('authenticated','web_push_subscriptions','SELECT') a,has_table_privilege('anon','web_push_attempts','SELECT') b,has_table_privilege('authenticated','web_push_cooldowns','SELECT') c,has_function_privilege('anon','web_push_retry_due(timestamptz,timestamptz)','EXECUTE') d,has_function_privilege('authenticated','urgent_alert_policy_version()','EXECUTE') e")).rows[0];
  assert.equal(Object.values(permissions).some(Boolean),false);
  console.log('PASS web push SQL: additive backfill, first incoming survives AI replies, exact 299999/300000ms predicate, simultaneous admission, five-minute repeat after failure, no bursts, candidate pagination, tenant/session/ownership/closure guards, re-login/device binding and service-only privileges. PGlite only; no network.');
 } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
