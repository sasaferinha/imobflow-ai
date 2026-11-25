const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(options={}){
 const calls=[],network=[],cache=new Map();let reads=0;
 const db=async(resource,o={})=>{calls.push({resource,...o});assert.ok(resource.includes(`company_id=eq.${id(1)}&thread_id=eq.${id(2)}&id=eq.${id(3)}`));assert.ok(o.timeoutMs>0&&o.timeoutMs<=3000);if(o.method==='PATCH'){assert.ok(resource.includes('transcript_text=is.null'));assert.equal(o.prefer,'return=representation');return options.race?[]:[{transcript_text:o.body.transcript_text}];}if(reads++)return[{transcript_text:'Transcrição canônica concorrente'}];return[{direction:options.direction||'incoming',media_type:'audio',media_urls:[options.url||'https://scontent.xx.fbcdn.net/audio.ogg'],transcript_text:options.cached||null}];};
 const fetch=async(url,o)=>{url=String(url);network.push(url);assert.equal(o.redirect,'error');if(url==='https://api.openai.com/v1/audio/transcriptions'){assert.equal(o.headers.Authorization,'Bearer synthetic-key');assert.equal(o.body.get('file').type,'audio/ogg');return Response.json({text:options.providerText||'Quero uma casa no Centro.'});}assert.equal(o.credentials,'omit');if(options.redirect)throw Error('redirect forbidden');return new Response(options.bytes||Buffer.from('OggS synthetic fixture'),{headers:{'content-type':options.mime||'audio/ogg','content-length':String(options.length||20)}});};
 function load(file){if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{module:mod,exports:mod.exports,require:n=>n.endsWith('/supabase')?{supabaseServiceRequest:db}:n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(file),n))):require(n),process:{env:{OPENAI_API_KEY:'synthetic-key'}},Buffer,Date,URL,AbortSignal,Uint8Array,Blob,FormData,Response,fetch},{filename:file});return mod.exports;}
 return{api:load('social-audio'),calls,network};
}

