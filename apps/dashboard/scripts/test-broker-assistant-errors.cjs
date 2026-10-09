// Isolated provider failures: no network, real keys or customer data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} }, logs = [];
let response;
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/ai/broker-assistant.ts'),'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module:mod, exports:mod.exports, require: name => { assert.equal(name,'server-only'); return {}; },
  process:{env:{OPENAI_API_KEY:'sk-private-synthetic-key'}}, AbortSignal, console:{warn:(...args)=>logs.push(args)}, fetch:async()=>response });
const input = { sector:'Geral', profile:{}, messages:[{id:'synthetic',side:'incoming',text:'Olá!'}] };
(async()=>{
  for (const test of [
    {status:400,code:'invalid_json_schema',param:'text.format.schema',message:/compatibilidade/},
    {status:401,code:'invalid_api_key',message:/credencial/},
    {status:403,code:'unknown',message:/permissões/},
    {status:404,code:'model_not_found',message:/modelo/},
    {status:429,code:'insufficient_quota',message:/saldo ou cota/},
    {status:429,code:'rate_limit_exceeded',message:/Aguarde/},
    {status:503,code:'sk-private-synthetic-key',param:'customer-private-payload',message:/temporariamente/},
  ]) {
    response = Response.json({error:{code:test.code,param:test.param,message:'sk-private-synthetic-key customer-private-payload'}}, {status:test.status,headers:{'x-request-id':'req_synthetic123'}});
    await assert.rejects(()=>mod.exports.generateBrokerAssistance(input), error => error.status===(test.status===429?429:503) && test.message.test(error.message) && !/private/.test(error.message));
  }
  assert.equal(logs.length,7);
  assert.equal(logs[0][1].code,'invalid_json_schema'); assert.equal(logs[0][1].parameter,'text.format.schema');
  assert.equal(logs[6][1].code,'unknown'); assert.equal(logs[6][1].parameter,null);
  assert.doesNotMatch(JSON.stringify(logs),/sk-private|customer-private|Olá/);
  response = new Response('private non-json error', {status:502,headers:{'x-request-id':'private-invalid-header'}});
  await assert.rejects(()=>mod.exports.generateBrokerAssistance(input),error=>error.status===503);
  assert.equal(logs.at(-1)[1].requestId,null);
  // The opt-in live checker must sanitize malicious error fields too, not just the runtime provider.
  const checker = fs.readFileSync(path.join(__dirname,'check-broker-assistant-live.cjs'),'utf8');
  for (const code of ['sk-private-synthetic-key','invalid_json_schema']) {
    const liveLogs = [], liveProcess = {argv:[],env:{OPENAI_API_KEY:'sk-private-synthetic-key'},exitCode:0};
    await vm.runInNewContext(checker,{require,__dirname,process:liveProcess,AbortSignal,
      console:{error:(...args)=>liveLogs.push(args),warn:(...args)=>liveLogs.push(args),log:(...args)=>liveLogs.push(args)},
      fetch:async()=>Response.json({error:{code,param:'customer-private-payload',message:'sk-private-synthetic-key customer-private-payload'}},{status:400}),
    });
    assert.equal(liveProcess.exitCode,1);
    assert.doesNotMatch(JSON.stringify(liveLogs),/sk-private|customer-private/);
  }
  console.log('PASS broker assistant diagnostics: schema/auth/model/quota/rate/outage distinguished; raw provider content, credentials and customer data never logged or returned.');
})().catch(error=>{console.error(error);process.exitCode=1;});
