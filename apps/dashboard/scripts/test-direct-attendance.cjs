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
   assert.equal(sent.length,1);assert.match(sent[0].text.body,/Quer comprar ou alugar/);
   assert.equal(calls.filter(c=>c.path==='rpc/enqueue_conversation_message').length,1);
   console.log('PASS chatbot queues a deterministic reply without n8n or OpenAI');
   // Exercise the actual reply/enqueue path, preserving each answer as the DB does.
   let profile={}, completionSends=[], deliveryCalls=0;
   const completion=load('lib/attendance.ts',{
     './supabase':{supabaseServiceRequest:async(path,options={})=>{
       if(path==='rpc/claim_attendance_reply')return true;
       if(path.startsWith('leads?'))return [{interest_profile:profile,goal:'Não informado',property_type:'Não informado',region:'Não informado',budget_max:null,updated_at:'2026-09-10T12:00:00Z'}];
       if(path==='rpc/merge_attendance_profile'){profile={...profile,...options.body.p_profile};return true;}
       if(path==='companies?id=eq.company-a&select=id,slug&limit=1')return [{id:'company-a',slug:'imobiliaria-a'}];
       if(path==='rpc/enqueue_conversation_message'){completionSends.push(options.body.p_content);return 'completion-queued';}
       assert.fail('Unexpected completion operation '+path);
     }},
     './conversation-settings':{readBusinessHours:async()=>load('lib/business-hours.ts').defaultBusinessHours},
     './business-hours':{businessTime:()=>({afterHours:false})},
     './message-outbox':{sendQueuedMessage:async()=>{deliveryCalls++;}},
   });
   const completionInput={companyId:'company-a',leadId:'lead-a',conversationId:'conversation-a',hasImage:false,recipientPhone:'5535999999999',phoneNumberId:'123456789',accessToken:'secret',apiVersion:'v26.0',occurredAt:new Date().toISOString()};
   const exact='Muito obrigado pelas informações! Estarei te encaminhando para um de nossos corretores.';
   for(const [index,message] of ['Comprar','Casa','Lavras','Centro','500 mil','não','3 quartos, sem garagem','sim'].entries()){
     await completion.respondToIncomingMessage({...completionInput,message,incomingExternalMessageId:`wamid.complete.${index}`});
     assert.equal(completionSends.at(-1)===exact,index===7,'completion only after explicit summary confirmation');
   }
   assert.equal(profile.parkingSpaces,0,'zero parking spaces completes qualification');
   assert.equal(deliveryCalls,8,'every queued response reaches the sender');
   for(const message of ['Oi','Obrigado'])assert.match(await completion.buildAttendanceReply({...completionInput,message}),/cadastro já está registrado/);
   profile={}; completionSends=[];
   await completion.respondToIncomingMessage({...completionInput,incomingExternalMessageId:'wamid.natural',message:'Quero comprar uma casa em Lavras, no bairro Centro, até 500 mil, com três quartos e duas vagas.'});
   assert.match(completionSends[0],/financiar ou comprar à vista/,'a complete natural sentence leaves financing before confirmation');
   await completion.respondToIncomingMessage({...completionInput,incomingExternalMessageId:'wamid.financing',message:'sim'});
   assert.equal(profile.financingIntent,'Sim');
   assert.match(completionSends[1],/https:\/\/www.imobflow.net.br\/simulador-financiamento\?empresa=imobiliaria-a/);
   assert.match(completionSends[1],/Está certo\?$/);
   await completion.respondToIncomingMessage({...completionInput,incomingExternalMessageId:'wamid.confirm',message:'sim'});
   assert.equal(completionSends[2],exact);
   assert.ok(!completionSends[1].includes(completionInput.companyId), 'simulator link must not expose the company id');
   assert.ok(!completionSends[1].includes(completionInput.leadId), 'simulator link must not expose the lead id');
   const financingProfile={purpose:'Venda',propertyType:'Casa',city:'Lavras',regions:['Centro'],budgetMax:500000,bedrooms:3,parkingSpaces:0};
   for(const [scenario,companies] of [
     ['missing',[]],
     ['mismatched company',[{id:'company-b',slug:'imobiliaria-b'}]],
     ['invalid slug',[{id:'company-a',slug:'other?empresa=imobiliaria-b'}]],
     ['missing slug',[{id:'company-a',slug:null}]],
     ['private id as slug',[{id:'company-a',slug:'company-a'}]],
     ['lookup failure',new Error('Database unavailable')],
   ]){
     let lookups=0;
     const fallback=load('lib/attendance.ts',{
       './supabase':{supabaseServiceRequest:async(path)=>{
         if(path.startsWith('leads?'))return [{interest_profile:financingProfile,goal:'Comprar',property_type:'Casa',region:'Centro',budget_max:500000,updated_at:'2026-09-10T12:00:00Z'}];
         if(path==='rpc/merge_attendance_profile')return true;
         assert.equal(path,'companies?id=eq.company-a&select=id,slug&limit=1','company lookup stays tenant-scoped');
         lookups++;
         if(companies instanceof Error)throw companies;
         return companies;
       }},
       './conversation-settings':{},
       './message-outbox':{},
     });
     const reply=await fallback.buildAttendanceReply({...completionInput,message:'sim'});
     assert.equal(lookups,1,scenario);
     assert.ok(reply.includes('https://www.imobflow.net.br/simulador-financiamento\n'),scenario+' must retain the public calculator');
     assert.ok(!reply.includes('?empresa='),scenario+' must not attach another or invalid company');
     assert.match(reply,/Está certo\?$/,scenario+' must preserve summary confirmation');
   }
   console.log('PASS financing links use only the matching public company slug and safely fall back on lookup failures');
   profile={purpose:'Venda',propertyType:'Casa'};
   assert.match(await completion.buildAttendanceReply({...completionInput,message:'não entendi'}),/nome da cidade/);
   assert.equal(profile.city,undefined,'unclear reply must not contaminate the profile');
   console.log('PASS full qualification queues and sends exact completion text, including zero spaces and later greetings');
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
   let aiCalls=0, aiInput, aiFailure=false, savedPatch;
   const aiAttendance=load('lib/attendance.ts',{
     './supabase':{supabaseServiceRequest:async(p,o={})=>{
       if(p.startsWith('leads?')) {assert.ok(p.includes('company_id=eq.company-a') && p.includes('id=eq.lead-a'));return [{interest_profile:{},goal:'Não informado',property_type:'Não informado',region:'Não informado',budget_max:null,updated_at:'v1'}];}
       if(p==='rpc/merge_attendance_profile'){assert.equal(o.body.p_company_id,'company-a');savedPatch=o.body.p_profile;return true;}
       throw new Error('Unexpected AI database operation');
     }},
     './ai/openai-provider':{configuredAIProvider:()=>({extractLeadProfile:async(input)=>{
       aiCalls++;aiInput=input;
       if(aiFailure)throw new Error('openai_429');
       return {data:{confidence:.99,requestsHumanHandoff:false,extractedFields:{transactionType:'BUY',propertyType:'HOUSE',city:'Lavras',neighborhoods:['Centro'],maxPrice:420000}}};
     }})},
   });
   const aiReply=await aiAttendance.buildAttendanceReply({...completionInput,message:'Tô atrás de um cantinho meu no centro de Lavras, uns quatrocentos e vinte mil no máximo'});
   assert.equal(aiCalls,1);assert.equal(savedPatch.budgetMax,420000);assert.equal(savedPatch.propertyType,'Casa');
   assert.match(aiReply,/financiar ou comprar à vista/);
   assert.deepEqual(Object.keys(aiInput).sort(),['currentProfile','message','recentMessages']);
   assert.equal(aiInput.recentMessages.length,1,'only current qualification question accompanies this lead profile');
   aiFailure=true;
   const fallback=await aiAttendance.buildAttendanceReply({...completionInput,message:'Quero comprar casa'});
   assert.match(fallback,/cidade/,'provider outage preserves a useful deterministic response');
   const callsBeforeGreeting=aiCalls;
   await aiAttendance.buildAttendanceReply({...completionInput,message:'Oi'});
   await aiAttendance.buildAttendanceReply({...completionInput,message:'Quero falar com um corretor'});
   assert.equal(aiCalls,callsBeforeGreeting,'greeting and human handoff do not wait for AI');
   console.log('PASS AI extraction wired to WhatsApp, scoped profile, structured save, provider failure fallback and greeting/handoff bypass');
   const fullProfile={purpose:'Venda',propertyType:'Casa',city:'Lavras',regions:['Centro'],budgetMax:400000,bedrooms:2,parkingSpaces:2,financingIntent:'Sim'};
   let mixedProfile={...fullProfile}, mixedPaused=false, mixedReplies=[], historyInput, modelHandoff=false;
   const understanding=load('lib/attendance.ts',{
     './supabase':{supabaseServiceRequest:async(p,o={})=>{
       if(p==='rpc/claim_attendance_reply')return !mixedPaused;
       if(p.startsWith('leads?'))return [{interest_profile:mixedProfile,goal:'Comprar',property_type:'Casa',region:'Centro',budget_max:400000,updated_at:'v1'}];
       if(p.startsWith('messages?')){
         assert.ok(p.includes('company_id=eq.company-a&conversation_id=eq.conversation-a'),'history is tenant and conversation scoped');
         assert.ok(p.includes('created_at=lte.'),'history excludes future turns');
         return [{direction:'outgoing',content:'Está certo?',external_message_id:'old-bot'}, {direction:'incoming',content:'Dois quartos',external_message_id:'old-client'}];
       }
       if(p==='rpc/merge_attendance_profile'){mixedProfile={...mixedProfile,...o.body.p_profile};return true;}
       if(p==='rpc/enqueue_conversation_message'){mixedReplies.push(o.body.p_content);return 'mixed-queued';}
       if(p.startsWith('conversations?')){assert.equal(o.body.bot_paused,true);mixedPaused=true;return null;}
       throw new Error('Unexpected mixed operation '+p);
     }},
     './ai/openai-provider':{configuredAIProvider:()=>({extractLeadProfile:async(input)=>{
       historyInput=input;
       return {data:{confidence:.99,summaryDecision:'confirmed',requestsHumanHandoff:modelHandoff,
         extractedFields:{transactionType:'BUY',propertyType:'HOUSE',city:'Lavras',neighborhoods:['Centro'],maxPrice:400000,minBedrooms:2,minParkingSpaces:2}}};
     }})},
     './conversation-settings':{readBusinessHours:async()=>load('lib/business-hours.ts').defaultBusinessHours},
     './business-hours':{businessTime:()=>({afterHours:true})},
     './message-outbox':{sendQueuedMessage:async()=>{}},
   });
   await understanding.respondToIncomingMessage({...completionInput,incomingExternalMessageId:'mixed-1',message:'Está certo , agora , preciso q vc me diga onde é a Apólo Imóveis'});
   assert.equal(mixedProfile.summaryConfirmed,true,'mixed confirmation is persisted before handoff');
   assert.match(mixedReplies[0],/Cadastro confirmado.*corretor/);
   assert.match(mixedReplies[0],/próximo horário comercial/);
   assert.ok(!mixedReplies[0].includes('Só para confirmar'));
   assert.equal(mixedPaused,true,'unknown address pauses bot for a broker');
   await understanding.respondToIncomingMessage({...completionInput,incomingExternalMessageId:'mixed-2',message:'Oi'});
   assert.equal(mixedReplies.length,1,'paused bot does not repeat the handoff');
   mixedProfile={...fullProfile};mixedPaused=false;
   const confirmation=await understanding.buildAttendanceReply({...completionInput,message:'É exatamente o que eu estou buscando'});
   assert.equal(confirmation,exact,'semantic confirmation survives model echo of unchanged fields');
   assert.equal(mixedProfile.summaryConfirmed,true);
   assert.equal(historyInput.recentMessages[0].content,'Dois quartos');
   assert.equal(historyInput.recentMessages.length,3,'real chronological context plus current question');
   mixedProfile={...fullProfile};modelHandoff=true;
   await understanding.respondToIncomingMessage({...completionInput,incomingExternalMessageId:'mixed-3',message:'Vocês aceitam meu carro na negociação?'});
   assert.equal(mixedPaused,true,'semantic handoff request is honored');
   assert.match(mixedReplies.at(-1),/direcionar sua conversa para um corretor/);
   const {confirmsSummary,changedPreferences}=load('lib/ai/conversation-understanding.ts');
   assert.equal(confirmsSummary('Está certo, mas quero mudar o bairro'),false);
   assert.deepEqual(JSON.parse(JSON.stringify(changedPreferences({city:'LAVRAS',regions:['centro']},fullProfile))),{});
   console.log('PASS Vinicius mixed confirmation/address regression, real scoped history, semantic handoff, no duplicate summary and paused follow-up');
 } finally {global.fetch=originalFetch;}
})().catch(error=>{console.error(error);process.exitCode=1});
