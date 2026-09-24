const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');

function load(file, mocks, extra = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, require: n => mocks[n] || require(n),
    Date, Buffer, AbortSignal, Response, Request, console, process: {env:{}}, ...extra });
  return mod.exports;
}

async function senderTests() {
  for (const scenario of [
    {status:200, receipt:{messages:[{id:'wamid.success'}]}, want:'sent'},
    {status:429, receipt:{error:{code:130429}}, want:'pending'},
    {status:503, receipt:{error:{code:2}}, want:'pending'},
    {status:503, receipt:{}, want:'uncertain'},
    {status:200, receipt:{}, want:'uncertain'},
    {status:401, receipt:{error:{code:190}}, want:'failed'},
    {timeout:true, want:'uncertain'},
    {lookupFailure:true, want:'pending'},
    {lookupFailure:true, attempts:3, want:'failed'},
    {status:429, receipt:{}, attempts:3, want:'failed'},
    {unclaimed:true, want:null},
    {unmarked:true, want:null},
    {status:200, receipt:{messages:[{id:'wamid.success'}]}, persistenceFailure:true, want:'sent'},
  ]) {
    let posts=0, saves=0; const writes=[];
    const db=async(p,o)=>{
      if(p==='rpc/claim_outbox_message_v2') return !scenario.unclaimed;
      if(p==='rpc/mark_outbox_provider_attempt') return !scenario.unmarked;
      if(p==='rpc/finish_outbox_attempt') { saves++; if(scenario.persistenceFailure && saves===1) throw Error('transient'); writes.push(o.body); return true; }
      if(p.startsWith('message_outbox?')) return [{conversation_id:id(501),attempts:scenario.attempts||1,template_payload:null}];
      if(p.startsWith('messages?')) { if(scenario.lookupFailure) throw Error('temporary db outage'); return [{content:'Fixture only'}]; }
      if(p.startsWith('conversations?')) return [{external_conversation_id:'whatsapp:5535999990001',phone_number_id:'12345'}];
      throw Error(p);
    };
    const api=load('lib/message-outbox.ts', {'./supabase':{supabaseServiceRequest:db}, './meta-whatsapp-connections':{
      loadMetaWhatsAppConnectionForCompany:async()=>[{enabled:true,phoneNumberId:'12345',apiVersion:'v26.0',accessToken:'fixture'}],
    }}, {fetch:async()=>{posts++; if(scenario.timeout) throw Error('timeout'); return {ok:scenario.status===200,status:scenario.status,json:async()=>scenario.receipt};}});
    await api.sendQueuedMessage(id(1),id(701));
    assert.equal(writes.at(-1)?.p_state||null,scenario.want,JSON.stringify(scenario));
    assert.equal(posts,scenario.lookupFailure||scenario.unclaimed||scenario.unmarked?0:1);
    if(scenario.want==='pending') assert.ok(Date.parse(writes[0].p_retry_at)>Date.now());
    if(scenario.persistenceFailure) assert.equal(saves,2);
  }
  let calls=0;
  const api=load('app/api/automations/recover/route.ts', {'../../../../lib/inbound-recovery':{recoverInboundReply:async()=>({processed:0,failed:0})},'../../../../lib/message-outbox':{recoverMessageOutbox:async()=>{calls++;return {processed:0,failed:0,recovered:0,remaining:0};}}}, {process:{env:{MESSAGE_RECOVERY_SECRET:'x'.repeat(48)}}});
  for(const auth of ['', 'Bearer wrong', `Bearer ${'é'.repeat(48)}`]) {
    assert.equal((await api.POST(new Request('https://example.test/api/automations/recover',{method:'POST',headers:{authorization:auth}}))).status,401);
  }
  assert.equal(calls,0);
  assert.equal((await api.POST(new Request('https://example.test/api/automations/recover',{method:'POST',headers:{authorization:`Bearer ${'x'.repeat(48)}`}}))).status,200);
  assert.equal(calls,1);
}

