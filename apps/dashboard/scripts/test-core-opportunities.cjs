const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function run() {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE companies(id uuid PRIMARY KEY,name text);
      CREATE TABLE account_companies(company_id uuid PRIMARY KEY REFERENCES companies(id),name text);
      CREATE TABLE broker_accounts(id uuid PRIMARY KEY,company_id uuid REFERENCES account_companies(company_id),name text,role text,active boolean);
      CREATE TABLE leads(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),name text,phone text,goal text,property_type text,region text,budget_max numeric,bedrooms int,parking_spaces int,details text,lifecycle_status text,assigned_to text,last_contact_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
      CREATE TABLE properties(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),title text,purpose text,price numeric,district text,city text,property_type text,bedrooms int,parking_spaces int,status text,created_at timestamptz default now(),updated_at timestamptz default now());
      CREATE TABLE conversations(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),lead_id uuid REFERENCES leads(id),channel text,external_conversation_id text,status text,assigned_to text,last_message_at timestamptz);
      CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid REFERENCES companies(id),conversation_id uuid REFERENCES conversations(id),direction text,sender_type text,content text,external_message_id text,created_at timestamptz default now());
      CREATE TABLE lead_property_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,lead_id uuid,property_id uuid,event_type text);
      INSERT INTO companies VALUES('${id(1)}','A'),('${id(2)}','B'); INSERT INTO account_companies VALUES('${id(1)}','A'),('${id(2)}','B');
      INSERT INTO broker_accounts VALUES('${id(11)}','${id(1)}','Ana','owner',true),('${id(12)}','${id(1)}','Beto','broker',true),('${id(21)}','${id(2)}','Caio','owner',true);
      INSERT INTO leads(id,company_id,name,phone,goal,property_type,region,budget_max,bedrooms,parking_spaces,details,lifecycle_status,assigned_to,last_contact_at) VALUES
      ('${id(101)}','${id(1)}','João','(35) 99999-9999','Comprar','Apartamento','Centro',600000,3,2,'3 quartos','Novo','Beto',now()-interval '12 days'),
      ('${id(102)}','${id(1)}','Convertido','35999999999','Comprar','Apartamento','Centro',600000,3,2,'3 quartos','Convertido','Beto',now()-interval '12 days'),
      ('${id(103)}','${id(1)}','Perdido','35999999998','Comprar','Apartamento','Centro',600000,3,2,'3 quartos','Perdido','Beto',now()-interval '12 days'),
      ('${id(201)}','${id(2)}','Outro','35999999997','Comprar','Apartamento','Centro',600000,3,2,'3 quartos','Novo','Caio',now()-interval '12 days');
      INSERT INTO properties(id,company_id,title,purpose,price,district,city,property_type,bedrooms,parking_spaces,status) VALUES
      ('${id(301)}','${id(1)}','Residencial X','Venda',570000,'Centro','Lavras','Apartamento',3,2,'Disponível'),
      ('${id(302)}','${id(1)}','Aluguel','Aluguel',3000,'Centro','Lavras','Apartamento',3,2,'Disponível'),
      ('${id(303)}','${id(1)}','Acima','Venda',700000,'Centro','Lavras','Apartamento',3,2,'Disponível'),
      ('${id(401)}','${id(2)}','Outra empresa','Venda',570000,'Centro','Lavras','Apartamento',3,2,'Disponível');`);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911033633_core_opportunities.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911033640_direct_attendance.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911033755_harden_core_opportunity_functions.sql'),'utf8'));
    await db.exec('ALTER TABLE messages ADD COLUMN media_urls jsonb');
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260911053238_pilot_conversations.sql'),'utf8'));
    await db.exec(`INSERT INTO conversations(id,company_id,lead_id,channel,external_conversation_id,status,assigned_to,last_message_at) VALUES('${id(501)}','${id(1)}','${id(101)}','WhatsApp','whatsapp:5535999999999','Aberta',null,now());
      INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,external_message_id) VALUES('${id(1)}','${id(501)}','incoming','client','Quero apartamento','wamid.in');`);
    const firstClaim=await db.query(`SELECT claim_attendance_reply('${id(1)}','${id(501)}','wamid.in','reply:wamid.in') claimed`);
    const duplicateClaim=await db.query(`SELECT claim_attendance_reply('${id(1)}','${id(501)}','wamid.in','reply:wamid.in') claimed`);
    assert.equal(firstClaim.rows[0].claimed,true); assert.equal(duplicateClaim.rows[0].claimed,false,'reply reservation deduplicates');
    await db.exec(`UPDATE conversations SET bot_paused=true WHERE id='${id(501)}';
      INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,external_message_id) VALUES('${id(1)}','${id(501)}','incoming','client','Ainda está aí?','wamid.paused');`);
    const pausedClaim=await db.query(`SELECT claim_attendance_reply('${id(1)}','${id(501)}','wamid.paused','reply:wamid.paused') claimed`);
    assert.equal(pausedClaim.rows[0].claimed,false,'human handoff pauses automatic replies');
    const leadVersion=(await db.query(`SELECT updated_at FROM leads WHERE id='${id(101)}'`)).rows[0].updated_at;
    const merged=await db.query(`SELECT merge_attendance_profile('${id(1)}','${id(101)}','${leadVersion.toISOString()}','{"bedrooms":3}'::jsonb) saved`);
    const stale=await db.query(`SELECT merge_attendance_profile('${id(1)}','${id(101)}','${leadVersion.toISOString()}','{"budgetMax":1}'::jsonb) saved`);
    assert.equal(merged.rows[0].saved,true); assert.equal(stale.rows[0].saved,false,'stale AI extraction cannot overwrite a newer profile');
    await db.exec(`UPDATE leads SET interest_profile='{"city":"Lavras","parkingSpaces":2}'::jsonb WHERE id IN ('${id(101)}','${id(102)}','${id(103)}','${id(201)}')`);
    const scored = await db.query(`SELECT * FROM score_property_match((SELECT l FROM leads l WHERE id='${id(101)}'),(SELECT p FROM properties p WHERE id='${id(301)}'))`);
    assert.equal(scored.rows[0].score,94,'strong score');
    for (const property of [301,302,303,401]) await db.query(`SELECT generate_property_opportunities('${id(1)}','${id(property)}',7)`);
    let rows=(await db.query('SELECT lead_id,property_id,match_score FROM opportunities')).rows;
    assert.deepEqual(rows,[{lead_id:id(101),property_id:id(301),match_score:94}],'tenant/purpose/budget/closed states and strong match');
    assert.equal((await db.query('SELECT count(*)::int total FROM opportunity_notifications')).rows[0].total,1,'strong matches notify once');
    await db.query(`SELECT generate_property_opportunities('${id(1)}','${id(301)}',7)`);
    assert.equal((await db.query('SELECT count(*)::int total FROM opportunities')).rows[0].total,1,'deduplication');
    const ownerA=await db.query(`SELECT list_opportunities('${id(1)}','${id(11)}',0) data`);
    const brokerA=await db.query(`SELECT list_opportunities('${id(1)}','${id(12)}',0) data`);
    const ownerB=await db.query(`SELECT list_opportunities('${id(2)}','${id(21)}',0) data`);
    assert.equal(ownerA.rows[0].data.length,1); assert.equal(brokerA.rows[0].data.length,1); assert.equal(ownerB.rows[0].data.length,0,'broker tenant isolation');
    await assert.rejects(()=>db.query(`SELECT opportunity_action('${id(2)}','${id(21)}',(SELECT id FROM opportunities),'draft')`));
    const first=await db.query(`SELECT sweep_opportunities('${id(1)}',7,25) data`); const second=await db.query(`SELECT sweep_opportunities('${id(1)}',7,25) data`);
    assert.equal(first.rows[0].data.complete,true); assert.equal(second.rows[0].data.generated,0,'daily cron idempotency');
    await db.exec(`ALTER TABLE leads ADD COLUMN source text;
      UPDATE attendance_replies SET state='uncertain'; UPDATE conversations SET bot_paused=false,assigned_to=null WHERE id='${id(501)}';`);
    const owners=await Promise.all([11,12].map(b=>db.query(`SELECT change_conversation_owner('${id(1)}','${id(101)}','${id(b)}',false) ok`)));
    assert.equal(owners.filter(r=>r.rows[0].ok).length,1,'only one broker acquires conversation');
    assert.equal((await db.query(`SELECT change_conversation_owner('${id(1)}','${id(101)}','${id(21)}',false) ok`)).rows[0].ok,false,'foreign broker denied');
    const owner=(await db.query(`SELECT assigned_broker_id FROM conversations WHERE id='${id(501)}'`)).rows[0].assigned_broker_id;
    const queued=await db.query(`SELECT enqueue_conversation_message('${id(1)}','${id(501)}','manual-test','Olá','${owner}') id`);
    const queuedAgain=await db.query(`SELECT enqueue_conversation_message('${id(1)}','${id(501)}','manual-test','Olá','${owner}') id`);
    assert.equal(queued.rows[0].id,queuedAgain.rows[0].id,'same request creates one message');
    const workers=await Promise.all([1,2].map(()=>db.query(`SELECT claim_outbox_message('${id(1)}','${queued.rows[0].id}') ok`)));
    assert.equal(workers.filter(r=>r.rows[0].ok).length,1,'only one worker sends');
    assert.equal((await db.query(`SELECT change_conversation_owner('${id(1)}','${id(101)}','${owner}',true) ok`)).rows[0].ok,false,'in-flight send prevents concurrent handoff');
    await db.exec(`UPDATE message_outbox SET state='sent' WHERE id='${queued.rows[0].id}';`);
    assert.equal((await db.query(`SELECT change_conversation_owner('${id(1)}','${id(101)}','${owner}',true) ok`)).rows[0].ok,true);
    assert.equal((await db.query(`SELECT bot_paused FROM conversations WHERE id='${id(501)}'`)).rows[0].bot_paused,false,'release resumes bot');
    await db.query(`SELECT change_conversation_owner('${id(1)}','${id(101)}','${owner}',false)`);
    await db.exec(`UPDATE messages SET created_at=now()-interval '25 hours' WHERE direction='incoming';`);
    await assert.rejects(()=>db.query(`SELECT enqueue_conversation_message('${id(1)}','${id(501)}','expired','Olá','${owner}')`),/template_required/);
    await db.exec(`INSERT INTO conversation_settings(company_id,templates) VALUES('${id(1)}','[{"name":"test_approved","language":"pt_BR","purpose":"Teste fictício","parameters":[],"approved":true}]');`);
    const template=await db.query(`SELECT enqueue_conversation_message('${id(1)}','${id(501)}','template','Modelo de teste','${owner}','test_approved') id`);
    assert.equal((await db.query(`SELECT claim_outbox_message('${id(1)}','${template.rows[0].id}') ok`)).rows[0].ok,true,'approved template works outside window');
    const inbound=()=>db.query(`SELECT receive_conversation_message('${id(1)}','5535888888888','123456','inbound-duplicate','Oi','Teste',now()) result`);
    const arrivals=await Promise.all([inbound(),inbound()]);
    assert.equal(arrivals.filter(r=>r.rows[0].result.saved).length,1,'duplicate webhook saved once');
    assert.equal((await db.query(`SELECT count(*)::int n FROM leads WHERE phone='+5535888888888'`)).rows[0].n,1,'no duplicate lead');
    await db.exec(`INSERT INTO message_delivery_events(company_id,external_message_id,status,occurred_at,error_code) VALUES('${id(1)}','status-id','failed',now(),130497),('${id(2)}','status-id','delivered',now(),null);`);
    assert.equal((await db.query(`SELECT count(*)::int n FROM message_delivery_events WHERE company_id='${id(1)}'`)).rows[0].n,1);
    await db.exec('SET ROLE anon');
    await assert.rejects(()=>db.query('SELECT * FROM message_outbox'),/permission denied/);
    await assert.rejects(()=>db.query(`SELECT change_conversation_owner('${id(1)}','${id(101)}','${owner}',false)`),/permission denied/);
    await db.exec('RESET ROLE');
    console.log('PASS pilot SQL: ownership contention, send lease, tenant isolation, deduplication, bot resume, 24h templates and privileges');
    console.log('PASS opportunities: tenant, filters, score, notification, duplicate, closed lead, event, access, bot pause and cron contracts');
  } finally { await db.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1});
