// Isolated financial-access regression: never contact Neon or Supabase.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
let actor={companyId:'company-a',brokerId:'broker-a',role:'broker',name:'Nome igual ao histórico'},reads=0;
class ClassicCrmError extends Error{constructor(message,status=403){super(message);this.status=status;}}
function load(file,deps){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:name=>{if(name in deps)return deps[name];throw Error(name);},Date,Map,Set,Error,console,process:{env:{DATABASE_URL:'mock'}}});return mod.exports;}
const noAccess=()=>{reads++;throw Error('must not access historical financial data');};
const db=load('lib/database.ts',{'@neondatabase/serverless':{neon:noAccess},'./supabase':{supabaseCompanyId:()=>actor.companyId,supabaseRequest:noAccess},'./tenant-context':{currentAccount:()=>actor},'./classic-crm-access':{ClassicCrmError},'./leads':{},'./property-matching':{},'./lead-import':{}});
const route=load('app/api/performance/route.ts',{'next/server':{NextResponse:{json:Response.json}},'@/lib/accounts':{protectedRoute:fn=>fn},'@/lib/admin-auth':{isAdminRequest:()=>true},'@/lib/tenant-context':{currentAccount:()=>actor},'@/lib/request-security':{hasSameOrigin:()=>true},'@/lib/classic-crm-access':{ClassicCrmError},'@/lib/database':{getPerformance:noAccess,createSale:noAccess},'@/lib/supabase':{supabaseRequest:noAccess}});
(async()=>{
 await assert.rejects(()=>db.getPerformance('2026-11'),error=>error.status===403);
 const read=await route.GET({nextUrl:{searchParams:new URLSearchParams('month=2026-11')}});
 assert.equal(read.status,403);assert.equal((await read.json()).code,'legacy_financial_owner_only');
 const write=await route.POST({json:async()=>{reads++;return {};}});
 assert.equal(write.status,403);assert.match((await write.json()).error,/negociação/);
 assert.equal(reads,0,'neither a matching name nor a valid broker session reveals or mutates historical financial rows');
 actor=null;await assert.rejects(()=>db.getPerformance('2026-11'),error=>error.status===401);assert.equal(reads,0);
 console.log('PASS legacy finance access: broker read and write denied before data access, names never infer financial identity, explicit route guidance, unauthenticated library access denied; owner behavior covered by property-deals suite.');
})().catch(error=>{console.error(error);process.exitCode=1;});
