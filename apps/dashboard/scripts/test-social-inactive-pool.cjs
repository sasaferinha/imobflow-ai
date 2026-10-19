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
      vm.runInNewContext(source, {exports:module.exports,module,require:specifier => specifier === 'node:crypto' ? crypto : specifier === './supabase' ? {supabaseServiceRequest:request} : specifier === './lead-import' ? {importPhone:s => s.replace(/\D/g,'')} : load(specifier.replace('./','')),process:{env:{}},URL,Date,Buffer,AbortSignal,fetch:() => {throw new Error('Network forbidden in this test');}});
      return module.exports;
    }
    const social = load('meta-social');
    const connection = {companyId:id(1),instagramId:'456',enabled:true,apiVersion:'v26.0'};
    const ago = days => Date.now() - days * 86400000;
    const payload = (sender, message, timestamp) => ({object:'instagram',entry:[{id:'456',messaging:[{sender:{id:sender},recipient:{id:'456'},timestamp,message:{mid:message,text:'Contato sintético'}}]}]});
    const event = (sender, message, timestamp) => social.parseSocialEvents(payload(sender,message,timestamp),[connection])[0];
    const ingest = async (sender, message, timestamp) => { const parsed = event(sender,message,timestamp); await social.saveSocialEvent(parsed); return social.socialLeadId(parsed); };
    const owner = async lead => db.query("UPDATE leads SET created_at=now()-interval '50 days',assigned_to='Dono 1',last_contact_at=NULL WHERE id=$1",[lead]);
    const call = async () => (await db.query('SELECT release_inactive_lead_pool($1,$2) result',[id(1),id(11)])).rows[0].result;
    const record = async lead => (await db.query('SELECT assigned_to,interest_profile,last_contact_at FROM leads WHERE id=$1',[lead])).rows[0];
    const archive = async lead => db.query("UPDATE leads SET lifecycle_status='Convertido' WHERE id=$1",[lead]);

    const lead = await ingest('777','old',ago(41)); await owner(lead);
    await ingest('777','recent',ago(1));
    assert.equal((await call()).released,0,'recent received Instagram DM protects an old assigned lead');
    assert.equal((await record(lead)).assigned_to,'Dono 1');
    const beforeReplay = JSON.stringify((await record(lead)).interest_profile);
    await social.saveSocialEvent(event('777','recent',Date.now()));
    assert.equal(JSON.stringify((await record(lead)).interest_profile),beforeReplay,'retry does not refresh the original event time');
    assert.equal((await record(lead)).last_contact_at,null,'social evidence does not overwrite the editable contact cache');
    await archive(lead);

    const stale = await ingest('778','stale',ago(31)); await owner(stale);
    await ingest('778','late-older',ago(45));
    assert.equal((await call()).released,1,'old delayed delivery does not renew inactivity');
    assert.equal((await record(stale)).assigned_to,null);
    const release = (await db.query('SELECT last_contact_at FROM lead_pool_releases WHERE lead_id=$1',[stale])).rows[0];
    assert(Date.parse(release.last_contact_at) < ago(30));
    assert.equal((await call()).released,0,'retry of release remains idempotent');

    for (const [sender, timestamp] of [['779',undefined],['780',Date.now()+86400000],['781','invalid']]) {
      const unknown = await ingest(sender,'unknown',timestamp); await owner(unknown);
      const result = await call(); assert.equal(result.released,0);
      assert.equal(result.protected.find(row => row.leadId === unknown).reason,'contact-history-unverified');
      assert.equal((await record(unknown)).interest_profile.socialMessages[0].contactAt,null,'fallback display time is never contact evidence');
      await archive(unknown);
    }
    const historical = await ingest('782','historical',ago(40)); await owner(historical);
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

    assert.equal(social.parseSocialEvents({...payload('783','echo',Date.now()),entry:[{id:'456',messaging:[{sender:{id:'783'},recipient:{id:'456'},message:{mid:'echo',text:'Bot',is_echo:true}}]}]},[connection]).length,0);
    assert.equal(social.parseSocialEvents(payload('783','disabled',Date.now()),[{...connection,enabled:false}]).length,0);
    assert.equal(social.parseSocialEvents(payload('783','wrong-account',Date.now()),[{...connection,instagramId:'999'}]).length,0);
    assert.equal((await db.query('SELECT assigned_to FROM leads WHERE id=$1',[id(201)])).rows[0].assigned_to,'Dono 2');
    assert(calls.length > 0 && calls.every(call => call.url.startsWith('leads?')));
    console.log('PASS social -> inactive pool: real parser/intake + all SQL migrations, original event time, recent/stale/replayed DMs, conservative historical/future/missing/invalid evidence, unchanged cache, tenant binding and zero external calls.');
  } finally { await db.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
