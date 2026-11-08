// Synthetic local SQL only. No network or messages sent to real clients.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
(async () => {
  const db = await createDatabase();
  try {
    for (const file of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations')).filter(file => file.endsWith('.sql') && file > isolationMigration).sort()) await db.exec(migration(file));
    await seedCompanies(db);
    const started = new Date(Date.now() - 3600000).toISOString(), ended = new Date(Date.now() - 1800000).toISOString();
    const overlay = (n, company = 1) => ({ id: `appointment:${id(n)}`, kind: 'tasks', createdBy: id(company * 10 + 1), legacy: { table: 'appointments', id: id(n), access: 'assigned', assignedTo: id(company * 10 + 1) }, data: { visitStartedAt: started, visitEndedAt: ended, visitPersonId: `person:${id(company * 100 + 1)}`, visitBrokerId: id(company * 10 + 1) } });
    await db.query("UPDATE appointments SET status='Realizada',assigned_to='Dono 1' WHERE company_id=$1", [id(1)]);
    await db.query("INSERT INTO properties(id,company_id,title,purpose) VALUES($1,$2,'Segundo imóvel sintético','Venda')", [id(302), id(1)]);
    for (const [visit, property] of [[902,301],[903,302]]) await db.query("INSERT INTO appointments(id,company_id,lead_id,property_id,scheduled_at,status,assigned_to) VALUES($1,$2,$3,$4,now(),'Realizada','Dono 1')", [id(visit),id(1),id(101),id(property)]);
    const document = { companyId:id(1), version:1, records:[overlay(901),overlay(902),overlay(903)], events:[], settings:{}, members:[] };
    await db.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2,$3)',[id(1),JSON.stringify(document),id(11)]);
    await db.exec('SET ROLE service_role');
    const ensure = (visit, property = 301, actor = 11, company = 1, lead = 101, hash = 'a'.repeat(64), request = 3001) => db.query('SELECT ensure_visit_feedback_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[id(company),id(actor),id(request),`case:${id(lead)}`,`property:${id(property)}`,id(lead),'Untrusted title ignored','Venda',hash,`appointment:${id(visit)}`]);
    const first = (await ensure(901)).rows[0].result;
    assert.equal(first.property_name,'Imóvel 1','title comes from canonical property');
    assert.equal(first.person_key,`person:${id(101)}`); assert.equal(first.visit_broker_id,id(11));
    assert.equal(Date.parse(first.visit_started_at),Date.parse(started)); assert.equal(Date.parse(first.visit_ended_at),Date.parse(ended));
    assert.equal((await ensure(901,301,11,1,101,'b'.repeat(64),3002)).rows[0].result.id,first.id,'same visit preserves original token');
    const repeat = (await ensure(902,301,11,1,101,'c'.repeat(64),3003)).rows[0].result;
    assert.notEqual(repeat.id,first.id,'second visit to same property gets a distinct request');
    const another = (await ensure(903,302,11,1,101,'d'.repeat(64),3004)).rows[0].result;
    assert.equal(another.property_key,`property:${id(302)}`,'visit property wins over case property');
    await assert.rejects(()=>ensure(901,302),/feedback_visit_mismatch/,'cannot swap property');
    await assert.rejects(()=>ensure(901,301,11,1,201),/feedback_visit_mismatch/,'cannot swap customer');
    await assert.rejects(()=>ensure(901,301,21),/feedback_forbidden/,'foreign actor denied');
    await assert.rejects(()=>ensure(901,301,21,2,201),/feedback_visit_mismatch/,'foreign visit denied');
    assert.equal((await db.query('SELECT count(*)::int n FROM message_outbox')).rows[0].n,0,'creating links never enqueues messages');
    const submit = (hash, score = 5) => db.query('SELECT submit_property_feedback($1,NULL,$2,NULL,NULL) result',[hash,score]);
    assert.equal((await submit('a'.repeat(64),0)).rows[0].result,false);
    assert.equal((await submit('a'.repeat(64))).rows[0].result,true,'only property stars required');
    assert.equal((await submit('a'.repeat(64),1)).rows[0].result,false,'response immutable');
    const legacy = (await db.query('SELECT ensure_property_feedback_request($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[id(1),id(11),id(3005),`case:${id(101)}`,`property:${id(301)}`,id(101),'Old property link','Venda','e'.repeat(64)])).rows[0].result;
    assert.equal(legacy.visit_key,null,'historical per-case link coexists with exact visits');
    assert.equal((await submit('e'.repeat(64))).rows[0].result,true,'old links remain answerable');
    await db.exec('RESET ROLE');
    const nativeCase=id(105),nativeProperty=id(307),nativeVisit=id(906);
    document.records.push(
      {id:nativeCase,kind:'cases',data:{personId:`person:${id(101)}`,leadId:`lead:${id(101)}`,assignedTo:id(11)}},
      {id:nativeProperty,kind:'properties',data:{name:'Native property',purpose:'Venda'}},
      {id:nativeVisit,kind:'tasks',data:{caseId:nativeCase,propertyId:nativeProperty,type:'Visita',status:'Realizada',visitPersonId:`person:${id(101)}`,visitBrokerId:id(11),visitStartedAt:started,visitEndedAt:ended}},
    );
    await db.query('UPDATE crm_evolution_workspaces SET document=$2 WHERE company_id=$1',[id(1),JSON.stringify(document)]);
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'Visit Broker','visit broker','scrypt-v1$fixture','broker',true,'visit@example.test','visit@example.test')",[id(12),id(1)]);
    await db.query("UPDATE leads SET assigned_to='Visit Broker' WHERE id=$1",[id(101)]);
    await db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Visit Broker' WHERE company_id=$2 AND lead_id=$3",[id(12),id(1),id(101)]);
    await db.exec('SET ROLE service_role');
    assert.equal((await ensure(901,301,12)).rows[0].result.id,first.id,'current portfolio can retrieve completed visit');
    const nativeEnsure=lead=>db.query('SELECT ensure_visit_feedback_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[id(1),id(11),id(3006),nativeCase,nativeProperty,lead,'ignored','Venda','f'.repeat(64),nativeVisit]);
    await assert.rejects(()=>nativeEnsure(null),/feedback_visit_mismatch/,'cannot omit canonical customer to bypass portfolio validation');
    assert.equal((await nativeEnsure(id(101))).rows[0].result.lead_id,id(101),'native case preserves canonical customer binding');
    await db.exec('RESET ROLE');
    await db.query("UPDATE leads SET assigned_to='Dono 1' WHERE id=$1",[id(101)]);
    await db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Dono 1' WHERE company_id=$2 AND lead_id=$3",[id(11),id(1),id(101)]);
    await db.exec('SET ROLE service_role');
    await assert.rejects(()=>ensure(901,301,12),/feedback_forbidden/,'old portfolio cannot retrieve visit after reassignment');
    for(const role of ['anon','authenticated']) {
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(()=>ensure(901),e=>e.code==='42501');
      await assert.rejects(()=>db.query('SELECT * FROM property_feedback_requests'),e=>e.code==='42501');
      await assert.rejects(()=>submit('c'.repeat(64)),e=>e.code==='42501');
    }
    console.log('PASS exact visit feedback SQL: canonical overlays and native cases, reassignment, multiple visits/properties, tenant/client bindings, single response, legacy links, no outbound side effects.');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