// Exercise the actual webhook parser, inbox writer and transcription modules
// together. Only the persistence boundary and HTTP responses are synthetic.
function ingestionFixture(channel='instagram',loginProvider='instagram',mediaUrl='https://scontent.xx.fbcdn.net/audio.ogg'){
 const company=id(1),thread=id(2),messageId=id(3),accountId=id(4);
 const calls=[],network=[],cache=new Map(),stored=new Map();
 const connection={companyId:company,instagramId:channel==='instagram'?'456':undefined,pageId:loginProvider==='facebook'?'123':undefined,channel,loginProvider,databaseId:accountId,enabled:true,apiVersion:'v26.0'};
 const db=async(resource,o={})=>{
  calls.push({resource,...o});
  if(resource==='rpc/receive_social_message'){
   assert.equal(o.method,'POST');assert.equal(o.body.p_account_id,accountId);assert.equal(o.body.p_recipient_id,'777');
   const body=o.body;
   stored.set(messageId,{id:messageId,company_id:company,thread_id:thread,direction:'incoming',content:body.p_content,media_type:body.p_media_type,media_urls:body.p_media,transcript_text:null,occurred_at:body.p_occurred_at,status:'received'});
   return{saved:true,companyId:company,threadId:thread,leadId:body.p_lead_id,messageId};
  }
  assert(resource.startsWith('social_messages?'),'The pipeline never reads or writes WhatsApp storage');
  const query=new URLSearchParams(resource.split('?')[1]);
  assert.equal(query.get('company_id'),`eq.${company}`);assert.equal(query.get('thread_id'),`eq.${thread}`);assert.equal(query.get('id'),`eq.${messageId}`);
  const row=stored.get(messageId);if(!row)return[];
  if(o.method==='PATCH'){
   assert.equal(query.get('transcript_text'),'is.null');assert.equal(o.prefer,'return=representation');
   if(row.transcript_text)return[];
   row.transcript_text=o.body.transcript_text;
  }
  return[{...row}];
 };
 const fetch=async(url,o)=>{
  url=String(url);network.push(url);assert.equal(o.redirect,'error');assert.equal(o.cache,'no-store');
  if(url==='https://api.openai.com/v1/audio/transcriptions'){
   assert.equal(o.headers.Authorization,'Bearer synthetic-key');assert.equal(o.body.get('file').type,'audio/ogg');
   return Response.json({text:'Quero uma casa no Centro.'});
  }
  assert.equal(url,mediaUrl);assert.equal(o.credentials,'omit');
  return new Response(Buffer.from('OggS synthetic fixture'),{headers:{'content-type':'audio/ogg'}});
 };
 function load(file){
  if(cache.has(file))return cache.get(file);
  const mod={exports:{}};cache.set(file,mod.exports);
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib',file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const requireModule=name=>{
   if(!name.startsWith('.'))return require(name);
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
   if(target==='supabase')return{supabaseServiceRequest:db};
   if(target==='tenant-context')return{currentAccount:()=>null};
   if(target==='social-connections')return{encryptSocialToken:()=>assert.fail('Already-bound audio must not create a connection')};
   if(target==='leads'||target==='lead-import')return{};
   return load(target);
  };
  vm.runInNewContext(source,{module:mod,exports:mod.exports,require:requireModule,process:{env:{OPENAI_API_KEY:'synthetic-key'}},Buffer,Date,URL,URLSearchParams,AbortSignal,Uint8Array,Blob,FormData,Response,fetch},{filename:file});
  return mod.exports;
 }
 const meta=load('meta-social');
 const ingest=async(url)=>{
  const entryId=channel==='instagram'?'456':'123';
  const events=meta.parseSocialEvents({object:channel==='instagram'?'instagram':'page',entry:[{id:entryId,messaging:[{sender:{id:'777'},recipient:{id:entryId},timestamp:Date.now(),message:{mid:'synthetic-audio-1',attachments:[{type:'audio',payload:{url}}]}}]}]},[connection]);
  assert.equal(events.length,1);assert.equal(events[0].mediaType,'audio');
  await meta.saveSocialEvent(events[0]);
  return stored.get(messageId);
 };
 return{ingest,transcribe:()=>load('social-audio').transcribeSocialAudio(company,thread,messageId),project:row=>load('social-model').publicSocialMessage(row),calls,network};
}
(async()=>{
 let f=fixture();assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3)),'Quero uma casa no Centro.');assert.equal(f.network.length,2);assert.ok(f.calls.some(c=>c.method==='PATCH'));
 f=fixture({cached:'Texto já conferido'});assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3)),'Texto já conferido');assert.equal(f.network.length,0);
 f=fixture({race:true});assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3)),'Transcrição canônica concorrente','CAS loser returns stored text, not divergent inference');
 for(const url of ['http://fbcdn.net/a','https://fbcdn.net.evil.example/a','https://127.0.0.1/a','https://user:password@fbcdn.net/a','https://fbcdn.net:444/a']){f=fixture({url});assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3)),null);assert.equal(f.network.length,0,url);}
 for(const options of [{bytes:Buffer.from('<html>not audio</html>')},{mime:'text/html'},{length:16*1024*1024+1},{bytes:Buffer.concat([Buffer.from('OggS'),Buffer.alloc(16*1024*1024)]),length:20},{redirect:true}]){f=fixture(options);assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3)),null);assert.ok(!f.network.includes('https://api.openai.com/v1/audio/transcriptions'),'unsafe media never reaches transcription provider');}
 f=fixture({providerText:'x'.repeat(6001)});assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3)),null);assert.ok(!f.calls.some(c=>c.method==='PATCH'),'oversized transcription never persists');
 f=fixture();assert.equal(await f.api.transcribeSocialAudio('bad',id(2),id(3)),null);assert.equal(await f.api.transcribeSocialAudio(id(1),id(2),id(3),Date.now()+2000),null);assert.equal(f.calls.length,0);
 for(const [channel,provider,mediaUrl='https://scontent.xx.fbcdn.net/audio.ogg'] of [['instagram','instagram'],['instagram','facebook'],['facebook','facebook'],['instagram','instagram','https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=456&signature=synthetic']]){
  const pipeline=ingestionFixture(channel,provider,mediaUrl),row=await pipeline.ingest(mediaUrl);
  assert.deepEqual(Array.from(row.media_urls),[mediaUrl],'The webhook audio URL must survive the actual inbox write');
  assert.equal(row.media_type,'audio');assert.equal(pipeline.project(row).mediaType,'audio','Audio keeps its media type instead of becoming a photo');
  assert.equal(await pipeline.transcribe(),'Quero uma casa no Centro.');assert.equal(row.transcript_text,'Quero uma casa no Centro.');
  assert.deepEqual(pipeline.network,[mediaUrl,'https://api.openai.com/v1/audio/transcriptions']);
  assert.equal(await pipeline.transcribe(),row.transcript_text);assert.equal(pipeline.network.length,2,'The persisted transcript is reused without downloading the audio again');
 }
 const rejected=ingestionFixture(),unsafe=await rejected.ingest('https://attacker.example.org/audio.ogg');
 assert.equal(unsafe.media_urls.length,0);assert.equal(await rejected.transcribe(),null);assert.equal(rejected.network.length,0,'Untrusted webhook audio cannot reach a fetch');
 console.log('PASS social audio: actual parser -> inbox persistence -> transcription for native Instagram, legacy Instagram and Messenger; scoped stored media, HTTPS Meta CDN allowlist, redirects blocked, MIME/size/magic checks, cached text, transcription bounds and canonical CAS result.');
})().catch(error=>{console.error(error);process.exit(1);});
