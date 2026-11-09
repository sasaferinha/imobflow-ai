const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
const company='11111111-1111-4111-a111-111111111111',foreign='22222222-2222-4222-a222-222222222222',broker='33333333-3333-4333-a333-333333333333';
const ownerToken='a'.repeat(64),brokerToken='b'.repeat(64),digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const env={NODE_ENV:'production',META_APP_ID:'123456',META_APP_SECRET:'synthetic-app-secret',META_SOCIAL_WEBHOOK_VERIFY_TOKEN:'synthetic-webhook'};
const oauth=new Map(),authorizations=new Map(),binds=[],network=[];
let activeOwner=true,allowRate=true,allowInstagramFields=false,hasInstagram=false,foreignPage=false;
async function db(resource,options={}){
 const b=options.body;
 if(resource==='rpc/account_session')return b.p_hash===digest(ownerToken)||b.p_hash===digest(brokerToken)?[{company_id:company,broker_id:broker,name:'Synthetic owner',company:'Synthetic company',role:b.p_hash===digest(ownerToken)?'owner':'broker'}]:[];
 if(resource==='rpc/consume_rate_limit')return allowRate;
 if(resource==='social_oauth_requests'&&options.method==='POST'){oauth.set(b.state_hash,{...b});return;}
 if(resource.startsWith('social_oauth_requests?')&&options.method==='DELETE'){
  const hash=new URLSearchParams(resource.split('?')[1]).get('state_hash').slice(3),row=oauth.get(hash);
  if(!row||Date.parse(row.expires_at)<=Date.now())return[];
  oauth.delete(hash);return[row];
 }
 if(resource.startsWith('broker_accounts?')){assert.ok(resource.includes(`company_id=eq.${company}`));assert.ok(resource.includes(`id=eq.${broker}`));return activeOwner?[{id:broker}]:[];}
 if(resource.startsWith('social_authorizations?')){
  if(options.method==='POST'){assert.equal(b.company_id,company);assert.equal(b.broker_id,broker);authorizations.set(b.company_id,{...b});return;}
  assert.ok(resource.includes(`company_id=eq.${company}`));return authorizations.has(company)?[authorizations.get(company)]:[];
 }
 if(resource.startsWith('social_accounts?')){
  if(resource.includes('page_id=eq.123'))return foreignPage?[{company_id:foreign}]:[];
  assert.ok(resource.includes(`company_id=eq.${company}`));return[];
 }
 if(resource==='rpc/bind_social_account'){assert.equal(b.p_company_id,company);assert.equal(b.p_actor_id,broker);binds.push(b);return;}
 throw Error('Unexpected DB resource: '+resource);
}
async function fakeFetch(input,options={}){
 const url=new URL(input),body=new URLSearchParams(options.body);network.push({url,method:options.method,body,authorization:options.headers.Authorization});
 assert.equal(url.origin,'https://graph.facebook.com');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
 if(url.pathname==='/v26.0/oauth/access_token')return Response.json({access_token:body.has('grant_type')?'synthetic-user-token':'synthetic-short-token',expires_in:3600});
 if(url.pathname==='/v26.0/me/accounts'){
  assert.equal(options.headers.Authorization,'Bearer synthetic-user-token');
  if(url.searchParams.get('fields').includes('instagram')&&!allowInstagramFields)return Response.json({error:{code:100}},{status:400});
  return Response.json({data:[{id:'123',name:'Synthetic Page',access_token:'synthetic-page-token',...(hasInstagram?{instagram_business_account:{id:'456',username:'synthetic_ig'}}:{})}]});
 }
 if(url.pathname==='/v26.0/123/subscribed_apps'){
  assert.equal(options.headers.Authorization,'Bearer synthetic-page-token');assert.equal(options.method,'POST');assert.ok(body.get('subscribed_fields').split(',').includes('leadgen'));return Response.json({success:true});
 }
 throw Error('Unexpected provider path: '+url.pathname);
}
class TestResponse extends Response{
 constructor(body,options){super(body,options);this.testCookies=[];this.cookies={set:(name,value,config)=>this.testCookies.push({name,value,config})};}
 static json(value,options){return new TestResponse(JSON.stringify(value),{...options,headers:{'Content-Type':'application/json',...options?.headers}});}
 static redirect(value){return new TestResponse(null,{status:307,headers:{Location:String(value)}});}
}
const cache=new Map();function load(file){
 if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);
 const requireLocal=s=>{
  if(s==='next/server')return{NextRequest:Request,NextResponse:TestResponse};
  if(s==='@/lib/supabase'||s==='./supabase')return{supabaseRequest:db,supabaseServiceRequest:db};
  if(s==='./meta-social')return{socialConnections:()=>[]};
  if(s.startsWith('@/'))return load(s.slice(2)+'.ts');
  if(s.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),s))+'.ts');
  return require(s);
 };
 const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module:mod,exports:mod.exports,require:requireLocal,Buffer,Date,URL,URLSearchParams,Request,Response,Headers,AbortSignal,process:{env},fetch:fakeFetch,console:{error:()=>{}}},{filename:file});return mod.exports;
}
function request(method,{body,query='',token=ownerToken,state,origin='https://app.example.invalid'}={}){
 const req=new Request('https://app.example.invalid/api/integrations/meta/social/connections'+(query?'?'+query:''),{method,headers:{...(origin?{origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 req.nextUrl=new URL(req.url);req.cookies={get:name=>name==='imobflow_session'&&token?{value:token}:name==='imobflow_meta_social_state'&&state?{value:state}:undefined};return req;
}
(async()=>{
 const api=load('app/api/integrations/meta/social/connections/route.ts'),callback=load('app/api/integrations/meta/social/callback/route.ts'),lib=load('lib/social-connections.ts');
 assert.equal((await api.POST(request('POST',{token:null,body:{action:'connect',channel:'facebook'}}))).status,401);
 assert.equal((await api.POST(request('POST',{token:brokerToken,body:{action:'connect',channel:'facebook'}}))).status,403);
 assert.equal((await api.POST(request('POST',{origin:'https://attacker.invalid',body:{action:'connect',channel:'facebook'}}))).status,403);
 assert.equal((await api.POST(request('POST',{origin:'',body:{action:'connect',channel:'facebook'}}))).status,403);
 assert.equal((await api.POST(request('POST',{body:{action:'connect',channel:'facebook',companyId:foreign}}))).status,400);
 for(const channel of [null,'','whatsapp',[],0])assert.equal((await api.POST(request('POST',{body:{action:'connect',channel}}))).status,400);
 allowRate=false;assert.equal((await api.POST(request('POST',{body:{action:'connect',channel:'facebook'}}))).status,429);allowRate=true;
 assert.equal(oauth.size,0,'invalid, foreign-origin and unauthenticated requests never create OAuth state');
 const connected=await api.POST(request('POST',{body:{action:'connect',channel:'facebook'}}));assert.equal(connected.status,200);assert.match(connected.headers.get('cache-control'),/no-store/);
 const publicBody=await connected.json(),url=new URL(publicBody.url),scopes=url.searchParams.get('scope').split(','),state=url.searchParams.get('state');
 assert.equal(url.origin,'https://www.facebook.com');assert.match(state,/^[a-f0-9]{64}$/);assert.ok(scopes.includes('pages_messaging'));assert.ok(scopes.includes('leads_retrieval'));assert.ok(!scopes.some(s=>s.startsWith('instagram')),'Facebook-only consent never requires an Instagram asset');
 assert.equal(url.searchParams.get('redirect_uri'),'https://app.example.invalid/api/integrations/meta/social/callback');
 assert.equal(connected.testCookies[0].value,state);assert.equal(connected.testCookies[0].config.httpOnly,true);assert.equal(connected.testCookies[0].config.secure,true);assert.equal(connected.testCookies[0].config.sameSite,'lax');
 const stored=oauth.get(digest(state));assert.equal(stored.company_id,company);assert.equal(stored.broker_id,broker);assert.ok(!JSON.stringify(stored).includes(state),'only nonce hash is stored');
 for(const channel of ['instagram',undefined]){
  const response=await api.POST(request('POST',{body:{action:'connect',...(channel?{channel}:{})}}));assert.equal(response.status,200);const scope=new URL((await response.json()).url).searchParams.get('scope');assert.match(scope,/instagram_basic/);assert.match(scope,/instagram_manage_messages/);
 }
 const beforeCallback=network.length;
 await assert.rejects(()=>lib.finishSocialOAuth(state,'0'.repeat(64),'synthetic-code-123'));
 assert.equal(network.length,beforeCallback,'mismatched cookie cannot exchange an authorization code');assert.ok(oauth.has(digest(state)));
 const returned=await callback.GET(request('GET',{token:null,state,query:new URLSearchParams({state,code:'synthetic-code-123',companyId:foreign,channel:'instagram'}).toString()}));
 assert.equal(new URL(returned.headers.get('Location')).searchParams.get('social'),'connected');assert.equal(returned.testCookies[0].config.maxAge,0);assert.ok(authorizations.has(company));assert.ok(!authorizations.has(foreign));
 assert.ok(!authorizations.get(company).token_ciphertext.includes('synthetic-user-token'));
 await assert.rejects(()=>lib.finishSocialOAuth(state,state,'synthetic-code-123'));
 assert.equal(network.length,beforeCallback+2,'consumed state cannot replay a token exchange');
 const pages=await api.GET(request('GET',{query:'action=pages&channel=facebook&companyId='+foreign}));assert.equal(pages.status,200);
 const pageBody=await pages.json();assert.equal(pageBody.pages.length,1);assert.equal(pageBody.pages[0].instagramId,null);assert.doesNotMatch(JSON.stringify(pageBody),/synthetic-user-token|synthetic-page-token|access_token|token_ciphertext/);
 assert.equal(network.at(-1).url.searchParams.get('fields'),'id,name,access_token');
 assert.equal((await api.GET(request('GET',{query:'action=pages&channel=whatsapp'}))).status,400);
 assert.equal((await api.GET(request('GET',{query:'action=pages&channel='}))).status,400);
 const selected=await api.POST(request('POST',{body:{action:'select-page',pageId:'123',channels:['facebook']}}));assert.equal(selected.status,200);assert.equal(binds.length,1);assert.equal(binds[0].p_channel,'facebook');assert.equal(binds[0].p_account_id,'123');
 const selectionReads=network.filter(c=>c.url.pathname==='/v26.0/me/accounts');assert.ok(selectionReads.every(c=>!c.url.searchParams.get('fields').includes('instagram')),'selection derives Facebook lookup from submitted channel, not a previous GET');
 allowInstagramFields=true;
 assert.equal((await api.POST(request('POST',{body:{action:'select-page',pageId:'123',channels:['instagram']}}))).status,422);assert.equal(binds.length,1,'an Instagram selection cannot invent an account absent at the provider');
 foreignPage=true;const beforeConflict=network.filter(c=>c.url.pathname.endsWith('/subscribed_apps')).length;
 assert.equal((await api.POST(request('POST',{body:{action:'select-page',pageId:'123',channels:['facebook']}}))).status,409);
 assert.equal(network.filter(c=>c.url.pathname.endsWith('/subscribed_apps')).length,beforeConflict,'foreign tenant conflict rejected before provider mutation');foreignPage=false;
 hasInstagram=true;const igPages=await api.GET(request('GET',{query:'action=pages&channel=instagram'}));assert.equal((await igPages.json()).pages[0].instagramId,'456');
 assert.equal((await api.POST(request('POST',{body:{action:'select-page',pageId:'123',channels:['instagram']}}))).status,200);assert.equal(binds.at(-1).p_account_id,'456');assert.equal(binds.at(-1).p_channel,'instagram');
 const pending=await lib.beginSocialOAuth(company,broker,'https://app.example.invalid/api/integrations/meta/social/callback','facebook');activeOwner=false;const beforeRevocation=network.length;
 await assert.rejects(()=>lib.finishSocialOAuth(pending.state,pending.state,'synthetic-code-123'));assert.equal(network.length,beforeRevocation,'revoked owner cannot exchange the code');
 console.log('PASS social connections: Facebook-only consent and Page listing/selection without Instagram, compatible IG/legacy flow, session/origin/rate guards, bound one-use state, active-owner check, tenant conflict and no credential exposure; synthetic provider only.');
})().catch(error=>{console.error(error);process.exit(1);});
