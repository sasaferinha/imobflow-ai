const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const cache=new Map();
function load(file){
  const full=path.resolve(__dirname,'../lib/evolution',file.endsWith('.ts')?file:file+'.ts');if(cache.has(full))return cache.get(full);
  const mod={exports:{}};cache.set(full,mod.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:name=>load(path.resolve(path.dirname(full),name)),crypto:require('node:crypto').webcrypto,structuredClone,URL,Date,Error,console,process});return mod.exports;
}
const m=load('model'),{mobileWorkspace}=load('mobile-workspace');
const owner={companyId:'test',brokerId:'owner',role:'owner',name:'Owner'},broker={...owner,brokerId:'broker',role:'broker',name:'Broker'};
const state=m.emptyState('test');state.members=[{id:'owner',role:'owner',name:'Owner',specialization:'Ambos'},{id:'broker',role:'broker',name:'Broker',specialization:'Ambos',permissions:{cases:{readOthers:true,editOthers:false}}}];
const record=(id,kind,data)=>({id,kind,data,createdBy:'owner',createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T10:00:00Z'});
state.records=[
  record('case-owner','cases',{name:'Owner client',assignedTo:'owner',journey:'Negociação',stage:'Lead',status:'Aberto',purpose:'Venda'}),
  record('case-broker','cases',{name:'Broker client',assignedTo:'broker',journey:'Negociação',stage:'Atendimento',status:'Aberto',purpose:'Venda'}),
  record('capture-broker','cases',{assignedTo:'broker',journey:'Captação',stage:'Avaliação',status:'Aberto'}),
  record('visit-owner','tasks',{caseId:'case-owner',assignedTo:'owner',type:'Visita',status:'Confirmada',dueAt:'2026-11-08T13:00:00Z'}),
  record('visit-broker','tasks',{caseId:'case-broker',assignedTo:'broker',type:'Visita',status:'Confirmada',visitStartedAt:'2026-11-08T12:00:00Z',dueAt:'2026-11-08T16:00:00Z'}),
  record('visit-later','tasks',{caseId:'case-broker',assignedTo:'broker',type:'Visita',status:'Pendente',dueAt:'2026-11-08T14:00:00Z'}),
  record('visit-finished','tasks',{caseId:'case-broker',assignedTo:'broker',type:'Visita',status:'Realizada',visitEndedAt:'2026-11-07T12:00:00Z',dueAt:'2026-11-07T11:00:00Z'}),
  record('overdue-task','tasks',{caseId:'case-broker',assignedTo:'broker',type:'Tarefa',status:'Pendente',dueAt:'2026-11-07T10:00:00Z'}),
  record('won','cases',{assignedTo:'broker',journey:'Negociação',stage:'Negociado',status:'Ganho',purpose:'Venda'})
];
const before=JSON.stringify(state),now='2026-11-08T13:00:00Z';
const personal=mobileWorkspace(state,broker,'owner',now);
assert.deepEqual(Array.from(personal.open,row=>row.id),['case-broker'],'broker filter cannot be replaced even with readOthers access');
assert.deepEqual(Array.from(personal.activeVisits,row=>row.id),['visit-broker','visit-later'],'ongoing visit first');
assert.equal(personal.completedVisits.length,1);assert.equal(personal.pending[0].id,'overdue-task');assert.equal(personal.won,1);
assert.equal(personal.stages.find(group=>group.stage==='Atendimento').records.length,1);
assert.equal(mobileWorkspace(state,owner,'',now).open.length,2,'owner sees team');
assert.equal(mobileWorkspace(state,owner,'broker',now).open.length,1,'owner can select broker');
assert.equal(mobileWorkspace({...state,companyId:'foreign'},broker,'',now).open.length,0,'foreign company denied');
assert.equal(JSON.stringify(state),before,'view never writes records or advances stages');
console.log('PASS mobile workspace: personal funnel despite sharing, owner selection, active/finished visit order, overdue tasks, tenant boundaries, read-only derived state.');
