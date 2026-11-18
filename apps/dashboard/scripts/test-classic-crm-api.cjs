// Synthetic transport only: no production reads, messages or database writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const company=id(1),broker=id(11),otherBroker=id(12),owner=id(10),now='2026-11-18T12:00:00.000Z';
let actor={companyId:company,brokerId:broker,name:'Broker A',role:'broker'},enabled=true,forceWrongTenant=false,uploads=0,afterCheck;
const calls=[],writes=[];
const lead={id:id(21),company_id:company,name:'Cliente A',phone:'31999990001',assigned_to:'Broker A',created_at:now,lifecycle_status:'Novo'};
const otherLead={...lead,id:id(22),name:'Cliente B',assigned_to:'Broker B'};
const property={id:id(31),company_id:company,title:'Casa A',district:'Centro',price:100000,status:'Disponível',purpose:'Venda',images:[],created_at:now,captured_by:broker};
const otherProperty={...property,id:id(32),captured_by:otherBroker};
const appointment={id:id(41),company_id:company,lead_id:lead.id,property_id:property.id,lead_name:'Cliente A',property_title:'Casa A',scheduled_at:now,created_at:now,status:'Confirmada',notes:'Cliente A · Casa A'};
const rows={leads:[lead,otherLead],properties:[property,otherProperty],appointments:[appointment]};
async function db(resource,options={}){
 calls.push({resource,options});
 if(resource.startsWith('leads?')){assert.equal(actor.brokerId,'system','only the internal scheduler may scan company leads directly');return rows.leads;}
 const p=options.body;assert.equal(options.method,'POST');assert.equal(p.p_company_id,company);assert.equal(p.p_actor_id,actor.brokerId);
 if(!enabled)throw Error('classic_crm_forbidden');
 if(resource==='rpc/read_classic_crm_records'){
  if(forceWrongTenant)return [{...lead,company_id:id(2)}];
  return rows[p.p_table].filter(row=>actor.role==='owner'||p.p_table==='properties'||p.p_table==='leads'&&row.assigned_to===actor.name||p.p_table==='appointments'&&row.lead_id===lead.id);
 }
 assert.equal(resource,'rpc/write_classic_crm_record');
 const row=rows[p.p_table].find(row=>row.id===p.p_id);
 if(p.p_action!=='insert'&&!row)return null;
 if(actor.role!=='owner'&&row&&(p.p_table==='properties'?row.captured_by!==actor.brokerId:p.p_table==='leads'?row.assigned_to!==actor.name:row.lead_id!==lead.id))throw Error('classic_crm_forbidden');
 if(p.p_action==='check'){const result={...row};if(afterCheck){const action=afterCheck;afterCheck=null;action();}return result;}
 if(p.p_table==='appointments'&&p.p_action!=='insert'&&!['Aguardando','Agendada','Confirmada'].includes(row.status))return null;
 assert.ok(!('company_id' in p.p_data)&&!('id' in p.p_data),'identity comes only from authenticated RPC arguments');
 writes.push(p);
 if(p.p_action==='delete')return row;
 if(p.p_action==='insert')return {...p.p_data,id:id(99),company_id:company,created_at:now,captured_by:actor.brokerId};
 Object.assign(row,p.p_data);return {...row};
}
const cache=new Map();
function load(file){
 file=path.normalize(file);if(cache.has(file))return cache.get(file);
 const mod={exports:{}};cache.set(file,mod.exports);
 const requireMock=name=>{
  if(name==='next/server')return {NextResponse:{json:Response.json},after:()=>{}};
  if(name==='@neondatabase/serverless')return {neon:()=>{throw Error('No SQL network permitted');}};
  const resolved=name.startsWith('@/')?name.slice(2):name.startsWith('.')?path.join(path.dirname(file),name):name;
  const key=resolved.replaceAll('\\','/');
  if(key==='lib/supabase')return {supabaseCompanyId:()=>actor.companyId,supabaseRequest:db};
  if(key==='lib/tenant-context')return {currentAccount:()=>actor,withAccount:(_a,fn)=>fn()};
  if(key==='lib/accounts')return {protectedRoute:fn=>fn};
  if(key==='lib/admin-auth')return {isAdminRequest:()=>true};
  if(key==='lib/request-security')return {hasSameOrigin:()=>true};
  if(key==='lib/automations')return {runAutomationsAfterEvent:async()=>{}};
  if(key==='lib/opportunities')return {onPropertyChanged:async()=>{}};
  if(key==='lib/property-images')return {persistPropertyImages:async images=>{uploads++;return images;}};
  return load(`${resolved}.ts`);
 };
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:requireMock,Date,Map,Set,Error,console,Buffer,process:{env:{}}},{filename:file});
 return mod.exports;
}
(async()=>{
 const api=load('lib/database.ts'),access=load('lib/classic-crm-access.ts');
 assert.deepEqual((await api.listLeads()).map(row=>row.id),[lead.id]);
 await assert.rejects(()=>api.updateLeadIntelligence(otherLead.id,{lifecycleStatus:'Perdido'}),error=>error.status===403);
 assert.equal(writes.length,0);
 assert.equal((await api.updateLeadIntelligence(lead.id,{lifecycleStatus:'Visita'})).lifecycleStatus,'Visita');
 const agenda=await api.listAppointments();assert.equal(agenda[0].name,'Cliente A');assert.equal(agenda[0].property,'Casa A');
 assert.equal(calls.at(-1).resource,'rpc/read_classic_crm_records');
 const propertyRoute=load('app/api/properties/[id]/route.ts'),leadRoute=load('app/api/leads/[id]/route.ts');
 const request=body=>({json:async()=>body}),context=recordId=>({params:Promise.resolve({id:recordId})});
 assert.equal((await leadRoute.PATCH(request({lifecycleStatus:'Convertido'}),context(otherLead.id))).status,403);
 assert.equal((await propertyRoute.PATCH(request({action:'photos',images:[]}),context(otherProperty.id))).status,403);
 assert.equal(uploads,0,'denied property cannot upload photos first');
 afterCheck=()=>{property.captured_by=otherBroker;};
 assert.equal((await propertyRoute.PATCH(request({action:'photos',images:[]}),context(property.id))).status,403,'reassignment after preflight is still denied by the atomic mutation');
 assert.equal(writes.length,1,'stale preflight cannot write');
 actor={...actor,brokerId:owner,name:'Administrador',role:'owner'};
 assert.equal((await api.listLeads()).length,2,'owner retains both portfolios');
 assert.equal((await propertyRoute.PATCH(request({action:'photos',images:[]}),context(otherProperty.id))).status,200);
 enabled=false;await assert.rejects(()=>api.updateLeadIntelligence(lead.id,{lifecycleStatus:'Novo'}),error=>error.status===403);enabled=true;
 forceWrongTenant=true;await assert.rejects(()=>api.listLeads(),error=>error.status===503);forceWrongTenant=false;
 await assert.rejects(()=>access.writeClassicRow('leads','not-a-uuid','update'),error=>error.status===400);
 const before=calls.length;actor={...actor,brokerId:'system'};
 assert.equal((await api.listLeadsForAutomation()).length,2);assert.ok(calls[before].resource.startsWith('leads?'));
 await assert.rejects(()=>api.listLeads(),error=>error.status===401,'browser listing never accepts the internal scheduler identity');
 await assert.rejects(()=>access.writeClassicRow('leads',lead.id,'update'),error=>error.status===401,'system read does not grant a browser-like write identity');
 console.log('PASS classic CRM API: broker portfolio reads, own edits, foreign denial, atomic recheck after photo preflight, owner access, revoked identity, cross-company response rejection and bounded scheduler-only reads.');
})().catch(error=>{console.error(error);process.exitCode=1;});
