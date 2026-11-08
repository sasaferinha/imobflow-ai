const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),thread=id(50),account={companyId:company,brokerId:id(11),role:'owner',name:'Owner'};
const messages=new Map(),batches=new Map(),calls=[],network=[];let provider='ok',nextId=100;
let clockOffset=0;
class TestDate extends Date { static now(){return Date.now()+clockOffset;} }
async function db(resource,options={}){
 calls.push(resource);const b=options.body;
 if(resource==='rpc/enqueue_social_batch'){
  assert.equal(b.p_company_id,company);const old=batches.get(b.p_key);const signature=JSON.stringify([b.p_thread_id,b.p_parts,b.p_source,b.p_actor_id]);if(old){assert.equal(signature,old.signature);return old.ids;}
  const ids=b.p_parts.map(p=>{const key=id(++nextId);messages.set(key,{id:key,company_id:company,thread_id:thread,content:p.content,media_urls:p.media,source:b.p_source,status:'pending',direction:'outgoing',occurred_at:new Date().toISOString()});return key;});batches.set(b.p_key,{ids,signature});return ids;
 }
 if(resource==='rpc/claim_social_message'){const m=messages.get(b.p_message_id);if(m.status!=='pending')return null;m.status='sending';return{messageId:m.id,threadId:thread,accountId:id(55),recipientId:'777',content:m.content,mediaUrls:m.media_urls};}
 if(resource.startsWith('social_accounts?')){assert.ok(resource.includes(`company_id=eq.${company}`));return[{id:id(55),company_id:company,channel:'instagram',account_id:'456',page_id:'123',enabled:true,token_ciphertext:'protected',api_version:'v26.0'}];}
 if(resource.startsWith('social_threads?'))return[];
 if(resource.startsWith('social_messages?')){
  const q=new URLSearchParams(resource.split('?')[1]);assert.equal(q.get('company_id'),`eq.${company}`);let rows=[...messages.values()];if(q.get('id')?.startsWith('eq.'))rows=rows.filter(m=>m.id===q.get('id').slice(3));if(q.get('id')?.startsWith('in.'))rows=rows.filter(m=>q.get('id').includes(m.id));if(q.has('status'))rows=rows.filter(m=>m.status===q.get('status').slice(3));if(options.method==='PATCH'){rows.forEach(m=>Object.assign(m,b));return undefined;}return rows;
 }
 throw Error(`Unexpected resource ${resource}`);
}
const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);const src=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(src,{module:mod,exports:mod.exports,require:s=>s==='node:crypto'?crypto:s==='./supabase'?{supabaseServiceRequest:db}:s==='./tenant-context'?{currentAccount:()=>account}:s==='./social-connections'?{decryptSocialToken:()=> 'test-token',encryptSocialToken:()=> 'protected'}:s==='./meta-social'?{socialLeadId:()=>id(51)}:load(s.slice(2)),Buffer,Date:TestDate,URL,AbortSignal,process:{env:{META_APP_SECRET:'test-secret'}},fetch:async(url,options)=>{network.push({url,body:JSON.parse(options.body)});assert.equal(url,'https://graph.facebook.com/v26.0/123/messages');assert.equal(JSON.parse(options.body).recipient.id,'777');assert.equal(options.headers.Authorization,'Bearer test-token');assert.equal(options.redirect,'error');if(provider==='timeout')throw new Error('simulated network interruption');if(provider==='rate')return Response.json({error:{code:4}},{status:429});if(provider==='slow')clockOffset+=12000;return Response.json({message_id:`mid.${network.length}`,recipient_id:'777'});}},{filename:file});return mod.exports;}
(async()=>{
 const m=load('social-messaging'),model=load('social-model');
 const sent=await m.sendSocialMessage({threadId:thread,content:'Texto',requestId:id(70),images:['https://cdn.facebook.com/photo.jpg']});assert.equal(sent.messages.length,2);assert.ok(sent.messages.every(m=>m.status==='sent'));assert.equal(network.length,2);assert.equal(network[0].body.message.text,'Texto');assert.equal(network[1].body.message.attachment.type,'image');
 await m.sendSocialMessage({threadId:thread,content:'Texto',requestId:id(70),images:['https://cdn.facebook.com/photo.jpg']});assert.equal(network.length,2,'HTTP replay does not dispatch again');
 provider='timeout';const uncertain=await m.sendSocialMessage({threadId:thread,content:'Maybe',requestId:id(71)});assert.equal(uncertain.messages[0].status,'unknown');await m.sendSocialMessage({threadId:thread,content:'Maybe',requestId:id(71)});assert.equal(network.length,3,'uncertain sends never automatically retried');
 provider='rate';const limited=await m.sendSocialMessage({threadId:thread,content:'Rate',requestId:id(72),images:['https://cdn.facebook.com/photo.jpg']});assert.equal(limited.messages[0].status,'failed');assert.equal(limited.messages[1].status,'failed');assert.equal(network.length,4,'later parts not sent after refusal');
 assert.equal(m.socialSendFailure(400,{error:{code:190}}).code,'token_expired');assert.equal(m.socialSendFailure(400,{error:{error_subcode:2534022}}).code,'window_closed');assert.equal(m.socialSendFailure(503,{}).uncertain,true);
 await assert.rejects(()=>m.sendSocialMessage({threadId:thread,content:'x',requestId:id(73),images:['file:///secret']}));
 const beforeDeadline=calls.length;
 await assert.rejects(()=>m.sendSocialMessage({threadId:thread,content:'Expired',requestId:id(74),deadline:TestDate.now()+1000}),/preparação demorou/);
 assert.equal(calls.length,beforeDeadline,'expired preparation cannot even enqueue an intent');
 provider='slow';const beforeSlow=network.length,slowInput={threadId:thread,content:'Six parts',requestId:id(75),images:Array.from({length:5},(_,n)=>`https://cdn.facebook.com/photo-${n}.jpg`)};
 const bounded=await m.sendSocialMessage(slowInput);
 assert.equal(network.length-beforeSlow,3,'bounded request stops before starting the fourth slow provider send');
 assert.equal(bounded.messages.filter(item=>item.status==='sent').length,3);
 assert.equal(bounded.messages.filter(item=>item.status==='failed').length,3);
 assert([...messages.values()].filter(item=>item.error_code==='manual_deadline').length===3,'unsent manual parts are persisted as not sent, not a future queue');
 await m.sendSocialMessage(slowInput);assert.equal(network.length-beforeSlow,3,'retry never dispatches cancelled or confirmed parts');
 clockOffset=0;
 const profile=model.publicSocialProfile({regions:['Centro'],summaryConfirmed:true,socialSenderId:'sensitive',socialMessages:[{text:'private'}],financingIntent:'Sim'});assert.equal(profile.summaryConfirmed,true);assert.equal(profile.socialSenderId,undefined);assert.equal(profile.socialMessages,undefined);
 assert.ok(calls.every(resource=>!resource.includes('message_outbox')&&!resource.startsWith('messages?')));
 console.log('PASS social dispatch: correct provider account/recipient, separate text/photo parts, persistent dedup, uncertain no-retry, rate abort, safe profile and no WhatsApp fallback.');
})().catch(error=>{console.error(error);process.exit(1);});
