const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const calls = [], modules = new Map(); let saved;
async function db(url, options) {
  calls.push({url,options});
  if (url.startsWith('rpc/ensure_')) {
    const b = options.body;
    return saved = {id:b.p_id,company_id:b.p_company_id,case_key:b.p_case_key,property_key:b.p_property_key,property_name:b.p_property_name,token_hash:b.p_token_hash,visit_key:b.p_visit_key||null,expires_at:'2030-01-01T00:00:00Z',submitted_at:null};
  }
  if (url.startsWith('property_feedback_requests?')) return [saved];
  throw new Error(`Unexpected database operation: ${url}`);
}
function load(file) {
  const full = path.resolve(__dirname,'../lib/evolution',file.endsWith('.ts') ? file : file+'.ts');
  if (modules.has(full)) return modules.get(full);
  const mod={exports:{}};modules.set(full,mod.exports);
  const source=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module:mod,exports:mod.exports,require:name=>name==='node:crypto'?crypto:name==='../supabase'?{supabaseServiceRequest:db}:load(path.resolve(path.dirname(full),name)),crypto:crypto.webcrypto,structuredClone,URL,Date,Error,console,process:{env:{SUPABASE_SECRET_KEY:'synthetic-key-not-production',APP_BASE_URL:'https://example.test'}}});
  return mod.exports;
}
const m=load('model'),f=load('property-feedback');
const actor={companyId:'company',brokerId:'owner',role:'owner',name:'Owner'};
let state=m.emptyState('company');state.members=[{id:'owner',role:'owner',name:'Owner',specialization:'Ambos'}];
const now='2026-11-08T10:00:00Z', later='2026-11-08T11:00:00Z';
function save(kind,data){state=m.applyCommand(state,actor,{type:'save',kind,data},now);return state.records.at(-1).id;}
const person=save('people',{name:'Synthetic customer',personType:'Pessoa física',category:'Cliente',phone:'555100000000',assignedTo:'owner'});
const property=save('properties',{name:'Property A',code:'A001',purpose:'Venda',price:400000,status:'Disponível',assignedTo:'owner'});
const other=save('properties',{name:'Property B',code:'B001',purpose:'Venda',price:500000,status:'Disponível',assignedTo:'owner'});
const caseId=save('cases',{name:'Synthetic case',personId:person,source:'Site',assignedTo:'owner',purpose:'Venda',journey:'Negociação',stage:'Lead',status:'Aberto',propertyId:other});
const start={type:'visit-start',caseId,propertyId:property,requestId:crypto.randomUUID()};
state=m.applyCommand(state,actor,start,now);
const visit=state.records.find(row=>row.id===start.requestId);
assert.equal(visit.data.visitPersonId,person);assert.equal(visit.data.visitBrokerId,actor.brokerId);
assert.equal(m.visitStartReplay(state,actor,start),true);
assert.equal(m.applyCommand(state,actor,start,later).version,state.version,'retry does not create another version or visit');
const canonical=structuredClone(state);canonical.records.find(row=>row.id===start.requestId).id=`appointment:${start.requestId}`;
assert.equal(m.visitStartReplay(canonical,actor,start),true,'recognizes ID after canonical bridge renames it');
assert.throws(()=>m.applyCommand(state,actor,{...start,propertyId:other},now),/outra operação/);
assert.throws(()=>m.applyCommand(state,actor,{...start,requestId:crypto.randomUUID()},now),/em andamento/);
state=m.applyCommand(state,actor,{type:'visit-progress',id:start.requestId,action:'finish'},later);
assert.equal(state.records.find(row=>row.id===start.requestId).data.clientFeedback,'','broker note optional');
assert.equal(f.feedbackProperty(state,state.records.find(row=>row.id===caseId),start.requestId).id,property,'visit property overrides unrelated case property');
const second={...start,propertyId:other,requestId:crypto.randomUUID()};state=m.applyCommand(state,actor,second,now);state=m.applyCommand(state,actor,{type:'visit-progress',id:second.requestId,action:'finish'},later);
assert.throws(()=>f.feedbackProperty(state,state.records.find(row=>row.id===caseId)),/Escolha a visita/,'ambiguous old client must choose');
assert.equal(f.feedbackProperty(state,state.records.find(row=>row.id===caseId),second.requestId).id,other);
assert.throws(()=>f.feedbackProperty(state,state.records.find(row=>row.id===caseId),'missing'),/Encerre/);
assert.equal(f.validateFeedbackAnswer({propertyScore:5}).visitScore,null);assert.equal(f.validateFeedbackAnswer({propertyScore:5}).interest,null);
assert.equal(f.validateFeedbackAnswer({propertyScore:0}),null);assert.equal(f.validateFeedbackAnswer({propertyScore:6}),null);assert.equal(f.validateFeedbackAnswer({propertyScore:5,comment:'a'.repeat(2001)}),null);
assert.equal(f.validateFeedbackAnswer({propertyScore:4,visitScore:0,interest:'Talvez',comment:'Legacy response'}).visitScore,0,'legacy fields accepted');
(async()=>{
  const result=await f.ensureCaseFeedback(actor,state,caseId,true,start.requestId);
  assert.match(result.reason,/nenhuma mensagem/);
  assert.equal(calls.filter(call=>call.url.startsWith('rpc/')).length,1);
  assert.equal(calls[0].url,'rpc/ensure_visit_feedback_request');assert.equal(calls[0].options.body.p_visit_key,start.requestId);assert.equal(calls[0].options.body.p_property_key,property);
  assert.equal(result.requests[0].url,`https://example.test/avaliacao/${f.feedbackToken(saved.id)}`);
  console.log('PASS visits and feedback: one-click start/end, canonical retry, property binding, ambiguous visits denied, legacy answers, manual-only link creation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
