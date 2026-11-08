// Real social parser/intake and versioned SQL, with only the HTTP database adapter
// replaced by an isolated PGlite connection. No credentials, network or sending.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), crypto = require('node:crypto');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
(async () => {
  const db = await createDatabase();
  try {
    for (const file of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations')).filter(file => file.endsWith('.sql') && file > isolationMigration).sort()) await db.exec(migration(file));
    await seedCompanies(db);
    const document = { companyId:id(1), version:1, records:[], events:[], members:[], settings:{operations:{inactivePoolEnabled:true}} };
    await db.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2::jsonb,$3)', [id(1), JSON.stringify(document), id(11)]);
    const calls = [];
    async function request(url, options = {}) {
      calls.push({url, method:options.method || 'GET'});
      if(url==='rpc/receive_social_message') {
        const b=options.body;
        return (await db.query('SELECT receive_social_message($1,$2,$3,$4,$5,$6,$7,$8) result',[b.p_account_id,b.p_lead_id,b.p_recipient_id,b.p_external_id,b.p_content,JSON.stringify(b.p_media),b.p_media_type,b.p_occurred_at])).rows[0].result;
      }
      assert(url.startsWith('leads?'), 'social intake must not touch sending paths');
      const params = new URLSearchParams(url.split('?')[1]);
      if (options.method === 'POST') {
        const keys = Object.keys(options.body);
        assert(keys.every(key => /^[a-z_]+$/.test(key)));
        return (await db.query(`INSERT INTO leads(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT(id) DO NOTHING RETURNING id`, keys.map(key => typeof options.body[key] === 'object' && options.body[key] !== null ? JSON.stringify(options.body[key]) : options.body[key]))).rows;
      }
      const company = params.get('company_id').slice(3), lead = params.get('id').slice(3);
      if (options.method === 'PATCH') {
        assert.deepEqual(Object.keys(options.body), ['interest_profile']);
        const expected = params.get('interest_profile') === 'is.null' ? null : params.get('interest_profile').slice(3);
        return (await db.query('UPDATE leads SET interest_profile=$3::jsonb WHERE company_id=$1 AND id=$2 AND interest_profile IS NOT DISTINCT FROM $4::jsonb RETURNING id', [company, lead, JSON.stringify(options.body.interest_profile), expected])).rows;
      }
      return (await db.query('SELECT id,interest_profile FROM leads WHERE company_id=$1 AND id=$2', [company, lead])).rows;
    }
    const cache = new Map();
    function load(name) {
      if (cache.has(name)) return cache.get(name);
      const module = {exports:{}}; cache.set(name,module.exports);
      const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      vm.runInNewContext(source, {exports:module.exports,module,require:specifier => specifier === 'node:crypto' ? crypto : specifier === './supabase' ? {supabaseServiceRequest:request} : specifier === './lead-import' ? {importPhone:s => s.replace(/\D/g,'')} : specifier==='./tenant-context'?{currentAccount:()=>{throw Error('Webhook cannot infer browser tenant');}}:specifier==='./social-connections'?{}:load(specifier.replace('./','')),process:{env:{}},URL,Date,Buffer,AbortSignal,fetch:() => {throw new Error('Network forbidden in this test');}});
      return module.exports;
    }
    const social = load('meta-social');
    const account=(await db.query("SELECT bind_social_account($1,$2,'instagram','456','123','Synthetic Instagram',NULL,'v26.0') value",[id(1),id(11)])).rows[0].value;
    const facebookAccount=(await db.query("SELECT bind_social_account($1,$2,'facebook','789','789','Synthetic Facebook',NULL,'v26.0') value",[id(1),id(11)])).rows[0].value;
    const connection = {companyId:id(1),instagramId:'456',pageId:'123',databaseId:account,enabled:true,apiVersion:'v26.0'};
    const facebookConnection={companyId:id(1),pageId:'789',databaseId:facebookAccount,enabled:true,apiVersion:'v26.0'};
    const ago = days => Date.now() - days * 86400000;
    const payload = (sender, message, timestamp) => ({object:'instagram',entry:[{id:'456',messaging:[{sender:{id:sender},recipient:{id:'456'},timestamp,message:{mid:message,text:'Contato sintético'}}]}]});
    const event = (sender, message, timestamp) => social.parseSocialEvents(payload(sender,message,timestamp),[connection])[0];
    const ingest = async (sender, message, timestamp) => { const parsed = event(sender,message,timestamp); await social.saveSocialEvent(parsed); return social.socialLeadId(parsed); };
    const owner = async lead => {
      await db.query("UPDATE leads SET created_at=now()-interval '50 days',assigned_to='Dono 1',last_contact_at=NULL WHERE id=$1",[lead]);
      await db.query("UPDATE social_threads SET assigned_broker_id=$2,assigned_to='Dono 1',mode='human' WHERE company_id=$3 AND lead_id=$1",[lead,id(11),id(1)]);
    };
    const call = async () => (await db.query('SELECT release_inactive_lead_pool($1,$2) result',[id(1),id(11)])).rows[0].result;
    const record = async lead => (await db.query('SELECT assigned_to,interest_profile,last_contact_at FROM leads WHERE id=$1',[lead])).rows[0];
    const archive = async lead => db.query("UPDATE leads SET lifecycle_status='Convertido' WHERE id=$1",[lead]);

    const lead = await ingest('777','old',ago(41)); await owner(lead);
    await ingest('777','recent',ago(1));
    assert.equal((await call()).released,0,'recent received Instagram DM protects an old assigned lead');
    assert.equal((await record(lead)).assigned_to,'Dono 1');
    const beforeReplay = JSON.stringify((await record(lead)).interest_profile);
    const contactBeforeReplay = String((await record(lead)).last_contact_at);
    await social.saveSocialEvent(event('777','recent',Date.now()));
    assert.equal(JSON.stringify((await record(lead)).interest_profile),beforeReplay,'retry does not refresh the original event time');
    assert.equal(String((await record(lead)).last_contact_at),contactBeforeReplay,'duplicate delivery cannot refresh contact cache');
    await archive(lead);

    const stale = await ingest('778','stale',ago(31)); await owner(stale);
    await ingest('778','late-older',ago(45));
    assert.equal((await call()).released,1,'old delayed delivery does not renew inactivity');
    assert.equal((await record(stale)).assigned_to,null);
    const releasedThread=(await db.query('SELECT assigned_broker_id,assigned_to,mode FROM social_threads WHERE company_id=$1 AND lead_id=$2',[id(1),stale])).rows[0];
    assert.equal(releasedThread.assigned_broker_id,null);assert.equal(releasedThread.assigned_to,null);assert.equal(releasedThread.mode,'human','release never silently reactivates AI');
    const release = (await db.query('SELECT last_contact_at FROM lead_pool_releases WHERE lead_id=$1',[stale])).rows[0];
    assert(Date.parse(release.last_contact_at) < ago(30));
    assert.equal((await call()).released,0,'retry of release remains idempotent');

    for (const [sender, timestamp] of [['779',undefined],['780',Date.now()+86400000],['781','invalid']]) {
      const unknown = await ingest(sender,'unknown',timestamp); await owner(unknown);
      const result = await call(); assert.equal(result.released,0);
      assert.equal(result.protected.find(row => row.leadId === unknown).reason,'contact-history-unverified');
      assert.equal((await db.query('SELECT last_inbound_at FROM social_threads WHERE company_id=$1 AND lead_id=$2',[id(1),unknown])).rows[0].last_inbound_at,null,'fallback display time is never contact evidence');
      await archive(unknown);
    }
    const historical = id(1782);
    await db.query("INSERT INTO leads(id,company_id,name,phone,source,interest_profile) VALUES($1,$2,'Historical IG contact','','Instagram Direct',$3)",[historical,id(1),JSON.stringify({socialChannel:'instagram',socialSenderId:'782',socialMessages:[{id:'historical',text:'Retained conversation',at:new Date(ago(40)).toISOString(),contactAt:new Date(ago(40)).toISOString()}]})]);
    await owner(historical);
    const profile = (await record(historical)).interest_profile;
    delete profile.socialMessages[0].contactAt;
    await db.query('UPDATE leads SET interest_profile=$2::jsonb WHERE id=$1',[historical,JSON.stringify(profile)]);
    assert.equal((await call()).protected.find(row => row.leadId === historical).reason,'contact-history-unverified','old transcript without original-time evidence is reviewed');
    profile.socialMessages[0].contactAt='2026-02-31T12:00:00Z';
    await db.query('UPDATE leads SET interest_profile=$2::jsonb WHERE id=$1',[historical,JSON.stringify(profile)]);
    assert.equal((await call()).protected.find(row => row.leadId === historical).reason,'contact-history-unverified','malformed date cannot abort other portfolios');
    for (const unknownProfile of [{}, {...profile,socialMessages:[]}, {...profile,socialSenderId:'invalid'}, {...profile,socialMessages:{bad:true}}]) {
      await db.query('UPDATE leads SET interest_profile=$2::jsonb WHERE id=$1',[historical,JSON.stringify(unknownProfile)]);
      assert.equal((await call()).protected.find(row => row.leadId === historical).reason,'contact-history-unverified','missing or malformed social provenance remains for review');
    }
    await archive(historical);

    // The canonical Messenger channel shares the same inactivity policy. Only
    // confirmed human delivery is contact evidence; AI and failed sends are not.
    const fbPayload={object:'page',entry:[{id:'789',messaging:[{sender:{id:'900'},recipient:{id:'789'},timestamp:ago(40),message:{mid:'messenger-old',text:'Synthetic Messenger inquiry'}}]}]};
    const fbEvent=social.parseSocialEvents(fbPayload,[facebookConnection])[0];
    await social.saveSocialEvent(fbEvent);const fbLead=social.socialLeadId(fbEvent);await owner(fbLead);
    const fbThread=(await db.query('SELECT id FROM social_threads WHERE company_id=$1 AND lead_id=$2',[id(1),fbLead])).rows[0].id;
    await db.query("INSERT INTO social_messages(id,company_id,thread_id,direction,content,status,source,actor_id,external_id,occurred_at,updated_at) VALUES($1,$2,$3,'outgoing','Synthetic human answer','sent','human',$4,'synthetic-confirmed-answer',now()-interval '1 day',now()-interval '1 day')",[id(1900),id(1),fbThread,id(11)]);
    assert.equal((await call()).released,0,'recent sent human Messenger reply protects the portfolio');
    for(const sendingStatus of ['pending','sending','unknown']) {
      await db.query('UPDATE social_messages SET status=$2 WHERE id=$1',[id(1900),sendingStatus]);
      assert.equal((await call()).released,0,`${sendingStatus} send must be resolved before releasing a portfolio`);
    }
    await db.query("UPDATE social_messages SET status='failed' WHERE id=$1",[id(1900)]);
    assert.equal((await call()).released,1,'failed human response does not invent recent contact');
    assert.equal((await record(fbLead)).assigned_to,null);

    assert.equal(social.parseSocialEvents({...payload('783','echo',Date.now()),entry:[{id:'456',messaging:[{sender:{id:'783'},recipient:{id:'456'},message:{mid:'echo',text:'Bot',is_echo:true}}]}]},[connection]).length,0);
    assert.equal(social.parseSocialEvents(payload('783','disabled',Date.now()),[{...connection,enabled:false}]).length,0);
    assert.equal(social.parseSocialEvents(payload('783','wrong-account',Date.now()),[{...connection,instagramId:'999'}]).length,0);
    assert.equal((await db.query('SELECT assigned_to FROM leads WHERE id=$1',[id(201)])).rows[0].assigned_to,'Dono 2');
    assert(calls.length > 0 && calls.every(call => call.url==='rpc/receive_social_message'||call.url.startsWith('leads?')));
    console.log('PASS social -> inactive pool: real parser/canonical intake + all SQL migrations, verified original/replayed arrivals, human delivery, thread release, conservative legacy/future/missing evidence, tenant binding and zero external calls.');
  } finally { await db.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
