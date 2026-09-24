const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(file){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,Date});return mod.exports;}
async function main(){
 const {buildPerformance,performanceBrokerId}=load('performance-metrics.ts');
 const brokers=[{id:id(11),name:'Zélia atual',active:true},{id:id(12),name:'Ana',active:true}];
 const aliases=[{broker_id:id(11),name:'Zélia antiga'},{broker_id:id(12),name:'Duplicado'},{broker_id:id(11),name:'Duplicado'}];
 assert.equal(performanceBrokerId('Duplicado',brokers,aliases),undefined,'ambiguous names must not merge accounts');
 const report=buildPerformance({month:'2026-09',companyGoal:500000,brokers,aliases,goals:[{broker:'Zélia antiga',goal:100000},{broker:`id:${id(11)}`,goal:200000}],sales:[
  {id:'s',date:'2026-09-10',broker:'Zélia antiga',property:'Casa',client:'Cliente',amount:100000,createdAt:'2026-09-10T12:00:00Z'},
  {id:'r',date:'2026-09-10',broker:'Ana',property:'Apto',client:'Cliente',amount:2000,dealType:'Aluguel',createdAt:'2026-09-10T12:00:00Z'}],
  metrics:[{broker_id:null,leads_received:2,converted_leads:3,recovered_leads:1,cohort_converted:1,visits:4},{broker_id:id(11),leads_received:2,converted_leads:3,recovered_leads:1,cohort_converted:1,visits:4}],trackingStartedAt:'2026-09-01T12:00:00Z'});
 assert.equal(report.totalSold,100000);assert.equal(report.salesCount,1);assert.equal(report.conversionRate,50,'cohort rate cannot be inflated by old leads converting now');
 assert.equal(report.convertedLeads,3);assert.equal(report.brokers[0].brokerId,id(11));assert.equal(report.brokers[0].goal,200000,'stable goal takes precedence');
 assert.equal(report.history.length,6);assert.equal(report.history[0].month,'2026-04');assert.equal(report.sales[0].broker,'Zélia atual');

 const db=await PGlite.create();
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE companies(id uuid PRIMARY KEY);
 CREATE TABLE broker_accounts(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),name text,role text,active boolean,UNIQUE(company_id,id));
 CREATE TABLE leads(id uuid PRIMARY KEY,company_id uuid,name text,assigned_to text,lifecycle_status text,created_at timestamptz DEFAULT now(),last_contact_at timestamptz);
 CREATE TABLE appointments(id uuid PRIMARY KEY,company_id uuid,assigned_to text,scheduled_at timestamptz,status text);
 CREATE TABLE conversations(id uuid PRIMARY KEY,company_id uuid,lead_id uuid,assigned_broker_id uuid);
 CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,conversation_id uuid,direction text,sender_type text,created_at timestamptz DEFAULT now());
 CREATE TABLE properties(id uuid PRIMARY KEY,company_id uuid,title text,status text,purpose text);
 CREATE FUNCTION public.match_normalize(t text) RETURNS text LANGUAGE SQL IMMUTABLE AS $$ SELECT lower(translate(btrim(t),'í','i')) $$;
 INSERT INTO companies VALUES('${id(1)}'),('${id(2)}');
 INSERT INTO broker_accounts VALUES('${id(11)}','${id(1)}','Zélia antiga','owner',true),('${id(12)}','${id(1)}','Ana','broker',true),('${id(21)}','${id(2)}','Outro','owner',true);
 INSERT INTO leads VALUES('${id(101)}','${id(1)}','Lead A','Ana','Novo',now()-interval '65 days',NULL),('${id(201)}','${id(2)}','Lead B','Outro','Novo',now(),NULL);
 INSERT INTO properties VALUES('${id(301)}','${id(1)}','Casa','Disponível','Venda'),('${id(302)}','${id(1)}','Apto','Reservado','Aluguel'),('${id(401)}','${id(2)}','Outra','Disponível','Venda');
 INSERT INTO conversations VALUES('${id(501)}','${id(1)}','${id(101)}','${id(12)}');`);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20260924100000_crm_performance_and_deals.sql'),'utf8'));
 const scalar=async(q,params=[]) => (await db.query(q,params)).rows[0].value;
 const deal=async(property=301,broker=12,lead=101,kind='Venda',actor=11)=>scalar('SELECT record_property_deal($1,$2,$3,$4,$5,current_date,100000,$6,$7) value',[id(1),id(actor),id(property),id(broker),id(lead),kind,'Cliente']);
 assert.equal(await scalar(`SELECT assigned_broker_id value FROM leads WHERE id='${id(101)}'`),id(12));
 await db.exec(`UPDATE broker_accounts SET name='Zélia atual' WHERE id='${id(11)}'`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM broker_name_history WHERE broker_id='${id(11)}'`),2);
 await assert.rejects(()=>deal(401),/property_not_found/);await assert.rejects(()=>deal(301,21),/deal_forbidden/);await assert.rejects(()=>deal(301,12,201),/lead_not_found/);
 await assert.rejects(()=>deal(301,11,101,'Venda',12),/deal_forbidden/);
 const d1=await deal();assert.equal(d1.broker_id,id(12));
 assert.equal(await scalar(`SELECT lifecycle_status value FROM leads WHERE id='${id(101)}'`),'Convertido','linked deal closes lead in the same transaction');
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE kind='converted'`),0,'automatic deal must not create a permanent manual-conversion event');
 assert.equal(await scalar(`SELECT status value FROM properties WHERE id='${id(301)}'`),'Vendido');
 await assert.rejects(()=>deal(),/property_unavailable/);
 const cancel=dealId=>scalar('SELECT cancel_property_deal($1,$2,$3) value',[id(1),id(11),dealId]);
 await assert.rejects(()=>scalar('SELECT cancel_property_deal($1,$2,$3) value',[id(1),id(12),d1.id]),/deal_forbidden/);
 assert.equal((await cancel(d1.id)).propertyRestored,true);assert.equal(await scalar(`SELECT status value FROM properties WHERE id='${id(301)}'`),'Disponível');
 assert.equal(await scalar(`SELECT lifecycle_status value FROM leads WHERE id='${id(101)}'`),'Novo','final cancellation restores unchanged original pipeline stage');
 assert.equal(await scalar('SELECT count(*)::int value FROM property_deals'),1,'cancel preserves audit record');
 assert.equal((await cancel(d1.id)).alreadyCancelled,true);
 const d2=await deal();await db.exec(`UPDATE properties SET status='Reservado' WHERE id='${id(301)}'`);const d3=await deal();
 assert.equal((await cancel(d2.id)).propertyRestored,false,'cancelling older deal cannot reopen newer deal');
 assert.equal(await scalar(`SELECT last_deal_id value FROM properties WHERE id='${id(301)}'`),d3.id);
 assert.equal((await cancel(d3.id)).propertyRestored,true);assert.equal(await scalar(`SELECT status value FROM properties WHERE id='${id(301)}'`),'Reservado');
 const rent=await deal(302,12,101,'Aluguel');assert.equal(rent.deal_type,'Aluguel');await cancel(rent.id);
 assert.equal(await scalar(`SELECT status value FROM properties WHERE id='${id(302)}'`),'Reservado');
 await db.exec(`INSERT INTO messages(company_id,conversation_id,direction,sender_type,created_at) VALUES('${id(1)}','${id(501)}','incoming','client',now()-interval '31 days');
 INSERT INTO messages(company_id,conversation_id,direction,sender_type) VALUES('${id(1)}','${id(501)}','outgoing','broker');`);
 let before=await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE kind='recovered'`);
 await db.exec(`INSERT INTO messages(company_id,conversation_id,direction,sender_type) VALUES('${id(1)}','${id(501)}','incoming','client');`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE kind='recovered'`),before+1,'only inbound client recovery counts');
 await db.exec(`INSERT INTO messages(company_id,conversation_id,direction,sender_type) VALUES('${id(1)}','${id(501)}','incoming','client');`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE kind='recovered'`),before+1,'same-day reply not another recovery');
 await db.exec(`UPDATE leads SET lifecycle_status='Convertido' WHERE id='${id(101)}';UPDATE leads SET name='Editado' WHERE id='${id(101)}';`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE kind='converted'`),1,'profile edits do not create conversion events');
 await db.exec(`INSERT INTO leads(id,company_id,name,assigned_to,lifecycle_status) VALUES('${id(104)}','${id(1)}','Conversão histórica importada','Ana','Convertido');`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE lead_id='${id(104)}' AND kind='converted'`),0,'import must not guess a historical conversion date');
 const month=await scalar(`SELECT to_char(now() AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') value`);
 const metrics=await scalar('SELECT performance_crm_month($1,$2,$3) value',[id(1),id(11),month]);
 assert.equal(metrics.metrics.find(m=>m.broker_id===null).converted_leads,1);assert.equal(metrics.metrics.find(m=>m.broker_id===null).recovered_leads,1);
 await db.exec(`INSERT INTO leads(id,company_id,name,assigned_to,lifecycle_status,created_at,last_contact_at) VALUES('${id(103)}','${id(1)}','Importado inativo','Ana','Novo',now(),now()-interval '40 days');
 INSERT INTO conversations VALUES('${id(503)}','${id(1)}','${id(103)}','${id(12)}');
 INSERT INTO messages(company_id,conversation_id,direction,sender_type) VALUES('${id(1)}','${id(503)}','incoming','client');`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE lead_id='${id(103)}' AND kind='recovered'`),1,'imported lead uses known prior contact instead of new import date');
 await db.exec(`INSERT INTO crm_metric_events(company_id,lead_id,broker_id,kind,occurred_at,source_key) VALUES
 ('${id(1)}','${id(901)}','${id(12)}','received','2020-09-01T02:59:59Z','tz-before'),
 ('${id(1)}','${id(902)}','${id(12)}','received','2020-09-01T03:00:00Z','tz-start'),
 ('${id(1)}','${id(903)}','${id(12)}','received','2020-10-01T02:59:59Z','tz-last'),
 ('${id(1)}','${id(904)}','${id(12)}','received','2020-10-01T03:00:00Z','tz-after'),
 ('${id(2)}','${id(905)}','${id(21)}','received','2020-09-15T12:00:00Z','other-company'),
 ('${id(1)}','${id(902)}','${id(12)}','converted','2020-09-15T12:00:00Z','cohort-convert'),
 ('${id(1)}','${id(901)}','${id(12)}','converted','2020-09-15T12:00:00Z','previous-month-convert');`);
 const boundary=await scalar('SELECT performance_crm_month($1,$2,$3) value',[id(1),id(11),'2020-09']);
 const aggregate=boundary.metrics.find(m=>m.broker_id===null);
 assert.equal(aggregate.leads_received,2);assert.equal(aggregate.converted_leads,2);assert.equal(aggregate.cohort_converted,1,'Sao Paulo month boundaries and cohort conversion separate old leads');
 await assert.rejects(()=>scalar('SELECT performance_crm_month($1,$2,$3) value',[id(2),id(11),month]),/performance_forbidden/);
 await db.exec(`INSERT INTO leads(id,company_id,name,assigned_to,lifecycle_status,created_at) VALUES('${id(105)}','${id(1)}','Multiplos negócios','Ana','Proposta',now()-interval '60 days');
 INSERT INTO properties VALUES('${id(305)}','${id(1)}','Casa A','Disponível','Venda',NULL),('${id(306)}','${id(1)}','Casa B','Disponível','Venda',NULL);
 INSERT INTO conversations VALUES('${id(505)}','${id(1)}','${id(105)}','${id(12)}');`);
 const stage=()=>scalar(`SELECT lifecycle_status value FROM leads WHERE id='${id(105)}'`);
 const marker=()=>scalar(`SELECT last_deal_id value FROM leads WHERE id='${id(105)}'`);
 const closeA=()=>deal(305,12,105);const closeB=()=>deal(306,12,105);
 const a=await closeA(),b=await closeB();
 assert.equal(a.previous_lead_status,'Proposta');assert.equal(b.previous_lead_status,'Convertido');
 assert.equal(await scalar(`SELECT count(*)::int value FROM leads WHERE id='${id(105)}' AND lifecycle_status NOT IN ('Convertido','Perdido')`),0,'closed lead is excluded from reactivation candidate predicates');
 await db.exec(`INSERT INTO messages(company_id,conversation_id,direction,sender_type) VALUES('${id(1)}','${id(505)}','incoming','client');`);
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE lead_id='${id(105)}' AND kind='recovered'`),0,'sold lead must not count as recovered');
 await cancel(a.id);assert.equal(await stage(),'Convertido');assert.equal(await marker(),b.id);
 await cancel(b.id);assert.equal(await stage(),'Proposta');assert.equal(await marker(),null,'older then newer cancellation restores baseline');
 const c=await closeA(),d=await closeB();await cancel(d.id);
 assert.equal(await stage(),'Convertido');assert.equal(await marker(),c.id,'newer cancelled transfers ownership to remaining deal');
 await cancel(c.id);assert.equal(await stage(),'Proposta','newer then older cancellation also restores baseline');
 const e=await closeA();await db.exec(`UPDATE leads SET lifecycle_status='Em atendimento' WHERE id='${id(105)}'`);
 assert.equal(await marker(),null);await cancel(e.id);assert.equal(await stage(),'Em atendimento','later manual stage wins over cancellation');
 const f=await closeA();await db.exec(`UPDATE leads SET lifecycle_status='Visita' WHERE id='${id(105)}'`);const g=await closeB();
 await cancel(g.id);assert.equal(await marker(),f.id);await cancel(f.id);assert.equal(await stage(),'Visita','new baseline survives transfer to older active deal');
 await db.exec(`UPDATE leads SET lifecycle_status='Convertido' WHERE id='${id(105)}'`);const h=await closeA();await cancel(h.id);
 assert.equal(await stage(),'Convertido','independent manual conversion is not undone');
 assert.equal(await scalar(`SELECT count(*)::int value FROM crm_metric_events WHERE lead_id='${id(105)}' AND kind='converted'`),1,'all automatic closing/reopening leaves only the independent manual event');
 for(const role of ['anon','authenticated']) assert.equal(await scalar(`SELECT has_function_privilege('${role}','public.record_property_deal(uuid,uuid,uuid,uuid,uuid,date,numeric,text,text)','EXECUTE') value`),false);
 console.log('PASS CRM SQL: atomic property deals, tenant/actor isolation, safe cancellation/retry/newer-deal protection, preserved history, rename aliases, genuine inbound recovery and automatic conversions.');
 } finally {await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
