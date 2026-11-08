const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={companyId:id(1),threadId:id(2),leadId:id(3),messageId:id(4)};
function fixture(options={}){
 let now=Date.now(),claims=0;const sent=[],calls=[],finished=[],profile={interestProfile:{city:'Lavras'},goal:'Venda',region:'Centro',propertyType:'Casa',budgetMin:null,budgetMax:500000};
 const thread={...input,mode:'automatic',incomingMessageId:input.messageId,lead:{interest_profile:{city:'Lavras'}},profileSnapshot:profile,messages:[{id:input.messageId,direction:'incoming',text:'Busco imóvel',mediaType:null}]};Object.assign(thread,options.thread||{});
 const mod={exports:{}};const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/social-ai.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const modules={
  './supabase':{supabaseServiceRequest:async(resource,o={})=>{calls.push({resource,...o});assert.ok(o.timeoutMs>0&&o.timeoutMs<=3000);if(resource==='rpc/claim_social_ai_job')return options.noJob||claims++?null:{...input,leaseId:o.body.p_lease_id,attempts:1};if(resource==='rpc/finish_social_ai_job'){finished.push(o.body);return true;}if(resource.startsWith('social_ai_turns?'))return options.prior?[{reply:'Resposta persistida',handoff:true}]:[];if(resource==='rpc/prepare_social_ai_turn'){assert.equal(o.body.p_expected_profile,profile);return{ready:!options.conflict,reply:options.prior?'Resposta persistida':o.body.p_reply,handoff:!!options.prior};}if(resource==='rpc/finish_social_ai_turn')return;throw Error(resource);}},
  './social-messaging':{readSocialThreadForAI:async()=>thread,sendSocialAutomatedMessage:async o=>{sent.push(o);return{messages:[{status:options.status||'sent'}]};}},
  './social-model':{socialUuid:v=>/^[-0-9a-f]{36}$/.test(v),publicSocialProfile:v=>v},'./social-audio':{transcribeSocialAudio:async()=>null},
  './ai/basic-qualification':{basicPreferences:()=>({budgetMax:500000}),requestsHuman:()=>false},
  './ai/openai-provider':{configuredAIProvider:()=>options.provider?{extractLeadProfile:async()=>{if(options.prior)throw Error('Persisted turn must not infer again');now+=options.delay||0;return{data:{requestsHumanHandoff:false}};}}:null},
  './ai/qualification':{extractedPreferences:()=>({}),qualificationQuestion:()=> 'Qual bairro?',toAIProfile:v=>v,QUALIFICATION_COMPLETE_MESSAGE:'Complete'},
  './ai/conversation-understanding':{needsBrokerAnswer:()=>false},'./ai/tenant-settings-server':{readTenantAISettings:async()=>({automaticMode:'qualify'})},
  './ai/tenant-runtime':{tenantQualificationQuestion:(_p,_s,q)=>q,serviceAllowed:()=>true,unsupportedServiceReply:()=> 'Unsupported',handoffCopy:(_s,text)=>text},
 };
 class Clock extends Date{static now(){return now;}}
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:n=>modules[n]||require(n),Date:Clock,console},{filename:'social-ai.ts'});
 return{api:mod.exports,sent,calls,finished,now:()=>now};
}
(async()=>{
 let f=fixture();await f.api.processSocialAI(input);assert.equal(f.sent.length,1);assert.equal(f.sent[0].requestId,input.messageId);assert.equal(f.finished[0].p_outcome,'done');assert.ok(f.calls.some(c=>c.resource==='rpc/prepare_social_ai_turn'));
 f=fixture({noJob:true});await f.api.processSocialAI(input);assert.equal(f.sent.length,0,'webhook cannot invent an unpersisted job');
 f=fixture({thread:{incomingMessageId:id(9)}});await f.api.processSocialAI(input);assert.equal(f.sent.length,0);assert.equal(f.finished[0].p_outcome,'done','stale event is skipped');
 f=fixture({conflict:true});await f.api.processSocialAI(input);assert.equal(f.sent.length,0,'profile conflict never sends');assert.equal(f.finished[0].p_outcome,'done');
 f=fixture({prior:true,provider:true});await f.api.processSocialAI(input);assert.equal(f.sent[0].content,'Resposta persistida');assert.equal(f.sent[0].requestId,input.messageId);assert.ok(f.calls.some(c=>c.resource==='rpc/finish_social_ai_turn'));
 f=fixture({status:'unknown'});await f.api.processSocialAI(input);assert.equal(f.finished[0].p_outcome,'failed','uncertain provider delivery goes to human, never blind retry');
 f=fixture({status:'sending'});await f.api.processSocialAI(input);assert.equal(f.finished[0].p_outcome,'retry');
 f=fixture({provider:true,delay:15000});const start=f.now();const recovery=await f.api.recoverSocialAI();assert.equal(recovery.deferred,1);assert.equal(f.sent.length,0,'bounded recovery persists retry before deadline');assert.ok(f.now()-start<=20000);assert.equal(f.finished[0].p_error_code,'deadline');
 f=fixture();await f.api.recoverSocialAI(f.now()+5000);assert.equal(f.calls.length,0,'short remaining cron budget does not burn another attempt');
 console.log('PASS social AI engine: durable claim required, watermark/profile conflicts, stable persisted request and reply, no uncertain resend, terminal handoff and bounded cron recovery.');
})().catch(error=>{console.error(error);process.exit(1);});
