const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto').webcrypto;
const modules = new Map();
function load(name) {
  const file = path.resolve(__dirname,'../lib/evolution',name+'.ts');
  if (modules.has(file)) return modules.get(file);
  const mod={exports:{}}; modules.set(file,mod.exports);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module:mod,exports:mod.exports,require:p=>load(path.basename(p)),crypto,structuredClone,URL,Date,console,process},{filename:file});
  return mod.exports;
}
const m=load('model'), ops=load('operations');
const now='2026-10-09T15:00:00.000Z';
const owner={companyId:'ops-tenant-a',brokerId:'owner',name:'Owner example',role:'owner'};
const b1={...owner,brokerId:'broker1',name:'Broker one',role:'broker'};
const b2={...b1,brokerId:'broker2',name:'Broker two'};
const b3={...b1,brokerId:'broker3',name:'Broker three'};
let state=m.emptyState(owner.companyId);
state.members=[{id:'owner',name:owner.name,role:'owner',specialization:'Ambos'},{id:'broker1',name:b1.name,role:'broker',specialization:'Venda'},{id:'broker2',name:b2.name,role:'broker',specialization:'Ambos'},{id:'broker3',name:b3.name,role:'broker',specialization:'Aluguel'}];
function save(kind,data,id,actor=owner,at=now) { const before=state;state=m.applyCommand(state,actor,{type:'save',kind,data,id},at);assert.equal(state.version,before.version+1);return id||state.records.at(-1).id; }
function fails(fn,pattern) {const before=JSON.stringify(state);assert.throws(fn,pattern);assert.equal(JSON.stringify(state),before,'rejected changes are atomic');}
function configure(patch,actor=owner) {state=m.applyCommand(state,actor,{type:'settings',settings:{operations:{...ops.operationsSettings(state),...patch}}},now);}
const person=save('people',{name:'Fictitious client',personType:'Pessoa física',category:'Cliente',assignedTo:'broker1'});
const lead=save('leads',{name:'Incomplete intake',personId:person,assignedTo:'broker1',source:'Site',purpose:'Venda',temperature:'Morno',status:'Pendente'});
const caseId=save('cases',{name:'Example negotiation',personId:person,leadId:lead,assignedTo:'broker1',source:'Site',purpose:'Venda',journey:'Negociação',stage:'Lead',status:'Aberto'});
const property=save('properties',{name:'Fictitious apartment',code:'OPS-01',purpose:'Venda',price:100000,status:'Disponível',assignedTo:'broker1'});
assert.equal(ops.catalogCompleteness(state,state.records.find(r=>r.id===lead)).complete,false,'incomplete leads remain saved');
assert.equal(ops.catalogCompleteness(state,state.records.find(r=>r.id===property)).complete,false,'old minimal property remains usable');
assert.equal(ops.operationsSettings(state).funnelEnabled,false);
assert.equal(ops.operationsSettings(state).reassignmentEnabled,false);
assert.equal(ops.redistributionCandidates(state,now).length,0);
fails(()=>configure({funnelEnabled:true},b1),/permissão/);
fails(()=>configure({reassignmentDays:0}),/1 a 365/);
fails(()=>configure({reassignmentDays:30.1}),/1 a 365/);
fails(()=>configure({unknown:true}),/inválida/);
fails(()=>configure({funnelEnabled:'yes'}),/ativadas/);
fails(()=>m.applyCommand(state,{...owner,companyId:'ops-tenant-b'},{type:'settings',settings:{operations:ops.operationsSettings(state)}},now),/permissão/);

