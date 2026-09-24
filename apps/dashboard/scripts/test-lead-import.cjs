const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
let account={role:'owner',companyId:'company-a'}, saved=[], writes=0;
function load(file) {
  if(cache.has(file))return cache.get(file);
  const mod={exports:{}};
  const local=name=>{
    if(name==='next/server')return {NextResponse:{json:Response.json}};
    if(name==='@/lib/accounts')return {protectedRoute:fn=>fn};
    if(name==='@/lib/admin-auth')return {isAdminRequest:()=>!!account};
    if(name==='@/lib/tenant-context'||name==='./tenant-context')return {currentAccount:()=>account};
    if(name==='@/lib/database')return {importLeads:async rows=>{saved=rows;writes++;return {imported:rows.length,skipped:0,leads:rows};}};
    if(name==='@/lib/supabase')return {supabaseRequest:async url=>{assert.ok(url.includes('company_id=eq.company-a'));return [{name:'Marina'}];}};
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
    if(name.startsWith('.'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');
    return require(name);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:local,Buffer,Date,URL,Response,Request,console});
  cache.set(file,mod.exports);return mod.exports;
}
async function main(){
  const {parseLeadImport,validateImportLead,leadImportTemplate}=load('lib/lead-import.ts');
  const row={name:'Ana',phone:'(35) 99999-0000',goal:'compra',propertyType:'casa',region:'Centro',budget:'Até R$ 500 mil',lastContactAt:'14/09/2026'};
  const valid=validateImportLead({...row,company_id:'foreign'});
  assert.equal(valid.phone,'5535999990000');assert.equal(valid.budget,'Até R$ 500.000');assert.equal(valid.company_id,undefined);
  const parsed=parseLeadImport('\uFEFFNome;Telefone;Observações\r\nAna;35999990000;"Linha 1; detalhe\nLinha 2"');
  assert.equal(parsed.length,1);assert.equal(parsed[0].details,'Linha 1; detalhe\nLinha 2');
  assert.equal(parseLeadImport('Nome,Email\nAna,ana@example.test')[0].email,'ana@example.test');
  for(const patch of [{phone:'sem telefone'},{email:'errado'},{budget:'a combinar'},{lastContactAt:'31/02/2026'},{goal:'Passear'},{propertyType:'desconhecido'}])assert.throws(()=>validateImportLead({...row,...patch}));
  assert.throws(()=>parseLeadImport(leadImportTemplate),/pelo menos/);
  assert.throws(()=>parseLeadImport('Nome;Telefone\n'+Array(501).fill('Ana;35999990000').join('\n')),/500/);
  assert.throws(()=>parseLeadImport('Nome;Telefone\nAna;35999990000\n;35999991111'),/Registro 2/);
  assert.throws(()=>parseLeadImport('Nome;Telefone\n"Ana;35999990000'),/Aspas/);
  const {POST}=load('app/api/leads/import/route.ts');
  const req=(body,origin='https://app.test')=>{const r=new Request('https://app.test/api/leads/import',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});r.nextUrl=new URL(r.url);return r;};
  assert.equal((await POST(req({leads:[row]}))).status,201);assert.equal(saved[0].budget,'Até R$ 500.000');
  const before=writes;
  assert.equal((await POST(req({leads:[row,{...row,name:''}]}))).status,400);
  assert.equal((await POST(req({leads:Array(501).fill(row)}))).status,400);
  assert.equal((await POST(req({leads:[{...row,assignedTo:'Outra empresa'}]}))).status,400);
  assert.equal((await POST(req({leads:[row]},'https://evil.test'))).status,403);
  account={...account,role:'broker'};assert.equal((await POST(req({leads:[row]}))).status,403);
  account=null;assert.equal((await POST(req({leads:[row]}))).status,401);assert.equal(writes,before);
  console.log('PASS import: CSV, multiline, normalization, invalid rows, 500 limit, admin-only, broker scope, CSRF, no partial saves.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
