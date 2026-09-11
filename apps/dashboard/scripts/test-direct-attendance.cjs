const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
function load(relative, overrides={}) {
 const source=fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 const localRequire=name=>overrides[name] || (name.startsWith('.') ? load(path.posix.join(path.posix.dirname(relative),name+'.ts'),overrides) : require(name));
 vm.runInNewContext(output,{module,exports:module.exports,require:localRequire,process:{env:{}},Date,Intl,AbortSignal,fetch:global.fetch,console,URL,URLSearchParams});
 return module.exports;
}
(async()=>{
 let calls=[],sent=[];
 const supabaseServiceRequest=async(path,options={})=>{
   calls.push({path,options});
   if(path==='rpc/claim_attendance_reply') return true;
   if(path==='rpc/enqueue_conversation_message') {sent.push({text:{body:options.body.p_content}});return 'queued';}
   if(path==='rpc/merge_attendance_profile')return true;
   if(path.startsWith('leads?')) return [{interest_profile:{},goal:'Não informado',property_type:'Não informado',region:'Não informado',budget_max:null,updated_at:'2026-09-10T12:00:00Z'}];
   if(path.startsWith('messages?')) return [];
   if(path==='rpc/finish_attendance_reply') return null;
   throw new Error('Unexpected '+path);
 };
 const originalFetch=global.fetch;
 global.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({messages:[{id:'wamid.accepted'}]})}};
 try {
   const api=load('lib/attendance.ts',{
     './supabase':{supabaseServiceRequest},
     './conversation-settings':{readBusinessHours:async()=>load('lib/business-hours.ts').defaultBusinessHours},
     './message-outbox':{sendQueuedMessage:async()=>{}},
     './ai/openai-provider':{configuredAIProvider:()=>null},
     './ai/qualification':load('lib/ai/qualification.ts'),
   });
   await api.respondToIncomingMessage({companyId:'00000000-0000-4000-8000-000000000001',leadId:'00000000-0000-4000-8000-000000000002',conversationId:'00000000-0000-4000-8000-000000000003',incomingExternalMessageId:'wamid.in',message:'Quero apartamento',hasImage:false,recipientPhone:'5535999999999',phoneNumberId:'123456789',accessToken:'secret',apiVersion:'v26.0',occurredAt:new Date().toISOString()});
   assert.equal(api.attendanceTime(new Date('2026-09-10T20:59:00Z')).afterHours,false);
   assert.equal(api.attendanceTime(new Date('2026-09-10T21:00:00Z')).afterHours,true);
   assert.equal(sent.length,1);assert.match(sent[0].text.body,/(comprar ou alugar|fora do horário)/);
   assert.equal(calls.filter(c=>c.path==='rpc/enqueue_conversation_message').length,1);
   console.log('PASS chatbot queues a deterministic reply without n8n or OpenAI');
   sent=[]; calls=[]; const noClaim=load('lib/attendance.ts',{
     './supabase':{supabaseServiceRequest:async path=>path==='rpc/claim_attendance_reply'?false:assert.fail('duplicate continued')},
     './conversation-settings':{readBusinessHours:async()=>load('lib/business-hours.ts').defaultBusinessHours},
     './message-outbox':{sendQueuedMessage:async()=>assert.fail('duplicate sent')},
     './ai/openai-provider':{configuredAIProvider:()=>null},'./ai/qualification':load('lib/ai/qualification.ts')});
   await noClaim.respondToIncomingMessage({companyId:'00000000-0000-4000-8000-000000000001',leadId:'00000000-0000-4000-8000-000000000002',conversationId:'00000000-0000-4000-8000-000000000003',incomingExternalMessageId:'wamid.in',message:'oi',hasImage:false,recipientPhone:'5535999999999',phoneNumberId:'123456789',accessToken:'secret',apiVersion:'v26.0',occurredAt:new Date().toISOString()});
   assert.equal(sent.length,0);console.log('PASS duplicate inbound event cannot send a second chatbot reply');
   // A prior away reply must not consume a later, distinct human-handoff request.
   let paused=0,queued=0; const claimedKeys=new Set();
   const handoff=load('lib/attendance.ts',{
     './supabase':{supabaseServiceRequest:async(path,options={})=>{
       if(path==='rpc/claim_attendance_reply') {
         const key=options.body.p_key;
         if(key.startsWith('after-hours:') || claimedKeys.has(key))return false;
         claimedKeys.add(key);return true;
       }
       if(path==='rpc/enqueue_conversation_message'){queued++;return 'handoff-message';}
       if(path.startsWith('conversations?') && options.method==='PATCH') {
         assert.equal(options.body.bot_paused,true);
         assert.match(path,/company_id=eq.company-a&id=eq.conversation-a/);paused++;return null;
       }
       assert.fail('Unexpected handoff operation '+path);
     }},
     './conversation-settings':{readBusinessHours:async()=>({...load('lib/business-hours.ts').defaultBusinessHours,timeZone:'UTC',holidays:[new Date().toISOString().slice(0,10)]})},
     './message-outbox':{sendQueuedMessage:async()=>{}},
   });
   const handoffInput={companyId:'company-a',leadId:'lead-a',conversationId:'conversation-a',incomingExternalMessageId:'wamid.handoff',message:'Quero falar com um corretor',hasImage:false,recipientPhone:'5535999999999',phoneNumberId:'123456789',accessToken:'secret',apiVersion:'v26.0',occurredAt:new Date().toISOString()};
   await handoff.respondToIncomingMessage(handoffInput);
   assert.equal(paused,1,'human request must pause bot even after an away reply');
   assert.equal(queued,1);
   await handoff.respondToIncomingMessage(handoffInput);
   assert.equal(paused,1,'replayed event must not pause a subsequently resumed bot');
   assert.equal(queued,1,'handoff must not duplicate its reply');
   console.log('PASS after-hours handoff is independent of away-message deduplication and remains idempotent');
   const {manualWhatsAppDraft}=load('lib/opportunities.ts',{'./tenant-context':{},'./supabase':{},'./property-matching':load('lib/property-matching.ts')});
   const draft=manualWhatsAppDraft({phone:'(35) 99999-9999',name:'João Silva',title:'Residencial X',district:'Centro',city:'Lavras',price:570000,bedrooms:3,purpose:'Venda'});
   assert.match(draft.url,/wa\.me\/5535999999999/);assert.match(decodeURIComponent(draft.url),/R\$ 570\.000/);assert.match(draft.message,/João/);
   console.log('PASS manual WhatsApp handoff uses the correct phone and deterministic prepared message');
 } finally {global.fetch=originalFetch;}
})().catch(error=>{console.error(error);process.exitCode=1});