// Manager accountability lifecycle is persistent, scoped, immutable after review.
const followupData={name:'Complete this catalog',assignedTo:'broker1',caseId,dueAt:'2026-10-10T10:00',priority:'Alta',status:'Pendente',request:'Confirm the missing preferences.'};
fails(()=>save('followups',followupData,undefined,b1),/permissão/);
const followup=save('followups',followupData);
assert.equal(state.records.find(r=>r.id===followup).data.dueAt,'2026-10-10T13:00:00.000Z');
assert.equal(m.visibleState(state,b1).records.some(r=>r.id===followup),true);
assert.equal(m.visibleState(state,b2).records.some(r=>r.id===followup),false);
fails(()=>save('followups',{response:'other portfolio',status:'Respondida'},followup,b2),/permissão/);
fails(()=>save('followups',{assignedTo:'broker2'},followup,b1),/permissão/);
fails(()=>save('followups',{request:'I changed the request'},followup,b1),/permissão/);
fails(()=>save('followups',{status:'Respondida'},followup,b1),/Escreva a resposta/);
fails(()=>save('followups',{status:'Concluída',response:'ok',review:'self approved'},followup,b1),/permissão/);
save('followups',{status:'Em andamento'},followup,b1);
save('followups',{status:'Respondida',response:'Preferences confirmed with client.'},followup,b1);
assert.equal(state.records.find(r=>r.id===followup).data.respondedBy,'broker1');
fails(()=>save('followups',{status:'Pendente'},followup,b1),/aguardando/);
fails(()=>save('followups',{status:'Concluída'},followup),/conferência/);
save('followups',{status:'Concluída',review:'Confirmed in the catalog.'},followup);
assert.equal(state.records.find(r=>r.id===followup).data.reviewedBy,'owner');
fails(()=>save('followups',{status:'Pendente',review:'reopen'},followup),/preservada/);
assert.ok(state.events.some(e=>e.recordId===followup&&e.changes?.response?.to==='Preferences confirmed with client.'));
fails(()=>save('followups',{...followupData,assignedTo:'broker2'}),/precisa ter acesso/);
const due=save('followups',{...followupData,name:'Overdue example',dueAt:'2026-10-08T12:00'});
assert.equal(ops.operationsSummary(state,now).followups.overdue,1);
assert.equal(ops.operationsSummary(m.visibleState(state,b2),now).followups.overdue,0);

// Capture goals are manager-owned, real records counted in São Paulo month.
const goalData={name:'October property registrations',assignedTo:'broker1',month:'2026-10',purpose:'Venda',target:3};
fails(()=>save('captureGoals',goalData,undefined,b1),/permissão/);
fails(()=>save('captureGoals',{...goalData,target:1.5}),/inteiro/);
fails(()=>save('captureGoals',{...goalData,month:'2026-13'}),/AAAA-MM/);
const goal=save('captureGoals',goalData);
fails(()=>save('captureGoals',goalData),/Já existe/);
fails(()=>save('captureGoals',{target:1},goal,b1),/permissão/);
assert.equal(m.visibleState(state,b1).records.some(r=>r.id===goal),true);
assert.equal(m.visibleState(state,b2).records.some(r=>r.id===goal),false);
let progress=ops.captureGoalProgress(state,state.records.find(r=>r.id===goal));
assert.equal(progress.actual,1);assert.equal(progress.remaining,2);
save('properties',{name:'Previous local month',code:'OPS-02',purpose:'Venda',price:100000,status:'Disponível',assignedTo:'broker1'},undefined,owner,'2026-10-01T01:00:00.000Z');
assert.equal(ops.captureGoalProgress(state,state.records.find(r=>r.id===goal)).actual,1);

// Duty schedule validates dates, overlap, specialization and narrow visibility.
const shiftData={name:'Duty example',assignedTo:'broker2',startsAt:'2026-10-09T08:00',endsAt:'2026-10-09T18:00',purpose:'Ambos',status:'Ativo'};
fails(()=>save('shifts',shiftData,undefined,b2),/permissão/);
fails(()=>save('shifts',{...shiftData,endsAt:'2026-10-09T07:00'}),/terminar depois/);
fails(()=>save('shifts',{...shiftData,startsAt:'2026-02-30T08:00'}),/horário inválido/);
fails(()=>save('shifts',{...shiftData,assignedTo:'broker3',purpose:'Venda'}),/atuação/);
const shift=save('shifts',shiftData);
fails(()=>save('shifts',shiftData),/já tem um plantão/);
assert.equal(ops.activeShifts(state,now).length,1);
assert.equal(ops.activeShifts(state,'2026-10-09T21:00:00.000Z').length,0,'end is exclusive');
assert.equal(m.visibleState(state,b1).records.some(r=>r.id===shift),false);
assert.equal(m.visibleState(state,b2).records.some(r=>r.id===shift),true);
assert.equal(ops.recommendAssignees(state,'Venda','broker1',now)[0].id,'broker2');
assert.equal(ops.recommendAssignees(state,'Venda','broker1',now)[0].onDuty,true);
assert.equal(ops.recommendAssignees(state,'Venda','broker1',now).some(r=>r.id==='broker3'),false);

