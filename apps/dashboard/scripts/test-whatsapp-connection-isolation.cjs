const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
let environment=[],rows=[],failure=false,writes=[];
const source=fs.readFileSync(path.join(__dirname,'../lib/meta-whatsapp-connections.ts'),'utf8');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  module:mod,exports:mod.exports,require(name){
    if(name==='./meta-whatsapp')return {configuredMetaWhatsAppConnections:()=>environment,normalizePhone:value=>value.replace(/\D/g,'')};
    if(name==='./supabase')return {supabaseServiceRequest:async(route,options)=>{
      if(failure)throw Error('store unavailable');
      if(options?.method==='POST'){writes.push(options.body);return;}
      if(route.includes('whatsapp_phone_number_id=eq.')){const phone=new URL(`https://test/${route}`).searchParams.get('whatsapp_phone_number_id').slice(3);return rows.filter(row=>row.whatsapp_phone_number_id===phone);}
      assert.equal(options?.timeoutMs,4000,'connection metadata read must be bounded before provider attempts');
      return rows;
    }};
    throw Error(name);
  },console,
});
const api=mod.exports,input={phoneNumberId:'123',accessToken:'secret',apiVersion:'v26.0',enabled:true};
async function run(){
  environment=[{companyId:b,phoneNumberId:'123',accessToken:'env-secret',enabled:true,apiVersion:'v26.0'}];
  await assert.rejects(()=>api.saveMetaWhatsAppConnection(a,input),/outra empresa/);assert.equal(writes.length,0);
  environment=[];rows=[{company_id:b,whatsapp_phone_number_id:'123',whatsapp_access_token:'other-secret',whatsapp_enabled:true}];
  await assert.rejects(()=>api.saveMetaWhatsAppConnection(a,input),/outra empresa/);assert.equal(writes.length,0);
  rows=[];await api.saveMetaWhatsAppConnection(a,input);assert.equal(writes.length,1);assert.equal(writes[0].company_id,a);
  environment=[{companyId:a,phoneNumberId:'123',enabled:true}];
  rows=[{company_id:a,whatsapp_phone_number_id:'123',whatsapp_access_token:'saved-secret',whatsapp_enabled:false}];
  const owned=await api.loadMetaWhatsAppConnectionForCompany(a);assert.equal(owned.length,1);assert.equal(owned[0].enabled,false);
  assert.equal((await api.loadMetaWhatsAppConnectionForCompany(b)).length,0);
  rows=[{company_id:a,whatsapp_phone_number_id:'456',whatsapp_access_token:'replacement-secret',whatsapp_enabled:true}];
  let replacement=await api.loadMetaWhatsAppConnectionForCompany(a);
  assert.equal(replacement.length,1);assert.equal(replacement[0].phoneNumberId,'456');assert.equal(replacement[0].enabled,true);
  assert.equal(await api.loadMetaWhatsAppConnectionByPhone(a,'123'),null,'old environment phone is no longer routed');
  rows[0].whatsapp_enabled=false;
  replacement=await api.loadMetaWhatsAppConnectionForCompany(a);
  assert.equal(replacement.length,1);assert.equal(replacement[0].phoneNumberId,'456');assert.equal(replacement[0].enabled,false);
  rows[0].whatsapp_phone_number_id=null;
  assert.equal((await api.loadMetaWhatsAppConnectionForCompany(a)).length,0,'explicit disable without phone cannot revive environment');
  rows[0].whatsapp_enabled=true;
  assert.equal((await api.loadMetaWhatsAppConnectionForCompany(a))[0].phoneNumberId,'123','ordinary settings without a WhatsApp mapping preserve environment setup');
  rows=[{company_id:a,whatsapp_phone_number_id:'456',whatsapp_enabled:true},{company_id:b,whatsapp_phone_number_id:'123',whatsapp_enabled:true}];
  await assert.rejects(()=>api.loadMetaWhatsAppConnections(),/mais de uma empresa/,'old environment ownership must still participate in cross-tenant validation');
  rows=[{company_id:a,whatsapp_phone_number_id:'456',whatsapp_enabled:true},{company_id:b,whatsapp_phone_number_id:'789',whatsapp_enabled:true}];
  const independent=await api.loadMetaWhatsAppConnections();
  assert.equal(independent.length,2);assert.equal(independent.find(connection=>connection.companyId===a).phoneNumberId,'456');assert.equal(independent.find(connection=>connection.companyId===b).phoneNumberId,'789');
  rows=[{company_id:a,whatsapp_phone_number_id:'123',whatsapp_access_token:'saved-secret',whatsapp_enabled:false}];
  rows=[{...rows[0],company_id:b}];
  await assert.rejects(()=>api.loadMetaWhatsAppConnections(),/mais de uma empresa/);
  await assert.rejects(()=>api.loadMetaWhatsAppConnectionForCompany(a),/mais de uma empresa/);
  await assert.rejects(()=>api.loadMetaWhatsAppConnectionByPhone(b,'123'),/mais de uma empresa/);
  failure=true;
  await assert.rejects(()=>api.loadMetaWhatsAppConnectionForCompany(a),/store unavailable/);
  await assert.rejects(()=>api.saveMetaWhatsAppConnection(a,input),/store unavailable/);
  console.log('PASS WhatsApp connection isolation: cross-tenant conflicts, persisted company mapping replaces old environment phone, disabled mapping suppresses fallback, no stale fallback on outage, legitimate save retained');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
