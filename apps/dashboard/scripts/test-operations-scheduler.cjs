const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto').webcrypto;
const fixed='2026-10-12T12:00:00.000Z';
class Clock extends Date {constructor(...args){super(...(args.length?args:[fixed]));}static now(){return Date.parse(fixed);}}
const company='11111111-1111-4111-a111-111111111111';
let enabled=true,hasOwner=true,activeActor=null,reads=0,queries=0,writes=0;
const cache=new Map();let state;
function load(file){
  if(cache.has(file))return cache.get(file);
  const mod={exports:{}};cache.set(file,mod.exports);
  const requireLocal=specifier=>{
    if(file.endsWith('scheduler.ts')&&specifier==='../supabase')return{async supabaseServiceRequest(url){queries++;assert.match(url,new RegExp(`company_id=eq.${company}`));assert.match(url,/active=eq.true&role=eq.owner/);return hasOwner?[{id:'owner',name:'Manager example'}]:[];}};
    if(file.endsWith('scheduler.ts')&&specifier==='../tenant-context')return{withAccount:async(actor,callback)=>{assert.equal(actor.companyId,company);assert.equal(actor.role,'owner');activeActor=actor;try{return await callback();}finally{activeActor=null;}}};
    if(file.endsWith('scheduler.ts')&&specifier==='./feature')return{evolutionEnabled:id=>enabled&&id===company};
    if(file.endsWith('scheduler.ts')&&specifier==='./server')return{
      readEvolutionState:async actor=>{reads++;assert.equal(actor.companyId,company);assert.ok(activeActor);return structuredClone(state);},
      executeEvolutionCommand:async(actor,command,version)=>{assert.equal(actor.companyId,company);assert.equal(command.kind,'notices');assert.equal(command.type,'save');assert.ok(!JSON.stringify(command).includes('Private customer'));if(version!==state.version)throw Error('CAS conflict');state=load('lib/evolution/model.ts').applyCommand(state,actor,command,fixed);writes++;},
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
  console.log('PASS operations scheduler: opt-in, active owner/tenant context, disabled states, no external-send dependencies, truthful internal report, CAS duplicate prevention and renamed-notice audit deduplication.');
})().catch(error=>{console.error(error);process.exit(1);});
