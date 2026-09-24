const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
function load(file,deps={},globals={}) {
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};
  vm.runInNewContext(output,{module:mod,exports:mod.exports,require:n=>n in deps?deps[n]:require(n),Buffer,URL,URLSearchParams,Date,console,process:{env:{}},...globals});
  return mod.exports;
}
const next={NextResponse:{json:(body,options={})=>({body,status:options.status||200,cookies:{set(){}},headers:{set(){}}})},after:fn=>background.push(fn)};
let background=[], calls=[], actor={brokerId:'11111111-1111-4111-8111-111111111111',companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'owner'};
let database=async(route,options)=>{calls.push({route,options});return true;};
const security={hasSameOrigin:req=>req.safe!==false,consumeRateLimit:async()=>true};
const auth={protectedRoute:fn=>fn,readAccount:async()=>actor,verifyPassword:async(p,h)=>p==='current-password'&&h==='hash',hashPassword:async()=> 'new-hash',tokenHash:t=>crypto.createHash('sha256').update(t).digest('hex'),normalizeName:t=>t.trim().toLowerCase(),normalizeEmail:t=>t.trim().toLowerCase(),ACCOUNT_COOKIE:'imobflow_session',cookieOptions:{}};
const deps={'next/server':next,'@/lib/accounts':auth,'@/lib/request-security':security,'@/lib/supabase':{supabaseRequest:(...args)=>database(...args)},'@/lib/tenant-context':{currentAccount:()=>actor}};
const req=(body,method='POST',safe=true)=>({method,safe,text:async()=>JSON.stringify(body),json:async()=>body,cookies:{get:()=>({value:'cookie'})},nextUrl:{searchParams:new URLSearchParams()}});
async function run(){
  // Model StrictMode's setup -> cleanup -> setup cycle before timers run.
  for (const fragment of ['a'.repeat(64), 'invalid', '']) {
    const state=[], timers=new Map(); let effect, nextTimer=0;
    const location={hash:fragment?`#token=${fragment}`:'',pathname:'/painel/redefinir-senha'};
    const React={
      useState:initial=>{const index=state.length;state.push(initial);return [initial,value=>{state[index]=value;}];},
      useRef:initial=>({current:initial}),
      useEffect:callback=>{effect=callback;},
    };
    const client=load('app/painel/redefinir-senha/reset-client.tsx',{
      react:React,'react/jsx-runtime':{jsx:()=>null,jsxs:()=>null},
      'next/link':()=>null,'../../password-input':()=>null,'../access.css':{},
    },{window:{location,history:{replaceState:()=>{location.hash='';}},setTimeout:callback=>{timers.set(++nextTimer,callback);return nextTimer;},clearTimeout:id=>timers.delete(id)}});
    client.default();
    effect()();
    const cleanup=effect();
    for(const callback of timers.values()) callback();
    cleanup();
    assert.equal(location.hash,'','reset token must be removed from browser URL');
    assert.equal(state[0],fragment.length===64?fragment:'','valid token must survive effect replay');
    assert.equal(Boolean(state[1]),fragment.length!==64);
  }
  console.log('PASS recovery link survives StrictMode effect replay, rejects invalid fragments, clears URL');

  let mailFetch=async()=>({ok:true,status:200}),issued=0,providerCalls=0;
  const mailEnv={RESEND_API_KEY:'test-secret-not-for-logs',PASSWORD_EMAIL_FROM:'ImobFlow <no-reply@example.invalid>',APP_BASE_URL:'https://example.invalid'};
  const mail=load('lib/password-recovery.ts',{
    './accounts':{newToken:()=> 'b'.repeat(64),tokenHash:auth.tokenHash},
    './supabase':{supabaseRequest:async()=>{issued++;return true;}},
  },{process:{env:mailEnv},AbortSignal,fetch:async(...args)=>{providerCalls++;return mailFetch(...args);}});
  const mailAccount={id:'test-account',email:'private@example.invalid',password_hash:'private-hash',auth_version:1};
  mailEnv.APP_BASE_URL='http://invalid.example';
  await assert.rejects(()=>mail.sendPasswordEmail(mailAccount));
  assert.equal(issued,0,'bad origin must not issue or invalidate reset links');
  assert.equal(providerCalls,0);
  mailEnv.APP_BASE_URL='https://example.invalid';
  for(const [status,category] of [[401,'credentials'],[403,'rejected'],[429,'rate_limit'],[503,'provider_unavailable']]) {
    mailFetch=async()=>({ok:false,status,json:async()=>assert.fail('do not read provider error body')});
    const before=providerCalls;
    await assert.rejects(()=>mail.sendPasswordEmail(mailAccount),error=>{
      assert.equal(JSON.stringify(mail.passwordRecoveryFailure(error)),JSON.stringify({category,status}));return true;
    });
    assert.equal(providerCalls,before+1,'do not blindly retry reset emails');
  }
  for(const [name,category] of [['TimeoutError','timeout'],['AbortError','timeout'],['TypeError','connection']]) {
    mailFetch=async()=>{throw {name,message:'private@example.invalid test-secret-not-for-logs'};};
    await assert.rejects(()=>mail.sendPasswordEmail(mailAccount),error=>{
      assert.equal(JSON.stringify(mail.passwordRecoveryFailure(error)),JSON.stringify({category}));return true;
    });
  }
  assert.equal(JSON.stringify(mail.passwordRecoveryFailure(new Error('private@example.invalid'))),'{"category":"internal"}');
  mailFetch=async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    const payload=JSON.parse(options.body);
    assert.match(payload.text,/https:\/\/example.invalid\/painel\/redefinir-senha#token=b{64}/);
    assert.equal(options.redirect,'error');
    return {ok:true,status:200};
  };
  await mail.sendPasswordEmail(mailAccount);
  console.log('PASS private email diagnostics, timeout/network failures, no blind retries and origin validation before token issuance');

  const accounts=load('lib/accounts.ts',{'next/server':next,'./tenant-context':{},'./supabase':{supabaseRequest:(...args)=>database(...args)}});
  const hash=await accounts.hashPassword('12345678');
  assert.match(hash,/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await accounts.verifyPassword('12345678',hash),true);
  assert.equal(await accounts.verifyPassword('87654321',hash),false);
  assert.equal(await accounts.verifyPassword('anything','bad-hash'),false);
  const broker={id:'broker-a',company_id:'tenant-a',name:'Test',role:'owner',password_hash:hash,active:true,auth_version:1};
  database=async route=>route.startsWith('broker_accounts?')?[broker]:[{company_id:'tenant-a',name:'Company A'}];
  assert.equal((await accounts.authenticate(' USER@example.invalid ','12345678','owner')).companyId,'tenant-a');
  assert.equal(await accounts.authenticate('user@example.invalid','wrong','owner'),null);
  assert.equal(await accounts.authenticate('user@example.invalid','12345678','broker'),null);
  database=async()=>[broker,{...broker,company_id:'tenant-b'}];
  assert.equal(await accounts.authenticate('user@example.invalid','12345678','owner'),null);
  database=async()=>[];
  assert.equal(await accounts.authenticate('missing@example.invalid','12345678','owner'),null);
  calls=[];database=async(route,options)=>{calls.push({route,options});return false;};
  await assert.rejects(()=>accounts.issueSession(actor,hash,7),/account_changed/);
  assert.equal(calls[0].route,'rpc/issue_account_session');
  assert.equal(calls[0].options.body.p_expected_hash,hash);
  assert.equal(calls[0].options.body.p_expected_auth_version,7);
  assert.match(calls[0].options.body.p_token_hash,/^[a-f0-9]{64}$/);
  console.log('PASS scrypt passwords and version-bound session issuance');

  const teamRoutes=load('app/api/brokers/route.ts',deps);
  calls=[];database=async(route,options)=>{calls.push({route,options});return route.startsWith('broker_accounts?')?[{password_hash:'hash',auth_version:4}]:false;};
  assert.equal((await teamRoutes.PATCH(req({email:'new@example.invalid',currentPassword:'current-password'},'PATCH'))).status,409);
  assert.equal(calls.at(-1).route,'rpc/change_account_email');
  assert.equal(calls.at(-1).options.body.p_expected_auth_version,4);
  assert.equal(calls.at(-1).options.body.p_expected_hash,'hash');
  assert.ok(calls.every(call=>!call.route.includes('password_hash=eq.')));
  console.log('PASS stale email update denied with version/password CAS');

  let mailConfigured=false;
  const recovery={passwordEmailConfigured:()=>mailConfigured,passwordRecoveryFailure:mail.passwordRecoveryFailure,sendPasswordEmail:async()=>{},issuePasswordLink:async()=> 'https://imobflow.test/painel/redefinir-senha#token=test'};
  const password=load('app/api/account/password/route.ts',{...deps,'@/lib/password-recovery':recovery});
  assert.equal((await password.POST(req({},'POST',false))).status,403);
  assert.equal((await password.POST(req({action:'request',company:'A',email:'missing@test.invalid'}))).status,503);
  mailConfigured=true;
  for (const raw of ['{', 'null', '[]', 'true', '123', '"string"']) {
    const response=await password.POST({...req({}),text:async()=>raw});
    assert.equal(response.status,400,'invalid JSON payload is a client error, not an outage');
  }
  assert.equal(background.length,0,'invalid payloads must not schedule email work');
  const validRequest={action:'request',role:'owner',email:'missing@test.invalid'};
  const requested=await password.POST(req(validRequest));
  assert.equal(requested.status,200); assert.equal(requested.body.url,undefined); assert.equal(background.length,1);
  calls=[];database=async(route,options)=>{calls.push({route,options});return true;};
  assert.equal((await password.POST(req({action:'reset',token:'a'.repeat(64),password:'1234567',confirmPassword:'1234567'}))).status,400);
  assert.equal((await password.POST(req({action:'reset',token:'a'.repeat(64),password:'12345678',confirmPassword:'different'}))).status,400);
  assert.equal((await password.POST(req({action:'reset',token:'bad',password:'12345678',confirmPassword:'12345678'}))).status,400);
  assert.equal(calls.length,0);
  assert.equal((await password.POST(req({action:'reset',token:'a'.repeat(64),password:'12345678',confirmPassword:'12345678'}))).status,200);
  assert.equal(calls[0].route,'rpc/consume_account_password_reset');
  assert.notEqual(calls[0].options.body.p_token_hash,'a'.repeat(64));
  database=async()=>false;
  assert.equal((await password.POST(req({action:'reset',token:'a'.repeat(64),password:'12345678',confirmPassword:'12345678'}))).status,400);
  actor=null;
  assert.equal((await password.POST(req({action:'change',password:'12345678',confirmPassword:'12345678'}))).status,401);
  actor={brokerId:'11111111-1111-4111-8111-111111111111',companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'owner'};
  database=async()=>[{password_hash:'hash'}];
  assert.equal((await password.POST(req({action:'change',currentPassword:'wrong',password:'12345678',confirmPassword:'12345678'}))).status,403);
  console.log('PASS recovery privacy, no-provider notice, 8-character policy, invalid/used tokens, current password');

  const brokers=load('app/api/brokers/[id]/route.ts',{...deps,'@/lib/password-recovery':recovery});
  const params={params:Promise.resolve({id:'22222222-2222-4222-8222-222222222222'})};
  calls=[];database=async(route,options)=>{calls.push({route,options});return [];};
  actor.role='broker';
  assert.equal((await brokers.PATCH(req({active:false},'PATCH'),params)).status,403);
  assert.equal((await brokers.POST(req({currentPassword:'current-password'}),params)).status,403);
  assert.equal(calls.length,0);
  actor.role='owner';
  assert.equal((await brokers.PATCH(req({active:false},'PATCH',false),params)).status,403);
  assert.equal((await brokers.PATCH(req({active:'false'},'PATCH'),params)).status,400);
  database=async(route,options)=>{calls.push({route,options});return [{id:'target',active:false}];};
  assert.equal((await brokers.PATCH(req({active:false},'PATCH'),params)).status,200);
  assert.equal(calls.at(-1).options.body.p_actor_id,actor.brokerId);
  database=async(route)=>route.includes('select=password_hash')?[{password_hash:'hash'}]:[];
  assert.equal((await brokers.POST(req({currentPassword:'wrong'}),params)).status,403);
  assert.equal((await brokers.POST(req({currentPassword:'current-password'}),params)).status,404);
  console.log('PASS admin-only deactivation/recovery, same-origin, actor binding and foreign/missing target denial');

  let wroteGoals=false;
  const performance=load('app/api/performance/route.ts',{...deps,'@/lib/admin-auth':{isAdminRequest:()=>true},'@/lib/database':{updatePerformanceSettings:async()=>{wroteGoals=true;return {};}}});
  actor.role='broker';
  assert.equal((await performance.PATCH(req({month:'2026-09'}))).status,403);assert.equal(wroteGoals,false);
  actor.role='owner';
  assert.equal((await performance.PATCH(req({month:'2026-09',companyGoal:0,brokerGoals:[]}))).status,200);assert.equal(wroteGoals,true);

  const login=load('app/api/account/[action]/route.ts',{...deps,'@/lib/password-recovery':{sendWelcomeEmail:async()=>assert.fail('login must not send a welcome email')},'@/lib/accounts':{...auth,authenticate:async()=>({...actor,passwordVersion:'hash'}),issueSession:async()=> 'session'},'@/lib/admin-auth':{COOKIE_NAME:'legacy'}});
  const loginData={email:'user@example.invalid',password:'12345678'};
  assert.equal((await login.POST(req(loginData),{params:Promise.resolve({action:'login'})})).status,401);
  assert.equal((await login.POST(req(loginData),{params:Promise.resolve({action:'login-admin'})})).status,200);
  actor.role='broker';
  assert.equal((await login.POST(req(loginData),{params:Promise.resolve({action:'login-admin'})})).status,401);
  assert.equal((await login.POST(req(loginData),{params:Promise.resolve({action:'login'})})).status,200);
  const blockedAttempts=[];
  let credentialChecks=0;
  const blockedLogin=load('app/api/account/[action]/route.ts',{
    ...deps,
    '@/lib/request-security':{...security,consumeRateLimit:async(_request,bucket,limit,windowSeconds)=>{blockedAttempts.push({bucket,limit,windowSeconds});return false;}},
    '@/lib/accounts':{...auth,authenticate:async()=>{credentialChecks++;return null;}},
    '@/lib/password-recovery':{sendWelcomeEmail:async()=>{}},
    '@/lib/admin-auth':{COOKIE_NAME:'legacy'},
  });
  for(const action of ['login','login-admin']) {
    const response=await blockedLogin.POST(req(loginData),{params:Promise.resolve({action})});
    assert.equal(response.status,429,`${action} must stop before password verification when throttled`);
    assert.equal(response.body.error,'Muitas tentativas. Aguarde 15 minutos.');
  }
  assert.equal(credentialChecks,0);
  assert.deepEqual(blockedAttempts,[
    {bucket:'account-login',limit:20,windowSeconds:900},
    {bucket:'account-login',limit:20,windowSeconds:900},
  ]);
  console.log('PASS server-enforced administrator/broker login and owner-only goal changes');

  const automationChanges=[];
  const automation=load('app/api/automations/route.ts',{
    ...deps,
    '@/lib/admin-auth':{isAdminRequest:()=>true},
    '@/lib/tenant-context':{currentAccount:()=>actor},
    '@/lib/automation-rules':{isFlowId:id=>id==='followup'},
    '@/lib/automations':{
      automationSnapshot:async()=>({flows:[]}),
      completeAutomationResult:async()=>{automationChanges.push('complete');},
      prepareMatchMessage:async()=>({message:'Rascunho'}),
      runAutomations:async()=>{automationChanges.push('run');return {processed:1};},
      setAutomationActive:async()=>{automationChanges.push('toggle');},
    },
  },{process:{env:{DATABASE_URL:'mock-only'}}});
  const automationRequest=body=>({...req(body),headers:{get:()=>null},nextUrl:{origin:'https://imobflow.test'}});
  assert.equal((await automation.POST(automationRequest({action:'toggle',flowId:'followup',active:true}))).status,403);
  assert.equal((await automation.POST(automationRequest({action:'run',flowId:'followup'}))).status,403);
  assert.equal(automationChanges.length,0,'broker must not change or execute automations');
  assert.equal((await automation.POST(automationRequest({action:'prepare-message',id:'22222222-2222-4222-8222-222222222222'}))).status,200);
  assert.equal((await automation.POST(automationRequest({action:'complete',id:'22222222-2222-4222-8222-222222222222'}))).status,200);
  actor.role='owner';
  assert.equal((await automation.POST(automationRequest({action:'toggle',flowId:'followup',active:true}))).status,200);
  assert.equal((await automation.POST(automationRequest({action:'run',flowId:'followup'}))).status,200);
  assert.deepEqual(automationChanges,['complete','toggle','run']);

  let deletedSales=0;
  const sales=load('app/api/performance/sales/[id]/route.ts',{
    ...deps,
    '@/lib/admin-auth':{isAdminRequest:()=>true},
    '@/lib/database':{deleteSale:async()=>{deletedSales++;return true;}},
  });
  const saleParams={params:Promise.resolve({id:'22222222-2222-4222-8222-222222222222'})};
  actor.role='broker';
  assert.equal((await sales.DELETE(req({},'DELETE'),saleParams)).status,403);
  assert.equal(deletedSales,0);
  actor.role='owner';
  assert.equal((await sales.DELETE(req({},'DELETE'),saleParams)).status,200);
  assert.equal(deletedSales,1);
  console.log('PASS broker login throttling and owner-only automation controls and sale deletion');

  const adminChecks=[];
  const adminLogin=load('app/api/admin/login/route.ts',{
    'next/server':next,
    '@/lib/request-security':{...security,hasSafeRequestSize:()=>true},
    '@/lib/admin-auth':{COOKIE_NAME:'legacy',adminSessionToken:()=> 'admin-session',isValidAdminPassword:value=>{adminChecks.push(value);return value==='correct-secret';}},
  });
  assert.equal((await adminLogin.POST(req({},'POST',false))).status,403);
  for (const raw of ['{', 'null', '[]', 'true', '123', '"string"', '{}', '{"password":123}', '{"password":{}}']) {
    assert.equal((await adminLogin.POST({...req({}),text:async()=>raw})).status,400,'malformed admin login must be a client error');
  }
  assert.equal((await adminLogin.POST(req({password:'x'.repeat(4097)}))).status,413,'body limit must work even without Content-Length');
  assert.equal(adminChecks.length,0,'invalid input must not reach password validation');
  assert.equal((await adminLogin.POST(req({password:'wrong-secret'}))).status,401);
  assert.equal((await adminLogin.POST(req({password:'correct-secret'}))).status,200);
  assert.equal(adminChecks.length,2,'only valid password submissions reach credential validation');
  console.log('PASS administrative login rejects malformed JSON, invalid password types and oversized bodies');

  const managementAttempts=[];
  let managementAllowed=false,managementPasswordChecks=0,licenseWrites=0;
  const managementSecurity={...security,hasSafeRequestSize:()=>true,consumeRateLimit:async(_request,bucket,limit,windowSeconds)=>{
    managementAttempts.push({bucket,limit,windowSeconds});
    return managementAllowed;
  }};
  const managementAuth={COOKIE_NAME:'legacy',adminSessionToken:()=> 'admin-session',isValidAdminPassword:value=>{
    managementPasswordChecks++;
    return value==='correct-secret';
  }};
  const limitedAdminLogin=load('app/api/admin/login/route.ts',{
    'next/server':next,
    '@/lib/request-security':managementSecurity,
    '@/lib/admin-auth':managementAuth,
  });
  const licenses=load('app/api/licenses/route.ts',{
    'next/server':next,
    '@/lib/request-security':managementSecurity,
    '@/lib/admin-auth':managementAuth,
    '@/lib/accounts':{newToken:()=> 'a'.repeat(64),tokenHash:auth.tokenHash},
    '@/lib/supabase':{supabaseRequest:async()=>{licenseWrites++;return true;}},
    '@/lib/plans':{isPlanId:id=>id==='basic',plans:{basic:{brokers:5}}},
  });
  assert.equal((await limitedAdminLogin.POST(req({password:'correct-secret'}))).status,429);
  assert.equal((await licenses.POST(req({managementPassword:'correct-secret',plan:'basic'}))).status,429);
  assert.equal(managementPasswordChecks,0,'throttled requests must not check the shared secret');
  assert.equal(licenseWrites,0,'throttled requests must not create licenses');
  assert.deepEqual(managementAttempts,[
    {bucket:'admin-management',limit:5,windowSeconds:900},
    {bucket:'admin-management',limit:5,windowSeconds:900},
  ]);
  managementAllowed=true;
  assert.equal((await limitedAdminLogin.POST(req({password:'correct-secret'}))).status,200);
  const issuedLicense=await licenses.POST(req({managementPassword:'correct-secret',plan:'basic'}));
  assert.equal(issuedLicense.status,200);
  assert.equal(issuedLicense.body.seatLimit,5);
  assert.equal(licenseWrites,1);
  console.log('PASS legacy admin login and active license creation share a five-attempt management limit');

  background=[];
  let welcomeCalls=0, welcomeFailure=false;
  const welcomeLogs=[];
  const enrollment=load('app/api/account/[action]/route.ts',{
    ...deps,
    '@/lib/admin-auth':{COOKIE_NAME:'legacy'},
    '@/lib/accounts':{...auth,issueSession:async()=> 'session'},
    '@/lib/password-recovery':{
      passwordRecoveryFailure:mail.passwordRecoveryFailure,
      sendWelcomeEmail:async(account,metadata)=>{
        welcomeCalls++;
        assert.equal(account.email,'new@example.invalid');
        assert.equal(metadata.company,'Company Test');
        if(welcomeFailure) throw new Error('private provider response');
      },
    },
  },{console:{...console,error:(...args)=>welcomeLogs.push(args)}});
  database=async route=>{
    assert.equal(route,'rpc/redeem_access_license');
    return [{broker_id:'new-owner',company_id:'new-company',company:'Company Test',broker_name:'Test Owner',role:'owner'}];
  };
  const enrollmentData={company:'Company Test',name:'Test Owner',email:'new@example.invalid',password:'12345678',accessKey:'IMF-abcdefghijklmnopqrs'};
  const enrollmentResponse=await enrollment.POST(req(enrollmentData),{params:Promise.resolve({action:'enroll'})});
  assert.equal(enrollmentResponse.status,200);
  assert.equal(welcomeCalls,0,'first login must complete without waiting for email delivery');
  assert.equal(background.length,1,'exactly one post-response welcome email must be scheduled');
  await background.shift()();
  assert.equal(welcomeCalls,1);
  welcomeFailure=true;
  assert.equal((await enrollment.POST(req(enrollmentData),{params:Promise.resolve({action:'enroll'})})).status,200);
  await background.shift()();
  assert.equal(welcomeCalls,2);
  assert.equal(JSON.stringify(welcomeLogs),'[["welcome_email_failed",{"category":"internal"}]]','background email failures must be caught without provider data');
  console.log('PASS enrollment responds before welcome email delivery and safely records background failures');

  let tenant;
  const leads=load('app/api/leads/route.ts',{...deps,'@/lib/admin-auth':{},'@/lib/automations':{runAutomationsAfterEvent:async()=>{}},'@/lib/database':{createLead:async()=>({id:'private-record'})},'@/lib/request-security':{...security,hasSafeRequestSize:()=>true},'@/lib/tenant-context':{withAccount:(a,fn)=>{tenant=a;return fn();}},'@/lib/public-company':{publicCompany:async slug=>slug==='company-a'?{id:'tenant-a',name:'A'}:slug==='company-b'?{id:'tenant-b',name:'B'}:null}});
  const leadData={name:'Teste',phone:'11999999999',goal:'Comprar',propertyType:'Casa',region:'Centro',budget:'500 mil',company_id:'attacker-selected'};
  assert.equal((await leads.POST(req(leadData))).status,400);
  assert.equal(tenant,undefined);
  const leadResult=await leads.POST(req({...leadData,companySlug:'company-a'}));
  assert.equal(leadResult.status,201);assert.equal(tenant.companyId,'tenant-a');assert.equal(leadResult.body.data,undefined);
  await leads.POST(req({...leadData,companySlug:'company-b'}));assert.equal(tenant.companyId,'tenant-b');
  for(const file of ['database.ts','automations.ts']) assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../lib',file),'utf8'),/\b(?:CREATE TABLE|ALTER TABLE|DROP CONSTRAINT)\b/);
  const propertiesSource=fs.readFileSync(path.join(__dirname,'../app/api/properties/route.ts'),'utf8');
  assert.doesNotMatch(propertiesSource,/role\s*!==\s*['"]owner/);
  console.log('PASS company-specific public intake, no default tenant, no public CRM response, no runtime DDL');
  console.log('API contracts use a mocked database. Transaction/seat/session SQL tests must also run on PostgreSQL.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
