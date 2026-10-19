const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const {NextRequest}=require('next/server');
const root=path.resolve(__dirname,'..'),cache=new Map(),testEnv={};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,token='a'.repeat(64),calls=[];
let mode='api',providerStatus=201,transportCalls=0,targetPresent=true,claimed=0,finished=[],rows=[{id:id(9)}];
const midday=Date.parse('2026-10-19T15:00:00Z');
let clock=midday,policyVersion=3,hoursFailure=false,hoursByCompany=new Map(),candidatePages=null,targetCompany=id(1),beforeTarget=null;
class Clock extends Date { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} }
const pair=crypto.createECDH('prime256v1');pair.generateKeys();
const publicKey=pair.getPublicKey().toString('base64url'),privateKey=pair.getPrivateKey().toString('base64url');
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic',keys:{p256dh:publicKey,auth:Buffer.alloc(16,7).toString('base64url')}};
const candidate={company_id:id(1),subscription_id:id(9),lead_id:id(101),waiting_message_id:id(701),waiting_since:new Date(clock-6*60000).toISOString(),duty_priority_until:null,duty_preferred:false};
async function db(url,options={}){
 calls.push({url,...options});
 if(url==='rpc/account_session')return options.body.p_hash===crypto.createHash('sha256').update(token).digest('hex')?[{broker_id:id(11),company_id:id(1),name:'Synthetic broker',company:'Synthetic company',role:'owner'}]:[];
 if(url==='rpc/urgent_alert_policy_version'){if(policyVersion instanceof Error)throw policyVersion;return policyVersion;}
 if(url.startsWith('conversation_settings?')){
  if(hoursFailure)throw new Error('synthetic hours unavailable');
  const company=new URLSearchParams(url.split('?')[1]).get('company_id').slice(3);
  return [{business_hours:hoursByCompany.has(company)?hoursByCompany.get(company):{}}];
 }
 if(mode==='api'){
  if(url==='rpc/register_web_push')return id(9);
  if(options.method==='DELETE')return undefined;
  if(url.startsWith('web_push_subscriptions?'))return rows;
 }
 if(url==='rpc/list_web_push_candidates')return candidatePages?.[options.body.p_offset/60]||[candidate];
 if(url==='rpc/claim_web_push')return claimed++?null:id(7);
 if(url==='rpc/web_push_dispatch_target'){beforeTarget?.();return targetPresent?{companyId:targetCompany,bindingId:id(9),subscription,waitingSince:candidate.waiting_since,dutyPriorityUntil:candidate.duty_priority_until,dutyPreferred:candidate.duty_preferred}:null;}
 if(url==='rpc/finish_web_push'){finished.push(options.body);return null;}
 throw new Error('Unexpected synthetic database call');
}
function load(filename){
 const full=path.resolve(root,filename.endsWith('.ts')?filename:filename+'.ts');
 if(cache.has(full))return cache.get(full);
 const module={exports:{}};cache.set(full,module.exports);
 const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const requireLocal=specifier=>{
  if(specifier==='./supabase'||specifier==='@/lib/supabase')return {supabaseRequest:db,supabaseServiceRequest:db};
  if(specifier.startsWith('@/'))return load(specifier.slice(2));
  if(specifier.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(full),specifier)));
  return require(specifier);
 };
 vm.runInNewContext(code,{module,exports:module.exports,require:requireLocal,process:{env:testEnv},Buffer,URL,Date:Clock,AbortSignal,Uint8Array,fetch:async(endpoint,options)=>{
  transportCalls++;assert.equal(endpoint,subscription.endpoint);assert.equal(options.redirect,'error');assert.equal(options.method,'POST');assert(options.signal);assert(options.body.length>0);return new Response('',{status:providerStatus});
 }},{filename:full});
 return module.exports;
}
const request=(method='GET',body,origin='https://example.test',authenticated=true,query='')=>new NextRequest('https://example.test/api/notifications/push'+query,{method,headers:{...(origin?{origin}:{}),...(authenticated?{cookie:`imobflow_session=${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
(async()=>{
 const {defaultBusinessHours:hours}=load('lib/business-hours'),windowPolicy=load('lib/urgent-alert-hours');
 const until=(iso,settings=hours)=>windowPolicy.urgentAlertActiveUntil(settings,Date.parse(iso));
 assert.equal(until('2026-10-19T10:59:59Z'),null,'before opening');
 assert.equal(until('2026-10-19T11:00:00Z'),Date.parse('2026-10-19T11:00:30Z'),'opening inclusive');
 assert.equal(until('2026-10-19T20:59:59Z'),Date.parse('2026-10-19T21:00:00Z'),'last second expires at exact closing');
 assert.equal(until('2026-10-19T21:00:00Z'),null,'closing exclusive');
 assert.equal(until('2026-10-18T15:00:00Z'),null,'Sunday excluded');
 assert.equal(until('2026-10-19T15:00:00Z',{...hours,holidays:['2026-10-19']}),null,'tenant holiday');
 assert.equal(until('2026-10-19T11:00:00Z',{...hours,timeZone:'America/Manaus'}),null,'no hard-coded UTC offset');
 assert.equal(until('2026-03-08T06:59:59Z',{...hours,timeZone:'America/New_York',weekdays:[0],opens:'01:00',closes:'03:00'}),Date.parse('2026-03-08T07:00:00Z'),'DST jump to closing expires exactly');
 assert.equal(windowPolicy.urgentAlertActiveUntil(hours,NaN),null);
 const policy=load('lib/web-push');
 assert.equal(policy.webPushConfig(),null,'disabled by default');
 for(const endpoint of ['http://fcm.googleapis.com/x','https://localhost/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.example/x','https://user@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x','https://fcm.googleapis.com/x#fragment'])assert.throws(()=>policy.validPushEndpoint(endpoint));
 for(const endpoint of ['https://fcm.googleapis.com/fcm/send/a','https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a','https://wns2.notify.windows.com/a'])assert.equal(policy.validPushEndpoint(endpoint),endpoint);
 assert.throws(()=>policy.validatePushSubscription({...subscription,keys:{auth:'a',p256dh:publicKey}}));
 assert.throws(()=>policy.validatePushSubscription({...subscription,keys:{...subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}}));
 Object.assign(testEnv,{WEB_PUSH_ENABLED:'true',VAPID_PUBLIC_KEY:publicKey,VAPID_PRIVATE_KEY:privateKey,VAPID_SUBJECT:'mailto:test@example.test',CRON_SECRET:'synthetic-cron'});
 assert.equal(policy.webPushConfig().schedulerConfigured,false);
 const api=load('app/api/notifications/push/route');
 assert.equal((await api.GET(request('GET',undefined,undefined,false))).status,401);
 const status=await(await api.GET(request())).json();assert.equal(status.configured,true);assert.equal(status.publicKey,publicKey);assert.equal(status.subscribed,true);assert(!JSON.stringify(status).includes(privateKey));
 assert.equal(status.businessHoursOpen,true);assert.equal(status.activeUntil,clock+30000);
 assert.match((await api.GET(request())).headers.get('cache-control'),/private, no-store/);
 clock=Date.parse('2026-10-19T22:00:00Z');
 const closed=await(await api.GET(request())).json();assert.equal(closed.configured,true);assert.equal(closed.subscribed,true);assert.equal(closed.businessHoursOpen,false);assert.equal(closed.activeUntil,null);
 assert.equal((await api.POST(request('POST',{subscription}))).status,200,'device consent works outside hours');
 clock=midday;hoursFailure=true;
 assert.equal((await(await api.GET(request())).json()).configured,false,'unavailable hours fail closed');
 hoursFailure=false;policyVersion=1;
 assert.equal((await(await api.GET(request())).json()).businessHoursOpen,false,'old policy cannot expose actionable state');
 assert.equal((await api.POST(request('POST',{subscription}))).status,503,'old schema cannot register');
 policyVersion=3;
 for(const invalid of [null,[],false,'',42,{opens:'08:00'}]){
  hoursByCompany.set(id(1),invalid);
  assert.equal((await(await api.GET(request())).json()).businessHoursOpen,false,'malformed settings never become default opening');
 }
 hoursByCompany.clear();
 const deviceHash=policy.pushEndpointHash(subscription.endpoint);
 assert.equal((await api.GET(request('GET',undefined,undefined,true,'?endpointHash=invalid'))).status,400);
 await api.GET(request('GET',undefined,undefined,true,'?endpointHash='+deviceHash));assert(calls.at(-1).url.includes('endpoint_hash=eq.'+deviceHash));
 assert.equal((await api.POST(request('POST',{subscription},'https://evil.example'))).status,403);
 assert.equal((await api.POST(request('POST',{subscription},null))).status,403);
 assert.equal((await api.POST(request('POST',{subscription:{...subscription,endpoint:'https://127.0.0.1/private'}}))).status,400);
 const saved=await(await api.POST(request('POST',{subscription}))).json();assert.equal(saved.bindingId,id(9));
 const save=calls.find(call=>call.url==='rpc/register_web_push');assert.equal(save.body.p_company_id,id(1));assert.equal(save.body.p_broker_id,id(11));assert.equal(save.body.p_endpoint_hash,deviceHash);assert.notEqual(save.body.p_session_hash,token);
 assert.equal((await api.DELETE(request('DELETE',{endpoint:subscription.endpoint}))).status,200);
 assert(calls.at(-1).url.includes(`company_id=eq.${id(1)}`)&&calls.at(-1).url.includes('session_hash=eq.'),'unsubscribe remains session/tenant scoped');
 rows=[];assert.equal((await(await api.GET(request())).json()).subscribed,false);rows=[{id:id(9)}];
 mode='dispatch';const dispatcher=load('lib/web-push-dispatch');
 const before=calls.length;assert.equal((await dispatcher.dispatchBrowserPush()).configured,false);assert.equal(calls.length,before,'unconfigured scheduler never selects or sends');
 testEnv.WEB_PUSH_SCHEDULER_CONFIGURED='true';
 let payload;
 const send=async(sub,raw)=>{payload=JSON.parse(raw);assert.equal(sub.endpoint,subscription.endpoint);return 201;};
 assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,1);assert.equal(payload.bindingId,id(9));assert.equal(payload.url,'/painel#conversations');assert.equal(payload.expiresAt,clock+30000);assert(!JSON.stringify(payload).includes(id(101)));assert.equal(finished[0].p_state,'sent');
 assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,0,'persisted claim suppresses duplicate dispatch');
 claimed=0;targetPresent=false;let sends=0;assert.equal((await dispatcher.dispatchBrowserPush(async()=>{sends++;return 201;})).cancelled,1);assert.equal(sends,0,'fresh ownership/session rejection prevents transport');
 claimed=0;targetPresent=true;assert.equal((await dispatcher.dispatchBrowserPush(async()=>410)).failed,1);assert.equal(finished.at(-1).p_expired,true);
 claimed=0;assert.equal((await dispatcher.dispatchBrowserPush(async()=>{throw new Error('synthetic transport failure');})).failed,1);assert.equal(finished.at(-1).p_expired,false);
 claimed=0;candidate.waiting_since=new Date(clock-60000).toISOString();assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,0,'general threshold cannot send early');
 const at=clock;candidate.waiting_since=new Date(at-3*60000).toISOString();candidate.duty_priority_until=new Date(at+2*60000).toISOString();candidate.duty_preferred=true;
 claimed=0;assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,1,'eligible duty member receives after two minutes');
 claimed=0;candidate.duty_preferred=false;assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,0,'other brokers wait five minutes');
 candidate.waiting_since=new Date(midday-6*60000).toISOString();candidate.duty_priority_until=null;
 clock=Date.parse('2026-10-19T22:00:00Z');claimed=0;
 assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,0,'closed hours suppress transport');assert.equal(claimed,0,'closed hours do not consume cooldown');
 clock=midday;hoursByCompany.set(id(1),{...hours,holidays:['2026-10-19']});claimed=0;
 assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,0,'holiday prevents transport');assert.equal(claimed,0);
 hoursByCompany.clear();hoursFailure=true;
 assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,0,'hours failure never guesses open');hoursFailure=false;
 policyVersion=new Error('schema missing');await assert.rejects(()=>dispatcher.dispatchBrowserPush(send));policyVersion=3;
 claimed=0;targetCompany=id(2);
 assert.equal((await dispatcher.dispatchBrowserPush(send)).cancelled,1,'fresh tenant mismatch prevents sending');targetCompany=id(1);
 clock=Date.parse('2026-10-19T20:59:59Z');claimed=0;beforeTarget=()=>{clock=Date.parse('2026-10-19T21:00:00Z');};
 assert.equal((await dispatcher.dispatchBrowserPush(send)).cancelled,1,'closing during revalidation prevents transport');beforeTarget=null;clock=midday;
 hoursByCompany.set(id(2),{...hours,holidays:['2026-10-19']});
 candidatePages=[Array.from({length:60},(_,i)=>({...candidate,company_id:id(2),lead_id:id(1000+i)})),[candidate]];claimed=0;
 const pagingStart=calls.length;
 assert.equal((await dispatcher.dispatchBrowserPush(send)).sent,1,'closed tenant first page does not hide open next page');
 assert(calls.slice(pagingStart).some(call=>call.url==='rpc/list_web_push_candidates'&&call.body.p_offset===60));
 candidatePages=null;hoursByCompany.clear();
 await dispatcher.sendBrowserPush(subscription,JSON.stringify({title:'Synthetic'}),policy.webPushConfig());assert.equal(transportCalls,1,'real encryption runs with a fully synthetic fetch');
 const cron=load('app/api/notifications/push/dispatch/route');
 assert.equal((await cron.GET(new NextRequest('https://example.test/api/notifications/push/dispatch'))).status,401);
 testEnv.WEB_PUSH_ENABLED='false';assert.equal((await(await cron.GET(new NextRequest('https://example.test/api/notifications/push/dispatch',{headers:{authorization:'Bearer synthetic-cron'}}))).json()).configured,false);
 console.log('PASS web push server: tenant hours/holidays/DST/closing, policy marker, paged eligibility, 2/5 arrival thresholds, authenticated consent, scope revalidation, expiring private payload and synthetic encryption/transport only.');
})().catch(error=>{console.error(error);process.exitCode=1;});
