// Real isolated SQL with synthetic rows; transport never contacts a live service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
const company = id(1), otherCompany = id(2);
const calls = [];
let db, beforeMutation;
async function transport(table, recordId, action, data = {}) {
  assert.equal(table,'appointments');
  assert.ok(['update','delete'].includes(action),'no separate stale-prone read/check');
  assert.match(recordId,/^[0-9a-f-]{36}$/);
  calls.push({action,recordId});
  if (beforeMutation) { const hook=beforeMutation;beforeMutation=undefined;await hook(); }
  return (await db.query('SELECT write_classic_crm_record($1,$2,$3,$4,$5,$6) row',[company,id(11),table,recordId,action,JSON.stringify(data)])).rows[0].row;
}
function loadDatabase() {
  const source=fs.readFileSync(path.join(__dirname,'../lib/database.ts'),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};
  const dependencies={
    '@neondatabase/serverless':{neon:()=>{throw Error('External database use forbidden');}},
    './supabase':{supabaseCompanyId:()=>company},
    './classic-crm-access':{writeClassicRow:transport},'./tenant-context':{},
    './leads':{},'./property-matching':{},'./lead-import':{},
  };
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},Date,Map,URLSearchParams,console,process:{env:{}}});
  return mod.exports;
}
async function run() {
  db=await createDatabase();
  try {
    for(const name of fs.readdirSync(path.resolve(__dirname,'../../../supabase/migrations')).filter(name=>name.endsWith('.sql')&&name>isolationMigration).sort())await db.exec(migration(name));
    await seedCompanies(db);
    const api=loadDatabase();let next=100;
    async function insert(status,tenant=company) {
      const recordId=id(next++);await db.query("INSERT INTO appointments(id,company_id,lead_id,property_id,status,scheduled_at,assigned_to,notes,created_at) VALUES($1,$2,$3,$4,$5,'2026-10-08T13:00:00Z','Corretor sintético','Cliente sintético · Imóvel sintético','2026-10-07T12:00:00Z')",[recordId,tenant,tenant===company?id(101):id(201),tenant===company?id(301):id(401),status]);return recordId;
    }
    const row=async recordId=>(await db.query('SELECT status FROM appointments WHERE id=$1',[recordId])).rows[0];
    for(const status of ['Aguardando','Agendada','Confirmada']) {
      const updateId=await insert(status), confirmed=await api.updateAppointmentStatus(updateId,'Confirmada');
      assert.equal(confirmed.status,'Confirmada');assert.equal((await row(updateId)).status,'Confirmada');
      const deleteId=await insert(status);assert.equal(await api.deleteAppointment(deleteId),true);assert.equal(await row(deleteId),undefined);
    }
    for(const status of ['Realizada','Ausência','Cancelada','Outro estado',null]) {
      const recordId=await insert(status);
      assert.equal(await api.updateAppointmentStatus(recordId,'Confirmada'),null);assert.equal((await row(recordId)).status,status);
      assert.equal(await api.deleteAppointment(recordId),false);assert.equal((await row(recordId)).status,status);
    }
    const foreign=await insert('Confirmada',otherCompany);assert.equal(await api.updateAppointmentStatus(foreign,'Aguardando'),null);assert.equal(await api.deleteAppointment(foreign),false);assert.equal((await row(foreign)).status,'Confirmada');
    const staleUpdate=await insert('Aguardando');beforeMutation=()=>db.query("UPDATE appointments SET status='Realizada' WHERE id=$1",[staleUpdate]);
    assert.equal(await api.updateAppointmentStatus(staleUpdate,'Confirmada'),null);assert.equal((await row(staleUpdate)).status,'Realizada','concurrent completion cannot be reopened');
    const staleDelete=await insert('Confirmada');beforeMutation=()=>db.query("UPDATE appointments SET status='Ausência' WHERE id=$1",[staleDelete]);
    assert.equal(await api.deleteAppointment(staleDelete),false);assert.equal((await row(staleDelete)).status,'Ausência','concurrent outcome cannot be deleted');
    assert.equal(await api.updateAppointmentStatus(id(999),'Confirmada'),null);assert.equal(await api.deleteAppointment(id(999)),false);
    assert.equal(calls.length,22);
    console.log('PASS: classic appointment mutations atomically restrict open statuses; completed/cancelled/absence history, tenant isolation and concurrent outcomes are preserved.');
  } finally { await db.close(); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
