// Entire migration history plus cross-feature smoke checks, using isolated PostgreSQL only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createDatabase,seedCompanies,id,migration,isolationMigration}=require('./helpers/tenant-test-database.cjs');
(async()=>{
 const db=await createDatabase();try{
  const files=fs.readdirSync(path.resolve(__dirname,'../../../supabase/migrations')).filter(f=>f.endsWith('.sql')&&f>isolationMigration).sort();
  const names=['20261108120000_visit_feedback.sql','20261108121000_social_messaging.sql','20261108122000_website_domains.sql','20261108123000_social_ai.sql','20261108124000_meta_ads_drafts_attribution.sql','20261108125000_social_notifications.sql'];
  assert.deepEqual(files.filter(f=>names.includes(f)),names);assert.ok(files.indexOf('20261108020000_admin_conversation_control.sql')<files.indexOf(names[0]));
  for(const file of files)await db.exec(migration(file));
  await seedCompanies(db);const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  await db.exec('SET ROLE service_role');
  assert.equal(await scalar('SELECT change_conversation_owner($1,$2,$3,false)',[id(1),id(101),id(11)]),true);assert.equal(await scalar('SELECT count(*)::int FROM conversation_owner_events WHERE company_id=$1',[id(1)]),1,'recent main administrator audit survives all six migrations');
  const account=await scalar("SELECT bind_social_account($1,$2,'instagram','456','123','Synthetic','encrypted-fixture','v26.0')",[id(1),id(11)]);
  await scalar("SELECT configure_social_account($1,$2,'instagram','mode','automatic')",[id(1),id(11)]);
  const receive=()=>scalar("SELECT receive_social_message($1,$2,'7001','integrated-incoming','Quero uma casa','[]',NULL,$3)",[account,id(7001),new Date().toISOString()]);
  const incoming=await receive();assert.equal(incoming.saved,true);assert.equal((await receive()).saved,false);
  assert.equal(await scalar('SELECT notification_eligible FROM social_messages WHERE id=$1',[incoming.messageId]),true,'notification wrapper retains verified arrival');
  assert.equal(await scalar('SELECT count(*)::int FROM social_ai_jobs WHERE company_id=$1 AND message_id=$2',[id(1),incoming.messageId]),1,'notification replacement and AI trigger coexist without duplicate jobs');
  const snapshot=await scalar('SELECT social_ai_profile($1,$2)',[id(1),incoming.leadId]);
  const prepared=await scalar("SELECT prepare_social_ai_turn($1,$2,$3,'{}','Qual bairro?',false,$4)",[id(1),incoming.threadId,incoming.messageId,JSON.stringify(snapshot)]);assert.equal(prepared.ready,true);
  const queued=await scalar("SELECT enqueue_social_batch($1,$2,NULL,'integrated-ai',$3,'ai',$4)",[id(1),incoming.threadId,JSON.stringify([{content:'Qual bairro?',media:[]}]),incoming.messageId]);
  assert.ok(await scalar('SELECT claim_social_message($1,$2)',[id(1),queued[0]]),'combined grants and latest guards allow authorized AI dispatch reservation');
  assert.equal(await scalar('SELECT count(*)::int FROM messages WHERE company_id=$1',[id(1)]),1,'social flow never creates WhatsApp messages');
  const domain=await scalar("SELECT manage_website_domain($1,$2,'create','imobiliaria-fixture.example.com',NULL,NULL,$3)",[id(1),id(11),'b'.repeat(64)]);assert.ok(domain.id);assert.equal(domain.status,'pending','domain starts pending with no fake DNS/provider success');
  await assert.rejects(()=>scalar("SELECT manage_website_domain($1,$2,'create','imobiliaria-fixture.example.com',NULL,NULL,$3)",[id(2),id(21),'c'.repeat(64)]),/website_domain_reserved/);
  await db.query("INSERT INTO leads(id,company_id,name,phone,interest_profile) VALUES($1,$2,'Synthetic website contact','',$3)",[id(7002),id(1),JSON.stringify({websiteAttribution:{source:'facebook',medium:'paid',campaign:'123456',content:'987654',term:'',campaignId:'123456',adId:'987654'}})]);
  assert.equal(await scalar('SELECT campaign_id FROM lead_ad_attributions WHERE company_id=$1 AND lead_id=$2',[id(1),id(7002)]),'123456','attribution trigger survives combined migrations');
  for(const table of ['property_feedback_requests','company_website_domains','social_ai_jobs','lead_ad_attributions','social_messages'])assert.equal(await scalar('SELECT count(*)::int FROM '+table+' WHERE company_id=$1',[id(2)]),0,'no cross-company rows in '+table);
  await db.exec('RESET ROLE;SET ROLE anon');await assert.rejects(()=>db.query('SELECT * FROM social_ai_jobs'),/permission denied/);await assert.rejects(()=>db.query('SELECT * FROM company_website_domains'),/permission denied/);await db.exec('RESET ROLE');
  console.log(`PASS combined migrations: ${files.length} post-isolation migrations, recent administrator control before all six new migrations, service-role cross-feature smoke, notifications+AI job dedup, domains pending/isolation, attribution, no WhatsApp fallback and anonymous denial. No external network.`);
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exit(1);});
