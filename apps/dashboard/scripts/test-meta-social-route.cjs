const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const company='11111111-1111-4111-a111-111111111111',foreign='22222222-2222-4222-a222-222222222222';
const env={META_APP_SECRET:'test-app-secret',META_SOCIAL_WEBHOOK_VERIFY_TOKEN:'social-token',META_WHATSAPP_WEBHOOK_VERIFY_TOKEN:'whatsapp-token',META_SOCIAL_CONNECTIONS:JSON.stringify([{companyId:company,pageId:'123',instagramId:'456',accessToken:'secret-never-output',enabled:true},{companyId:foreign,pageId:'234',instagramId:'567',accessToken:'foreign-secret',enabled:true}])};
const sessions=new Map([['a'.repeat(64),'owner'],['b'.repeat(64),'broker']].map(([token,role])=>[crypto.createHash('sha256').update(token).digest('hex'),{broker_id:`${role}-example`,company_id:company,name:'Synthetic user',company:'Synthetic company',role}]));
const calls=[],saved=[];let failSave=false;
async function db(resource,options={}){
  calls.push({resource,options});
  if(resource==='rpc/account_session')return sessions.has(options.body.p_hash)?[sessions.get(options.body.p_hash)]:[];
  assert.match(resource,/^leads\?/);assert.match(resource,new RegExp(`company_id=eq.${company}`));assert.doesNotMatch(resource,new RegExp(foreign));
  return [{id:'social-example',name:'Fictitious contact',source:'Instagram Direct',created_at:'2026-10-09T12:00:00Z',details:'Synthetic message',interest_profile:{socialMessages:[{id:'m1',text:'Synthetic',at:'2026-10-09T12:00:00Z'}]}}];
}
const cache=new Map();
function load(file){
  if(cache.has(file))return cache.get(file);
  const mod={exports:{}};cache.set(file,mod.exports);
  const requireLocal=specifier=>{
    if(specifier==='next/server')return{NextResponse:Response,NextRequest:Request};
    if(specifier==='@/lib/supabase'||specifier==='./supabase')return{supabaseRequest:db,supabaseServiceRequest:db};
    if(specifier==='@/lib/meta-social')return{...load('lib/meta-social.ts'),saveSocialEvent:async event=>{if(failSave)throw Error('synthetic-failure');saved.push(event);return {created:true};}};
    if(specifier==='./lead-import')return{importPhone:input=>input.replace(/\D/g,'')};
    if(specifier==='./leads')return{analyzeLead:()=>({score:0,temperature:'Frio'}),explainProfile:()=>''};
    if(specifier.startsWith('@/'))return load(specifier.slice(2)+'.ts');
    if(specifier.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier))+'.ts');
    return require(specifier);
  };
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{module:mod,exports:mod.exports,require:requireLocal,Date,Buffer,URL,URLSearchParams,Request,Response,Headers,AbortSignal,process:{env},console:{error:()=>{}},fetch:()=>{throw Error('External network denied in route test');}},{filename:file});return mod.exports;
}
const signature=body=>`sha256=${crypto.createHmac('sha256',env.META_APP_SECRET).update(body).digest('hex')}`;
function request(method,{token,query='',body,headers={}}={}){
  const req=new Request(`https://app.example.invalid/api/integrations/meta/social${query?'?'+query:''}`,{method,headers:{...headers},...(body===undefined?{}:{body})});
  req.nextUrl=new URL(req.url);req.cookies={get:name=>name==='imobflow_session'&&token?{value:token}:undefined};return req;
}
(async()=>{
  const api=load('app/api/integrations/meta/social/route.ts');
  assert.equal((await api.GET(request('GET'))).status,401);
  assert.equal((await api.GET(request('GET',{token:'b'.repeat(64)}))).status,403);
  const status=await api.GET(request('GET',{token:'a'.repeat(64),query:`company_id=${foreign}`}));
  assert.equal(status.status,200);assert.match(status.headers.get('cache-control'),/no-store/);
  const json=await status.json();assert.equal(json.data.facebook,true);assert.equal(json.data.inbox.length,1);assert.doesNotMatch(JSON.stringify(json),/secret-never-output|foreign-secret|accessToken/);
  const challenge='hub.mode=subscribe&hub.challenge=1234&hub.verify_token=';
  assert.equal((await api.GET(request('GET',{query:challenge+'wrong'}))).status,403);
  const accepted=await api.GET(request('GET',{query:challenge+'social-token'}));assert.equal(accepted.status,200);assert.equal(await accepted.text(),'1234');
  delete env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN;
  assert.equal((await api.GET(request('GET',{query:challenge+'whatsapp-token'}))).status,403,'missing social token does not fall back to WhatsApp');
  env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN='social-token';
  const body=JSON.stringify({object:'instagram',entry:[{id:'456',messaging:[{sender:{id:'777'},recipient:{id:'456'},timestamp:Date.now(),message:{mid:'m1',text:'Synthetic inquiry'}}]}]});
  assert.equal((await api.POST(request('POST',{body}))).status,401);assert.equal(saved.length,0);
  assert.equal((await api.POST(request('POST',{body,headers:{'x-hub-signature-256':'sha256=wrong'}}))).status,401);
  assert.equal((await api.POST(request('POST',{body:'{',headers:{'x-hub-signature-256':signature('{')}}))).status,400);
  assert.equal((await api.POST(request('POST',{body:'x'.repeat(262145)}))).status,413);
  assert.equal((await api.POST(request('POST',{body,headers:{'x-hub-signature-256':signature(body)}}))).status,200);
  assert.equal(saved.length,1);assert.equal(saved[0].connection.companyId,company);
  const unknown=JSON.stringify({object:'instagram',entry:[{id:'999',messaging:[{sender:{id:'777'},recipient:{id:'999'},message:{mid:'m2',text:'Ignore unbound account'}}]}]});
  assert.equal((await api.POST(request('POST',{body:unknown,headers:{'x-hub-signature-256':signature(unknown)}}))).status,200);assert.equal(saved.length,1);
  const largeSignedBatch=JSON.stringify({object:'instagram',entry:[{id:'456',messaging:Array.from({length:65},(_,index)=>({sender:{id:'777'},recipient:{id:'456'},timestamp:Date.now()-index*1000,message:{mid:`large-${index}`,text:'Synthetic bounded batch'}}))}]});
  assert.ok(Buffer.byteLength(largeSignedBatch)<262144);
  assert.equal((await api.POST(request('POST',{body:largeSignedBatch,headers:{'x-hub-signature-256':signature(largeSignedBatch)}}))).status,200);
  assert.equal(saved.length,66,'large signed batch progresses instead of failing before processing');
  failSave=true;assert.equal((await api.POST(request('POST',{body,headers:{'x-hub-signature-256':signature(body)}}))).status,503,'failed commit asks Meta retry, not false success');
  delete env.META_APP_SECRET;
  assert.equal((await api.POST(request('POST',{body,headers:{'x-hub-signature-256':'sha256='+'0'.repeat(64)}}))).status,401);
  assert.ok(calls.every(c=>c.resource==='rpc/account_session'||c.resource.startsWith('leads?')));
  console.log('PASS Meta social route: real session/ALS auth, owner-only tenant-scoped status, no credentials exposed, explicit handshake token, real HMAC, payload bounds, unsigned denial, unbound account ignore and retry on failed commit; no network or sends.');
})().catch(error=>{console.error(error);process.exit(1);});
