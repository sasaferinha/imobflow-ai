const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const {createDatabase, seedCompanies, id, migration} = require('./helpers/tenant-test-database.cjs');
function load(name, deps) {
 const mod={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../lib',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>deps[n]||require(n),Date,Buffer,process,AbortSignal});
 return mod.exports;
}
async function main() {
 const meta=load('meta-whatsapp.ts',{});
 const echo=load('whatsapp-business-echo.ts',{'./meta-whatsapp':meta,'./supabase':{},'./whatsapp-media':{}});
 const connection={companyId:id(1),phoneNumberId:'123456789',enabled:true};
 const value={metadata:{phone_number_id:'123456789'},message_echoes:[{from:'55999999999',to:'5535999990001',id:'echo-1',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Olá'}}]};
 const payload=field=>({object:'whatsapp_business_account',entry:[{changes:[{field,value}]}]});
 assert.equal(echo.parseBusinessAppMessages(payload('messages'),[connection]).length,0);
 assert.equal(echo.parseBusinessAppMessages(payload('smb_message_echoes'),[{...connection,enabled:false}]).length,0);
 const parsed=echo.parseBusinessAppMessages(payload('smb_message_echoes'),[connection]);
 assert.equal(parsed.length,1); assert.equal(parsed[0].phone,'5535999990001');
 const db=await createDatabase();
 try {
  await db.exec(migration('20260912221000_message_recovery.sql'));
  await db.exec(migration('20260915200000_whatsapp_business_echo.sql'));
  await seedCompanies(db);
  await db.query("INSERT INTO conversation_settings(company_id,whatsapp_enabled,whatsapp_phone_number_id) VALUES($1,true,'123456789') ON CONFLICT(company_id) DO UPDATE SET whatsapp_enabled=true,whatsapp_phone_number_id='123456789'",[id(1)]);
  const save=async(company,phone,external)=> (await db.query("SELECT receive_business_app_message($1,$2,'123456789',$3,'Olá',now()) AS result",[company,phone,external])).rows[0].result;
  assert.equal((await save(id(1),'5535999990001','echo-1')).saved,true);
  assert.equal((await save(id(1),'5535999990001','echo-1')).saved,false);
  const row=(await db.query("SELECT m.*,c.bot_paused FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE external_message_id='echo-1'")).rows[0];
  assert.equal(row.direction,'outgoing'); assert.equal(row.sender_type,'human'); assert.equal(row.source_channel,'whatsapp_business'); assert.equal(row.bot_paused,true);
  await assert.rejects(save(id(2),'5535999990001','bad'),/connection_unavailable/);
  assert.equal((await save(id(1),'5535999990099','new')).saved,true);
  assert.equal((await save(id(1),'5535999990099','new')).saved,false);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM leads WHERE phone='+5535999990099'")).rows[0].n,1);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(save(id(1),'5535999990099','forbidden'),/permission denied/);
  console.log('PASS: echo routing, recipient, disabled connection, persistence, deduplication, human pause, tenant isolation, new contact and restricted RPC');
 } finally {await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
