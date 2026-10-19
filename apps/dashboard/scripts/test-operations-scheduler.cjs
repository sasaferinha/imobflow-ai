const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto').webcrypto;
const fixed='2026-10-12T12:00:00.000Z';
class Clock extends Date {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return Date.parse(fixed);}}
const company='11111111-1111-4111-a111-111111111111';
let enabled=true,hasOwner=true,activeActor=null,reads=0,queries=0,writes=0;
let pool = { released: 0, protected: [] }, poolCalls = 0;
let integrated = true;
const cache=new Map();let state;
function load(file){
  if(cache.has(file))return cache.get(file);
  const mod={exports:{}};cache.set(file,mod.exports);
  const requireLocal=specifier=>{
    if(file.endsWith('scheduler.ts')&&specifier==='../supabase')return{async supabaseServiceRequest(url,options){queries++;if(url==='rpc/release_inactive_lead_pool'){assert.deepEqual(JSON.parse(JSON.stringify(options.body)),{p_company_id:company,p_actor_id:'owner'});assert.equal(options.timeoutMs,5000);poolCalls++;return structuredClone(pool);}assert.match(url,new RegExp(`company_id=eq.${company}`));assert.match(url,/active=eq.true&role=eq.owner/);return hasOwner?[{id:'owner',name:'Manager example'}]:[];}};
    if(file.endsWith('scheduler.ts')&&specifier==='../tenant-context')return{withAccount:async(actor,callback)=>{assert.equal(actor.companyId,company);assert.equal(actor.role,'owner');activeActor=actor;try{return await callback();}finally{activeActor=null;}}};
    if(file.endsWith('scheduler.ts')&&specifier==='./feature')return{evolutionEnabled:id=>enabled&&id===company};
    if(file.endsWith('scheduler.ts')&&specifier==='./server')return{
      evolutionIntegrated:()=>integrated,
      readEvolutionState:async actor=>{reads++;assert.equal(actor.companyId,company);assert.ok(activeActor);return structuredClone(state);},
      executeEvolutionCommand:async(actor,command,version)=>{assert.equal(actor.companyId,company);if(command.type!=='capture-reminders'){assert.ok(['notices','followups'].includes(command.kind));assert.equal(command.type,'save');}assert.ok(!JSON.stringify(command).includes('Private customer'));if(version!==state.version)throw Error('CAS conflict');state=load('lib/evolution/model.ts').applyCommand(state,actor,command,fixed);writes++;},
    };
    if(!specifier.startsWith('.'))throw Error(`Unexpected scheduler dependency: ${specifier}`);
    return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier))+'.ts');
  };
  const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module:mod,exports:mod.exports,require:requireLocal,Date:Clock,crypto,structuredClone,URL,console},{filename:file});return mod.exports;
}
(async()=>{
  const model=load('lib/evolution/model.ts'),ops=load('lib/evolution/operations.ts'),scheduler=load('lib/evolution/scheduler.ts');
  state=model.emptyState(company);state.members=[{id:'owner',name:'Manager example',role:'owner',specialization:'Ambos'}];
  enabled=false;assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).report,'disabled');assert.equal(queries,0);
  enabled=true;hasOwner=false;assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).report,'no-owner');assert.equal(reads,0);
  hasOwner=true;assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).report,'disabled');assert.equal(writes,0);
  state.settings.operations={...ops.operationsSettings(state),weeklyReportsEnabled:true};
  const concurrent=await Promise.allSettled([scheduler.runEvolutionScheduler(company,'Company example'),scheduler.runEvolutionScheduler(company,'Company example')]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled'&&r.value.report==='generated').length,1);assert.equal(writes,1,'workspace CAS prevents duplicate notices');
  assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).report,'already-generated');assert.equal(writes,1);
  const notice=state.records.find(r=>r.kind==='notices');
  state=model.applyCommand(state,{companyId:company,brokerId:'owner',name:'Manager example',role:'owner'},{type:'save',kind:'notices',id:notice.id,data:{name:'Renamed by manager'}},fixed);
  assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).report,'already-generated','immutable creation audit survives title edits');assert.equal(writes,1);
  state.settings.operations.weeklyReportsEnabled=false;
  assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).report,'disabled');assert.equal(writes,1);
  state.members.push({id:'broker',name:'Broker example',role:'broker',specialization:'Venda'});
  state=model.applyCommand(state,{companyId:company,brokerId:'owner',name:'Manager example',role:'owner'},{type:'save',kind:'captureGoals',data:{name:'Meta de teste',assignedTo:'broker',purpose:'Venda',month:'2026-10',target:3}},fixed);
  state.settings.operations.captureRemindersEnabled=true;
  const captureRuns=await Promise.allSettled([scheduler.runEvolutionScheduler(company,'Company example'),scheduler.runEvolutionScheduler(company,'Company example')]);
  assert.equal(captureRuns.filter(r=>r.status==='fulfilled'&&r.value.captureReminders===1).length,1);
  assert.equal(state.records.filter(r=>r.kind==='followups').length,1,'concurrent scheduler runs cannot duplicate capture requests');
  assert.equal((await scheduler.runEvolutionScheduler(company,'Company example')).captureReminders,0);
  assert.equal(poolCalls,0,'inactive release requires explicit opt-in');
  state.settings.operations.inactivePoolEnabled=true;
  integrated=false;await assert.rejects(()=>scheduler.runEvolutionScheduler(company,'Company example'),/canonical_integration/);assert.equal(poolCalls,0);integrated=true;
  for(let n=1;n<=14;n++) {
    const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    state.records.push({id:'lead:'+id,kind:'leads',createdAt:fixed,updatedAt:fixed,createdBy:'owner',data:{name:'Contato protegido fictício '+n}});
    pool.protected.push({leadId:id,lastContactAt:'2026-08-01T12:00:00+00:00'});
  }
  pool.protected.push({leadId:'foreign-lead',lastContactAt:'2026-08-01T12:00:00Z'});
  const warnings=()=>state.records.filter(r=>r.kind==='followups'&&r.data.protectedLeadId);
  await scheduler.runEvolutionScheduler(company,'Company example');assert.equal(warnings().length,5);
  await scheduler.runEvolutionScheduler(company,'Company example');assert.equal(warnings().length,10,'deduplication before cap lets subsequent reviews progress');
  await scheduler.runEvolutionScheduler(company,'Company example');assert.equal(warnings().length,14);
  pool.protected.forEach(candidate=>candidate.lastContactAt='2026-08-01T12:00:00.000Z');
  await scheduler.runEvolutionScheduler(company,'Company example');assert.equal(warnings().length,14,'same contact represented in another timezone format is not a new review');
  assert(warnings().every(r=>r.data.assignedTo==='owner'),'protected reviews go only to manager');
  assert.equal(model.visibleState(state,{companyId:company,brokerId:'broker',name:'Broker example',role:'broker'}).records.some(r=>r.data.protectedLeadId),false);
  const uncertainId='00000000-0000-4000-8000-000000000099';
  state.records.push({id:'lead:'+uncertainId,kind:'leads',createdAt:fixed,updatedAt:fixed,createdBy:'owner',data:{name:'Contato sem prova fictício'}});
  pool.protected=[{leadId:uncertainId,lastContactAt:null,reason:'contact-history-unverified'}];
  await scheduler.runEvolutionScheduler(company,'Company example');
  const uncertainReview=warnings().find(r=>r.data.protectedLeadId==='lead:'+uncertainId);
  assert(uncertainReview,'unknown contact date still creates a manager review');
  assert.equal(uncertainReview.data.poolContactAt,'','unknown date must not be invented');
  assert.match(uncertainReview.data.request,/não permite comprovar/);
  assert.doesNotMatch(uncertainReview.data.request,/possui visita/);
  const warningsBeforeRetry=warnings().length;
  await scheduler.runEvolutionScheduler(company,'Company example');
  assert.equal(warnings().length,warningsBeforeRetry,'unknown contact evidence has a stable deduplication key');
  const priorPoolCalls=poolCalls;
  assert.equal((await scheduler.runEvolutionScheduler(company,'Company example',Clock.now()+1000)).report,'deferred');
  assert.equal(poolCalls,priorPoolCalls,'deadline reserve prevents starting another release');
  console.log('PASS operations scheduler: opt-in, active owner/tenant context, disabled states, no external-send dependencies, truthful internal report, CAS duplicate prevention and renamed-notice audit deduplication.');
})().catch(error=>{console.error(error);process.exit(1);});
