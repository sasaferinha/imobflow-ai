const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const ts=require('typescript');
const company='11111111-1111-4111-a111-111111111111';
const calls=[],rows=new Map();let rejectGraph=false;let race=false;let graphCalls=0;
async function db(url,options={}) {
  calls.push({url,...options});
  if(options.method==='POST') {if(rows.has(options.body.id))return [];rows.set(options.body.id,structuredClone(options.body));return [{id:options.body.id}];}
  const params=new URLSearchParams(url.split('?')[1]),record=rows.get(params.get('id').slice(3));
  assert.equal(params.get('company_id'),`eq.${company}`);
  if(options.method==='PATCH'){
    if(race)return [];
    assert.equal(params.get('interest_profile'),record.interest_profile===null?'is.null':`eq.${JSON.stringify(record.interest_profile)}`);
    Object.assign(record,options.body);return [{id:record.id}];
  }
  return record?[{interest_profile:structuredClone(record.interest_profile)}]:[];
}
const cache=new Map();
function load(name){
  if(cache.has(name))return cache.get(name);
  const mod={exports:{}};cache.set(name,mod.exports);
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports:mod.exports,module:mod,require:specifier=>specifier==='node:crypto'?crypto:specifier==='./supabase'?{supabaseServiceRequest:db}:specifier==='./lead-import'?{importPhone:s=>{const d=s.replace(/\D/g,'');return [10,11].includes(d.length)?'55'+d:d;}}:load(specifier.replace('./','')),process:{env:{}},URL,URLSearchParams,Date,Buffer,AbortSignal,fetch:async(url,options)=>{
    graphCalls++;assert.equal(new URL(url).origin,'https://graph.facebook.com');assert.equal(options.headers.Authorization,'Bearer private-test');
    if(rejectGraph)return Response.json({}, {status:403});
    return Response.json({id:'999',field_data:[{name:'full_name',values:['Teste fictício']},{name:'telefone',values:['35999999999']},{name:'objetivo',values:['Alugar']},{name:'tipo_de_imovel',values:['Apartamento']},{name:'bairro',values:['Centro']}]});
  }},{filename:name});cache.set(name,mod.exports);return mod.exports;
}
(async()=>{
  const m=load('meta-social');
  assert.deepEqual(Array.from(m.socialConnections()),[]);
  assert.throws(()=>m.socialConnections('{}'));
  const connection=m.socialConnections(JSON.stringify([{companyId:company,pageId:'123',instagramId:'456',accessToken:'private-test',enabled:true}]))[0];
  assert.throws(()=>m.socialConnections(JSON.stringify([connection,{...connection,companyId:'22222222-2222-4222-a222-222222222222'}])));
  assert.equal(m.socialConnections(JSON.stringify([{companyId:company,pageId:'123'}]))[0].enabled,false);
  const fb={object:'page',entry:[{id:'123',changes:[{field:'leadgen',value:{leadgen_id:'999',page_id:'123'}}]}]};
  const [event]=m.parseSocialEvents(fb,[connection]);assert.equal(event.connection.companyId,company);
  assert.equal(m.parseSocialEvents({...fb,entry:[{...fb.entry[0],id:'000'}]},[connection]).length,0);
  assert.equal(m.parseSocialEvents(fb,[{...connection,enabled:false}]).length,0);
  assert.equal(m.parseSocialEvents({...fb,entry:[{...fb.entry[0],changes:[{field:'leadgen',value:{leadgen_id:'999',page_id:'000'}}]}]},[connection]).length,0);
  assert.equal((await m.saveSocialEvent(event)).created,true);assert.equal((await m.saveSocialEvent(event)).created,false);
  assert.equal(graphCalls,1,'retries skip already committed Facebook forms before the Graph request');
  const lead=rows.get(m.socialLeadId(event));assert.equal(lead.company_id,company);assert.equal(lead.goal,'Alugar');assert.equal(lead.budget_max,null);assert.equal(lead.assigned_to,null);
  assert.notEqual(m.socialLeadId(event),m.socialLeadId({...event,connection:{...connection,companyId:'22222222-2222-4222-a222-222222222222'}}));
  const unqualified=m.mapFacebookLead({field_data:[{name:'phone_number',values:['invalid']},{name:'objetivo',values:['talvez comprar ou alugar']},{name:'orcamento',values:['500 mil']}]});assert.equal(unqualified.goal,'Não informado');assert.equal(unqualified.phone,'');assert.equal(unqualified.budget,'Não informado');
  const ig={object:'instagram',entry:[{id:'456',messaging:[{sender:{id:'777'},recipient:{id:'456'},timestamp:Date.now(),message:{mid:'mid1',text:'Gostaria de informações'}}]}]};
  const [dm]=m.parseSocialEvents(ig,[connection]);assert.equal(dm.senderId,'777');
  await m.saveSocialEvent(dm);await m.saveSocialEvent(dm);assert.equal(rows.get(m.socialLeadId(dm)).interest_profile.socialMessages.length,1);
  rows.get(m.socialLeadId(dm)).interest_profile.preferences='preserved';await m.saveSocialEvent({...dm,externalId:'mid2',text:'Centro'});assert.equal(rows.get(m.socialLeadId(dm)).interest_profile.preferences,'preserved');assert.equal(rows.get(m.socialLeadId(dm)).phone,'');
  assert.equal(m.parseSocialEvents({...ig,entry:[{...ig.entry[0],messaging:[{...ig.entry[0].messaging[0],message:{mid:'echo',text:'hello',is_echo:true}}]}]},[connection]).length,0);
  race=true;await assert.rejects(()=>m.saveSocialEvent({...dm,externalId:'mid3'}),/social_update_conflict/);race=false;
  rows.get(m.socialLeadId(dm)).interest_profile=null;
  await m.saveSocialEvent({...dm,externalId:'after-null'});assert.equal(rows.get(m.socialLeadId(dm)).interest_profile.socialMessages.length,1,'CAS supports old nullable profiles');
  const base=Date.parse('2026-10-01T10:00:00.000Z');
  rows.get(m.socialLeadId(dm)).interest_profile={socialMessages:Array.from({length:40},(_,i)=>({id:`history-${i}`,text:'Synthetic',at:new Date(base+i*1000).toISOString()}))};
  const oldWindow=JSON.stringify(rows.get(m.socialLeadId(dm)).interest_profile);
  await m.saveSocialEvent({...dm,externalId:'late-old',occurredAt:'2026-09-01T10:00:00.000Z'});
  assert.equal(JSON.stringify(rows.get(m.socialLeadId(dm)).interest_profile),oldWindow,'late old deliveries do not evict newer messages');
  await m.saveSocialEvent({...dm,externalId:'insert-middle',occurredAt:new Date(base+2500).toISOString()});
  const recent=rows.get(m.socialLeadId(dm)).interest_profile.socialMessages;
  assert.equal(recent.length,40);assert.equal(recent.at(-1).id,'history-39');assert.ok(recent.some(item=>item.id==='insert-middle'));
  const bulkPayload={object:'instagram',entry:[{id:'456',messaging:Array.from({length:65},(_,i)=>({sender:{id:'888'},recipient:{id:'456'},timestamp:base+i*1000,message:{mid:`bulk-${i}`,text:`Synthetic ${i}`}}))}]};
  const bulk=m.parseSocialEvents(bulkPayload,[connection]);assert.equal(bulk.length,65,'valid bounded batch is not rejected at 20 events');
  for(const item of bulk.slice(0,45))await m.saveSocialEvent(item);
  for(const item of bulk)await m.saveSocialEvent(item);
  const bulkRow=rows.get(m.socialLeadId(bulk[0]));assert.equal(bulkRow.interest_profile.socialMessages.length,40);assert.equal(bulkRow.interest_profile.socialMessages[0].id,'bulk-25');assert.equal(bulkRow.interest_profile.socialMessages.at(-1).id,'bulk-64');
  const finalWindow=JSON.stringify(bulkRow.interest_profile);
  for(const item of bulk)await m.saveSocialEvent(item);
  assert.equal(JSON.stringify(bulkRow.interest_profile),finalWindow,'replayed old messages do not prevent later batch progress or evict current window');
  rejectGraph=true;await assert.rejects(()=>m.saveSocialEvent({...event,externalId:'888'}),/social_retrieval_failed/);
  assert.ok(calls.every(c=>!c.url.includes('messages')&&!c.url.includes('outbox')),'never invokes outbound WhatsApp paths');
  console.log('Meta social: tenant binding, explicit opt-in, mapping, idempotency, transcript CAS and no sending passed.');
})().catch(e=>{console.error(e);process.exit(1);});