async function sqlTests() {
  const db=await createDatabase();
  try {
    await db.exec(migration('20260912221000_message_recovery.sql'));
    await seedCompanies(db);
    await db.query('SELECT change_conversation_owner($1,$2,$3,false)',[id(1),id(101),id(11)]);
    const enqueue=async key=>(await db.query('SELECT enqueue_conversation_message($1,$2,$3,$4,$5) id',[id(1),id(501),key,'Fixture only',id(11)])).rows[0].id;
    const call=async(name,args)=> (await db.query(`SELECT ${name === 'claim_outbox_message' ? 'claim_outbox_message_v2' : name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) ok`,args)).rows[0].ok;
    const row=async key=>(await db.query('SELECT o.*,m.delivery_status,m.external_message_id FROM message_outbox o JOIN messages m ON m.id=o.id WHERE o.id=$1',[key])).rows[0];
    const first=await enqueue('retry');
    assert.equal(await call('claim_outbox_message',[id(1),first]),true);
    assert.equal(await call('claim_outbox_message',[id(1),first]),false,'concurrent claimant cannot send');
    assert.equal(await call('mark_outbox_provider_attempt',[id(2),first,1]),false);
    assert.equal(await call('mark_outbox_provider_attempt',[id(1),first,1]),true);
    assert.equal(await call('mark_outbox_provider_attempt',[id(1),first,1]),false,'provider is attempted once per lease');
    const retryAt=new Date(Date.now()+120000).toISOString();
    assert.equal(await call('finish_outbox_attempt',[id(1),first,1,'pending',130429,null,retryAt]),true);
    assert.equal((await row(first)).delivery_status,'pending');
    assert.equal(await call('claim_outbox_message',[id(1),first]),false,'backoff observed');
    await db.query("UPDATE message_outbox SET next_attempt_at=now()-interval '1 minute' WHERE id=$1",[first]);
    assert.equal(await call('claim_outbox_message',[id(1),first]),true);
    assert.equal((await row(first)).provider_attempted_at,null,'new lease clears previous attempt marker');
    assert.equal(await call('finish_outbox_attempt',[id(1),first,1,'sent',null,'wamid.old',null]),false,'old receipt cannot overwrite a new attempt');
    assert.equal(await call('mark_outbox_provider_attempt',[id(1),first,2]),true);
    assert.equal(await call('finish_outbox_attempt',[id(2),first,2,'sent',null,'wamid.foreign',null]),false);
    assert.equal(await call('finish_outbox_attempt',[id(1),first,2,'sent',null,'wamid.receipt',null]),true);
    assert.equal(await call('finish_outbox_attempt',[id(1),first,2,'sent',null,'wamid.receipt',null]),true,'receipt persistence idempotent');
    assert.equal((await row(first)).external_message_id,'wamid.receipt');
    const safe=await enqueue('crash-before-provider');
    await call('claim_outbox_message',[id(1),safe]);
    await db.query("UPDATE message_outbox SET updated_at=now()-interval '3 minutes' WHERE id=$1",[safe]);
    assert.equal(await call('recover_stale_outbox',[id(2)]),0);
    assert.equal(await call('recover_stale_outbox',[id(1)]),1);
    assert.equal((await row(safe)).state,'pending');
    const ambiguous=await enqueue('crash-after-provider');
    await call('claim_outbox_message',[id(1),ambiguous]);
    await call('mark_outbox_provider_attempt',[id(1),ambiguous,1]);
    await db.query("UPDATE message_outbox SET updated_at=now()-interval '3 minutes' WHERE id=$1",[ambiguous]);
    assert.equal(await call('recover_stale_outbox',[null]),1);
    assert.equal((await row(ambiguous)).state,'uncertain');
    assert.equal(await call('claim_outbox_message',[id(1),ambiguous]),false,'ambiguous outcome never resent');
    assert.equal(await call('finish_outbox_attempt',[id(1),ambiguous,1,'sent',null,'wamid.late',null]),true);
    // A human taking over cancels pending bot work through the existing RPC.
    await db.query('SELECT change_conversation_owner($1,$2,$3,true)',[id(1),id(101),id(11)]);
    assert.equal((await row(safe)).state,'cancelled');
    assert.equal(await call('claim_outbox_message',[id(1),safe]),false);
    await db.query('SELECT change_conversation_owner($1,$2,$3,false)',[id(1),id(101),id(11)]);
    const legacy=await enqueue('legacy-worker-during-rollout');
    await db.query('SELECT claim_outbox_message($1,$2)',[id(1),legacy]);
    assert.ok((await row(legacy)).provider_attempted_at,'legacy claim must be treated conservatively');
    await db.query("UPDATE message_outbox SET updated_at=now()-interval '3 minutes' WHERE id=$1",[legacy]);
    await call('recover_stale_outbox',[null]);
    assert.equal((await row(legacy)).state,'uncertain','legacy crash cannot cause duplicate delivery');
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(()=>call('recover_stale_outbox',[null]),e=>e.code==='42501');
      await assert.rejects(()=>call('mark_outbox_provider_attempt',[id(1),safe,1]),e=>e.code==='42501');
      await assert.rejects(()=>call('finish_outbox_attempt',[id(1),safe,1,'sent',null,'attack',null]),e=>e.code==='42501');
      await db.exec('RESET ROLE');
    }
  } finally {await db.close();}
}
(async()=>{await senderTests();await sqlTests();console.log('PASS recovery: auth, bounded retries, atomic receipts, tenant guards, stale leases, ambiguous outcomes and duplicate prevention');})().catch(e=>{console.error(e);process.exitCode=1;});
