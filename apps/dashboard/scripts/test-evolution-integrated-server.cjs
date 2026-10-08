// Real route/session/domain/SQL in an isolated fixture. External network is denied.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');

async function run() {
  const db = await createDatabase();
  const env = { SUPABASE_URL: 'https://integrated-isolated.example.test', SUPABASE_SECRET_KEY: 'synthetic-key',
    CRM_EVOLUTION_ENABLED: 'true', CRM_EVOLUTION_INTEGRATED: 'true', CRM_EVOLUTION_COMPANIES: `${id(1)},${id(2)}` };
  const calls = [], afterCallbacks = [], matchingCalls = [];
  let beforeCommit, failAfterCommit = false, failedReadPending = false;
  try {
    await seedCompanies(db);
    await db.exec(`ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;
      UPDATE leads SET score=0,temperature='Frio' WHERE score IS NULL;
      ALTER TABLE leads ALTER COLUMN score SET DEFAULT 0,ALTER COLUMN score SET NOT NULL,
        ALTER COLUMN temperature SET DEFAULT 'Frio',ALTER COLUMN temperature SET NOT NULL;
      ALTER TABLE properties ALTER COLUMN images DROP DEFAULT;
      ALTER TABLE properties ALTER COLUMN images TYPE text[] USING '{}'::text[];
      ALTER TABLE properties ALTER COLUMN images SET DEFAULT '{}'::text[],ALTER COLUMN images SET NOT NULL;
      UPDATE properties SET code=id::text;
      ALTER TABLE properties ALTER COLUMN code SET NOT NULL,ALTER COLUMN purpose SET NOT NULL,
        ALTER COLUMN price SET NOT NULL,ALTER COLUMN district SET NOT NULL,ALTER COLUMN city SET NOT NULL,
        ALTER COLUMN property_type SET NOT NULL,ALTER COLUMN bedrooms SET DEFAULT 0,ALTER COLUMN bedrooms SET NOT NULL,
        ALTER COLUMN parking_spaces SET DEFAULT 0,ALTER COLUMN parking_spaces SET NOT NULL;
      ALTER TABLE appointments ALTER COLUMN scheduled_at SET NOT NULL,ALTER COLUMN status SET DEFAULT 'Agendada',ALTER COLUMN status SET NOT NULL;`);
    for (const n of [12, 13]) await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,$3,$3,'fixture','broker',true,$4,$4)", [id(n), id(1), `Broker ${n}`, `broker${n}@example.test`]);
    await db.query("INSERT INTO leads(id,company_id,name,phone,goal,property_type,region,budget_max,assigned_to,source,lifecycle_status) VALUES($1,$2,'Contato carteira A','5535999990012','Comprar','Casa','Centro',500000,'Broker 12','WhatsApp','Novo')", [id(102), id(1)]);
    await db.query("INSERT INTO conversations(id,company_id,lead_id,channel,status,assigned_broker_id,assigned_to) VALUES($1,$2,$3,'WhatsApp','Aberta',$4,'Broker 12')", [id(502), id(1), id(102), id(12)]);
    await db.exec(migration('20261007190000_crm_evolution_workspace.sql'));
    await db.exec(migration('20261007210000_crm_evolution_legacy_bridge.sql'));
    const sessions = { owner: ['a'.repeat(64),11], broker: ['b'.repeat(64),12], otherBroker: ['c'.repeat(64),13], otherCompany: ['d'.repeat(64),21] };
    for (const [token, actor] of Object.values(sessions)) await db.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [crypto.createHash('sha256').update(token).digest('hex'),id(actor)]);
    await db.exec('SET ROLE service_role');
    const identifier = value => { assert.match(value,/^[a-z_][a-z0-9_]*$/);return `"${value}"`; };
    async function transport(input, options = {}) {
      const url = new URL(input); assert.equal(url.origin,env.SUPABASE_URL,'no external network allowed'); assert.equal(options.headers.apikey,'synthetic-key');
      const resource = url.pathname.replace('/rest/v1/',''); calls.push({resource,method:options.method||'GET',query:url.searchParams});
      try {
        if (resource.startsWith('rpc/')) {
          const fn=resource.slice(4), entries=Object.entries(JSON.parse(options.body));
          if (fn==='commit_crm_evolution_changes' && beforeCommit) { const callback=beforeCommit;beforeCommit=undefined;await callback(); }
          const rows=(await db.query(`SELECT * FROM public.${identifier(fn)}(${entries.map(([key],i)=>`${identifier(key)}=>$${i+1}`).join(',')})`,entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value))).rows;
          const result=['save_crm_evolution_workspace','commit_crm_evolution_changes'].includes(fn)?rows[0][fn]:rows;
          if (fn==='commit_crm_evolution_changes' && result===true && failAfterCommit) {failAfterCommit=false;failedReadPending=true;}
          return Response.json(result);
        }
        if(resource==='leads' && failedReadPending){failedReadPending=false;return Response.json({error:'isolated_post_commit_read_failure'},{status:503});}
        assert.equal(options.method||'GET','GET','canonical writes only through atomic RPC');
        assert.ok(['broker_accounts','crm_evolution_workspaces','leads','properties','appointments','conversations'].includes(resource),resource);
        const values=[],conditions=[];
        for(const [key,value] of url.searchParams){if(['select','order','offset','limit'].includes(key))continue;assert.ok(value.startsWith('eq.'));values.push(key==='active'?value.slice(3)==='true':value.slice(3));conditions.push(`${identifier(key)}=$${values.length}`);}
        const selected=url.searchParams.get('select')||'*', columns=selected==='*'?'*':selected.split(',').map(identifier).join(',');
        const limit=Number(url.searchParams.get('limit')||100),offset=Number(url.searchParams.get('offset')||0);assert.ok(Number.isSafeInteger(limit)&&Number.isSafeInteger(offset)&&limit>0&&offset>=0);
        const rows=(await db.query(`SELECT to_jsonb(q) payload FROM (SELECT ${columns} FROM public.${identifier(resource)}${conditions.length?' WHERE '+conditions.join(' AND '):''} ORDER BY ${resource==='crm_evolution_workspaces'?'company_id':'id'} LIMIT ${limit} OFFSET ${offset}) q`,values)).rows;
        return Response.json(rows.map(r=>r.payload));
      } catch(error){return Response.json({message:error.message,code:error.code},{status:400});}
    }
    const cache=new Map();
    function load(file){
      if(cache.has(file))return cache.get(file);
      const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
      const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      const mod={exports:{}};
      const localRequire=name=>{
        if(name==='next/server')return {NextResponse:{json:Response.json},after:callback=>afterCallbacks.push(callback)};
        if(name==='@/lib/opportunities'||name==='../opportunities')return {onPropertyChanged:async(...args)=>matchingCalls.push(args)};
        if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
        if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');
        return require(name);
      };
      vm.runInNewContext(output,{module:mod,exports:mod.exports,require:localRequire,process:{env},Buffer,Date,URL,URLSearchParams,Response,Request,Headers,AbortSignal,structuredClone,crypto:crypto.webcrypto,console,fetch:transport});
      cache.set(file,mod.exports);return mod.exports;
    }
    const api=load('app/api/evolution/route.ts');
    const request=(method,session,body,origin='https://app.example.test')=>{
      const req=new Request('https://app.example.test/api/evolution?company_id='+id(2),{method,headers:{'content-type':'application/json',...(origin?{origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      req.nextUrl=new URL(req.url);req.cookies={get:name=>name==='imobflow_session'&&session?{value:sessions[session]?.[0]||session}:undefined};return req;
    };
    const get=actor=>api.GET(request('GET',actor));
    const snapshot=async actor=>{const response=await get(actor);assert.equal(response.status,200);return(await response.json()).state;};
    const post=(actor,command,state,origin)=>api.POST(request('POST',actor,{command,expectedVersion:state.version,expectedSourceRevision:state.sourceRevision,companyId:id(2)},origin));
    const save=async(actor,command,state)=>{const response=await post(actor,command,state);const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.state;};
    const queryRow=async(table,uuid)=>(await db.query(`SELECT to_jsonb(t) data FROM ${table} t WHERE id=$1`,[uuid])).rows[0]?.data;
    const workspaceVersion=async()=>(await db.query('SELECT version FROM crm_evolution_workspaces WHERE company_id=$1',[id(1)])).rows[0]?.version||0;
    assert.equal((await get(undefined)).status,401);
    let state=await snapshot('owner'); assert.equal(state.version,0);assert.match(state.sourceRevision,/^[0-9a-f]{64}$/);
    assert.ok(state.records.some(r=>r.id===`person:${id(101)}`));assert.ok(state.records.some(r=>r.id===`property:${id(301)}`));assert.equal(await workspaceVersion(),0,'read cannot seed workspace');
    assert.ok(!calls.some(c=>c.resource==='rpc/commit_crm_evolution_changes'));
    const brokerState=await snapshot('broker'); assert.ok(brokerState.records.some(r=>r.id===`person:${id(102)}`));assert.ok(!brokerState.records.some(r=>r.id===`person:${id(101)}`));
    assert.ok((await snapshot('otherBroker')).records.every(r=>r.kind==='properties'));
    assert.equal((await post('broker',{type:'save',kind:'people',id:`person:${id(101)}`,data:{name:'Forbidden'}},brokerState)).status,403);
    assert.equal((await post('owner',{type:'comment',id:`case:${id(101)}`,text:'Wrong origin'},state,'https://evil.example.test')).status,403);

    state=await save('owner',{type:'save',kind:'people',data:{name:'Contato novo sintético',phone:'5535999990022',personType:'Pessoa física',category:'Cliente',assignedTo:id(11)}},state);
    const person=state.records.find(r=>r.kind==='people'&&r.data.name==='Contato novo sintético'), realLeadId=person.legacy.id;
    assert.equal((await queryRow('leads',realLeadId)).name,'Contato novo sintético');assert.equal(state.records.filter(r=>r.legacy?.id===realLeadId).length,3);
    state=await save('owner',{type:'save',kind:'people',id:person.id,data:{email:'novo@example.test'}},state);
    assert.equal((await queryRow('leads',realLeadId)).email,'novo@example.test');
    state=await save('owner',{type:'save',kind:'leads',id:`lead:${realLeadId}`,data:{purpose:'Venda',propertyType:'Apartamento',region:'Centro',budgetMax:700000,temperature:'Morno',status:'Em atendimento'}},state);
    assert.equal((await queryRow('leads',realLeadId)).goal,'Comprar');
    state=await save('owner',{type:'save',kind:'properties',data:{name:'Imóvel novo sintético',code:'TEST-E2E',purpose:'Venda',price:500000,status:'Disponível',assignedTo:id(11),district:'Centro',city:'Lavras',propertyType:'Apartamento',photoUrl:'https://example.test/front.jpg'}},state);
    const listing=state.records.find(r=>r.kind==='properties'&&r.data.code==='TEST-E2E'), realPropertyId=listing.legacy.id;
    assert.deepEqual((await queryRow('properties',realPropertyId)).images,['https://example.test/front.jpg']);
    state=await save('owner',{type:'save',kind:'properties',id:listing.id,data:{price:520000}},state);
    assert.equal((await queryRow('properties',realPropertyId)).price,520000);
    state=await save('owner',{type:'save',kind:'tasks',data:{name:'Visita nova',caseId:`case:${realLeadId}`,assignedTo:id(11),type:'Visita',propertyId:listing.id,dueAt:'2026-10-08T10:30',priority:'Normal',status:'Pendente'}},state);
    const visit=state.records.find(r=>r.kind==='tasks'&&r.data.caseId===`case:${realLeadId}`);
    assert.equal((await queryRow('appointments',visit.legacy.id)).lead_id,realLeadId);
    assert.equal(Date.parse((await queryRow('appointments',visit.legacy.id)).scheduled_at),Date.parse('2026-10-08T13:30:00Z'));
    state=await save('owner',{type:'save',kind:'tasks',id:visit.id,data:{status:'Realizada'}},state);
    assert.equal((await queryRow('appointments',visit.legacy.id)).status,'Realizada');

    const stale=structuredClone(state);
    state=await save('owner',{type:'comment',id:`case:${realLeadId}`,text:'Observação sintética'},state);
    assert.equal((await post('owner',{type:'comment',id:`case:${realLeadId}`,text:'Stale version'},stale)).status,409);
    await db.query('UPDATE properties SET title=$1 WHERE id=$2',['Alterado pelo painel clássico',realPropertyId]);
    assert.equal((await post('owner',{type:'comment',id:`case:${realLeadId}`,text:'Stale source'},state)).status,409);
    state=await snapshot('owner');assert.equal(state.records.find(r=>r.id===listing.id).data.name,'Alterado pelo painel clássico');
    const beforeRace=Number(await workspaceVersion()), unchangedLead=await queryRow('leads',realLeadId), callbacksBeforeRace=afterCallbacks.length;
    beforeCommit=()=>db.query('UPDATE properties SET price=price+1 WHERE id=$1',[realPropertyId]);
    const acceptedProposal={type:'save',kind:'proposals',data:{name:'Proposta teste',caseId:`case:${realLeadId}`,propertyId:listing.id,amount:520000,conditions:'Pagamento sintético',expiresAt:'2026-10-09',status:'Aceita'}};
    assert.equal((await post('owner',acceptedProposal,state)).status,409,'SQL source race rejects the whole proposal transaction');
    assert.equal(Number(await workspaceVersion()),beforeRace);assert.equal((await queryRow('leads',realLeadId)).lifecycle_status,unchangedLead.lifecycle_status);assert.equal(afterCallbacks.length,callbacksBeforeRace,'no matching hook for failed commit');
    state=await snapshot('owner');state=await save('owner',acceptedProposal,state);
    assert.equal((await queryRow('leads',realLeadId)).lifecycle_status,'Convertido');assert.equal((await queryRow('properties',realPropertyId)).status,'Vendido');
    assert.equal(state.records.find(r=>r.id===`case:${realLeadId}`).data.status,'Ganho');assert.ok(state.records.some(r=>r.kind==='proposals'&&r.data.status==='Aceita'));
    assert.ok((await snapshot('otherCompany')).records.every(r=>r.legacy?.id!==realLeadId&&r.legacy?.id!==realPropertyId));
    assert.equal((await post('otherCompany',{type:'save',kind:'people',id:person.id,data:{name:'Foreign'}},await snapshot('otherCompany'))).status,404);

    env.CRM_EVOLUTION_ENABLED='false';assert.equal((await get('owner')).status,404);
    assert.equal((await queryRow('leads',realLeadId)).lifecycle_status,'Convertido','classic retains canonical update with new UI disabled');
    assert.equal((await queryRow('properties',realPropertyId)).status,'Vendido');assert.equal((await queryRow('appointments',visit.legacy.id)).status,'Realizada');
    env.CRM_EVOLUTION_ENABLED='true';state=await snapshot('owner');assert.ok(state.records.some(r=>r.kind==='proposals'&&r.data.status==='Aceita'),'new-only history also survives toggling');
    failAfterCommit=true;const versionBeforeReadFailure=state.version;
    const failure=await post('owner',{type:'comment',id:`case:${realLeadId}`,text:'Commit succeeds but reload fails'},state);
    assert.equal(failure.status,503);assert.match((await failure.json()).error,/salva/i,'response must disclose accepted commit despite reload failure');
    assert.equal(Number(await workspaceVersion()),versionBeforeReadFailure+1);
    state=await snapshot('owner');assert.ok(state.events.some(e=>e.summary==='Commit succeeds but reload fails'));
    const stored=(await db.query('SELECT document FROM crm_evolution_workspaces WHERE company_id=$1',[id(1)])).rows[0].document;
    assert.ok(!('sourceRevision' in stored));assert.ok(!stored.records.some(r=>r.legacy&&('photoUrl' in r.data||'phone' in r.data)),'canonical customer/photo snapshot is not duplicated in workspace');
    assert.ok(calls.filter(c=>['leads','properties','appointments','conversations','broker_accounts','crm_evolution_workspaces'].includes(c.resource)).every(c=>c.query.get('company_id')?.startsWith('eq.')));
    for(const callback of afterCallbacks)await callback();
    assert.ok(matchingCalls.length>=3,'matching runs only after committed property create/update/closure');
    assert.ok(matchingCalls.every(args=>args[0]===id(1)&&args[1]===realPropertyId));
    console.log('PASS integrated CRM API: real session/route/model/bridge/SQL, canonical CRUD and closure, true text[] images, timezone, no seeds, portfolio+tenant isolation, stale version/source/SQL race, atomic proposal rollback, preserved classic data, truthful post-commit failure and commit-only matching hook.');
    console.log('Entire test uses synthetic isolated PGlite. No production credentials, client messages or external network.');
  } finally {await db.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