// Funnel prerequisites apply both to forms and atomic conversation registration.
configure({funnelEnabled:true,requireCompleteCatalog:true,requireAttendanceBeforeSchedule:true,requireVisitBeforeProposal:true});
fails(()=>save('cases',{stage:'Atendimento'},caseId,b1),/Complete o cadastro/);
const register=(action,data={})=>m.applyCommand(state,b1,{type:'register',caseId,requestId:crypto.randomUUID(),action,data},now);
fails(()=>register('attendance',{channel:'WhatsApp',outcome:'Contato realizado'}),/Complete o cadastro/);
save('people',{phone:'35999999999'},person,b1);
save('leads',{propertyType:'Apartamento',city:'Lavras',budgetMax:200000,bedrooms:0,parkingSpaces:0},lead,b1);
assert.equal(ops.catalogCompleteness(state,state.records.find(r=>r.id===lead)).complete,true);
const qualifiedLead=state.records.find(r=>r.id===lead);
for (const placeholder of ['Não informado','NAO INFORMADO','A definir',' Não definida ']) assert.equal(ops.catalogCompleteness(state,{...qualifiedLead,data:{...qualifiedLead.data,propertyType:placeholder}}).complete,false,'unknown placeholders are not qualification');
const visitData={name:'Visit',caseId,assignedTo:'broker1',type:'Visita',propertyId:property,dueAt:'2026-10-10T10:00',priority:'Normal',status:'Confirmada'};
fails(()=>save('tasks',visitData,undefined,b1),/Registre o atendimento/);
fails(()=>save('cases',{stage:'Agendamento'},caseId,b1),/Registre o atendimento/);
save('cases',{stage:'Atendimento'},caseId,b1);
const visit=save('tasks',visitData,undefined,b1);
save('cases',{stage:'Agendamento'},caseId,b1);
const proposalData={name:'Proposal',caseId,propertyId:property,amount:99000,conditions:'Example conditions',expiresAt:'2026-11-01',status:'Enviada'};
fails(()=>save('proposals',proposalData,undefined,b1),/visita realizada/);
fails(()=>register('proposal',{propertyId:property,amount:99000,conditions:'Example',expiresAt:'2026-11-01',status:'Enviada'}),/visita realizada/);
save('tasks',{status:'Realizada',dueAt:'2026-10-08T10:00'},visit,b1);
const proposal=save('proposals',proposalData,undefined,b1);
save('cases',{stage:'Proposta'},caseId,b1);

// Recommendation mode does not change owner assignments or bypass active work.
configure({reassignmentEnabled:true,reassignmentDays:30});
assert.equal(ops.redistributionCandidates(state,'2026-12-20T15:00:00.000Z').some(r=>r.leadId===lead),false,'sent proposal protects portfolio');
save('proposals',{status:'Recusada',reason:'Example refusal'},proposal);
const later='2026-12-20T15:00:00.000Z';
const before=JSON.stringify(state), suggestions=ops.redistributionCandidates(state,later);
assert.equal(suggestions.some(r=>r.leadId===lead),true);
assert.equal(suggestions.find(r=>r.leadId===lead).recommendations[0].id,'broker2');
assert.equal(JSON.stringify(state),before,'recommendations never reassign');
assert.equal(state.settings.distributionEnabled,false);
const futureTask=save('tasks',{...visitData,name:'Future protected appointment',dueAt:'2026-12-21T10:00'});
assert.equal(ops.redistributionCandidates(state,later).some(r=>r.leadId===lead),false,'future appointment protects portfolio');
save('tasks',{status:'Cancelada',reason:'Example cancellation'},futureTask);
configure({reassignmentEnabled:false});
assert.equal(ops.redistributionCandidates(state,later).length,0);
assert.equal(state.records.find(r=>r.id===lead).data.assignedTo,'broker1');
assert.equal(m.visibleState(state,b2).events.some(e=>e.recordId===due),false);
console.log('PASS operations domain: persistent manager accountability and review, tenant/portfolio isolation, protected broker permissions, complete/intake distinction, capture counts and São Paulo months, duty overlap/specialization, all funnel entry points, disabled-by-default rules, protected recommendation-only redistribution, atomic rejection and audit preservation.');
