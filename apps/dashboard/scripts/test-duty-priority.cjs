const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDatabase,seedCompanies,id,migration,isolationMigration}=require('./helpers/tenant-test-database.cjs');
(async()=>{
 const db=await createDatabase();
 try {
  for(const file of fs.readdirSync(path.resolve(__dirname,'../../../supabase/migrations')).filter(file=>file.endsWith('.sql')&&file>isolationMigration).sort())await db.exec(migration(file));
  await seedCompanies(db);
  for(const n of [12,13])await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$3,'fixture','broker',true,$4,$4)",[id(n),id(1),'Plantonista fictício '+n,n+'@example.test']);
  const start=new Date(Date.now()-3600000).toISOString(),end=new Date(Date.now()+3600000).toISOString();
  const document={companyId:id(1),version:1,records:[{id:'shift-sale',kind:'shifts',data:{assignedTo:id(12),purpose:'Venda',startsAt:start,endsAt:end,status:'Ativo'}}],events:[],members:[],settings:{operations:{dutyPriorityEnabled:false}}};
  await db.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2::jsonb,$3)',[id(1),JSON.stringify(document),id(11)]);
  assert.deepEqual((await db.query('SELECT crm_operational_rules_ready($1,$2) result',[id(1),id(11)])).rows[0].result,{dutyPriority:true,inactivePool:true});
  await assert.rejects(()=>db.query('SELECT crm_operational_rules_ready($1,$2)',[id(1),id(21)]),/owner_required/);
  const saveSettings=()=>db.query('UPDATE crm_evolution_workspaces SET document=$1::jsonb WHERE company_id=$2',[JSON.stringify(document),id(1)]);
  const intake=async(n,goal='Comprar',assignee=null)=>{
   await db.query("INSERT INTO leads(id,company_id,name,phone,goal,assigned_to) VALUES($1,$2,'Lead fictício de plantão',$3,$4,$5)",[id(n),id(1),'5535999'+n,goal,assignee]);
   await db.query("INSERT INTO conversations(id,company_id,lead_id,channel,status) VALUES($1,$2,$3,'WhatsApp','Aberta')",[id(n+100),id(1),id(n)]);
   await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content) VALUES($1,$2,$3,'incoming','client','Mensagem fictícia')",[id(n+200),id(1),id(n+100)]);
  };
  const claim=async(n,broker,release=false,company=1)=>(await db.query('SELECT change_conversation_owner($1,$2,$3,$4) result',[id(company),id(n),id(broker),release])).rows[0].result;
  const inbox=async(n,broker)=>(await db.query('SELECT get_conversation_inbox($1,$2,$3) result',[id(1),id(broker),id(n)])).rows[0].result[0];
  await intake(1500);assert.equal((await db.query('SELECT count(*)::int n FROM lead_duty_priorities')).rows[0].n,0,'default off');
  document.settings.operations.dutyPriorityEnabled=true;await saveSettings();await intake(1501);
  const priority=(await db.query('SELECT broker_ids,extract(epoch from preferred_until-created_at)::int duration FROM lead_duty_priorities WHERE lead_id=$1',[id(1501)])).rows[0];
  assert.deepEqual(priority.broker_ids,[id(12)]);assert.equal(priority.duration,300);
  assert.equal((await inbox(1501,12)).dutyPreferred,true);assert.equal((await inbox(1501,13)).dutyPreferred,false);
  assert((await inbox(1501,13)).dutyPriorityUntil);
  await assert.rejects(()=>claim(1501,13),/duty_priority_wait/);
  assert.equal((await db.query('SELECT assigned_broker_id FROM conversations WHERE id=$1',[id(1601)])).rows[0].assigned_broker_id,null,'rejected claim leaves assignment untouched');
  assert.equal(await claim(1501,21),false,'another company cannot accept');
  assert.equal(await claim(1501,12,false,2),false,'forged company cannot locate target');
  assert.equal(await claim(1501,12),true);assert.equal(await claim(1501,13),false,'first claimant retains ownership');
  assert.equal((await inbox(1501,13)).dutyPriorityUntil,null,'already accepted lead is not deferred');
  assert.equal(await claim(1501,12,true),true);await assert.rejects(()=>claim(1501,13),/duty_priority_wait/);
  await db.query('UPDATE lead_duty_priorities SET preferred_until=now() WHERE lead_id=$1',[id(1501)]);
  assert.equal(await claim(1501,13),true,'at five-minute boundary any active broker may accept');
  await intake(1502,'Alugar');assert.equal((await inbox(1502,13)).dutyPriorityUntil,null,'no compatible duty broker means no waiting');
  assert.equal(await claim(1502,13),true);
  await intake(1503,'Comprar','Dono 1');assert.equal((await inbox(1503,13)).dutyPriorityUntil,null,'preassigned intake preserved');
  await intake(1504);document.records=[];await saveSettings();
  await assert.rejects(()=>claim(1504,13),/duty_priority_wait/,'roster snapshot cannot be bypassed by deleting shift');
  document.settings.operations.dutyPriorityEnabled=false;await saveSettings();assert.equal(await claim(1504,13),true,'explicit policy disable releases wait');
  document.settings.operations.dutyPriorityEnabled=true;document.records=[{id:'invalid-shift',kind:'shifts',data:{assignedTo:id(12),purpose:'Venda',startsAt:'not-a-date',endsAt:end,status:'Ativo'}}];await saveSettings();
  await intake(1505);assert.equal((await inbox(1505,12)).dutyPriorityUntil,null,'invalid old shift does not discard incoming contact');
  const privileges=(await db.query("SELECT has_table_privilege('authenticated','lead_duty_priorities','SELECT') a,has_function_privilege('anon','change_conversation_owner(uuid,uuid,uuid,boolean)','EXECUTE') b")).rows[0];assert.equal(privileges.a||privileges.b,false);
  console.log('PASS duty priority: opt-in, 5-minute immutable roster, specialization/no-duty fallback, authenticated tenant, first-claim ownership, exact expiry, disabling, invalid legacy schedule and denied browser grants. Synthetic SQL only.');
 } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
