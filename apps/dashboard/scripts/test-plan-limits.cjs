const assert=require('node:assert/strict');
const {createDatabase,migration}=require('./helpers/tenant-test-database.cjs');
(async()=>{
 const db=await createDatabase();
 try {
  await db.exec(migration('20260915210000_plan_broker_limits.sql'));
  for(const seats of [5,8,12]) {
   const hash=String(seats).padStart(64,'a');
   await db.query('SELECT create_access_license($1,$2,NULL)',[hash,seats]);
   const {rows}=await db.query("SELECT * FROM redeem_access_license($1,$2,$2,'Owner','owner',$3,$3,'scrypt-v1$fixture')",[hash,'Company '+seats,`owner${seats}@example.test`]);
   const company=rows[0].company_id;
   assert.equal((await db.query('SELECT seat_limit FROM account_companies WHERE company_id=$1',[company])).rows[0].seat_limit,seats);
   const add=n=>db.query("SELECT * FROM create_company_broker($1,$2,$2,$3,$3,'scrypt-v1$fixture')",[company,'Broker '+n,`broker${seats}-${n}@example.test`]);
   for(let n=0;n<seats;n++) await add(n);
   await assert.rejects(add(seats),/seat_limit_reached/);
   const first=(await db.query("SELECT id FROM broker_accounts WHERE company_id=$1 AND role='broker' ORDER BY created_at LIMIT 1",[company])).rows[0].id;
   await db.query('SELECT * FROM set_company_broker_active($1,$2,false)',[rows[0].broker_id,first]);
   await add(seats);
   await assert.rejects(db.query('SELECT * FROM set_company_broker_active($1,$2,true)',[rows[0].broker_id,first]),/seat_limit_reached/);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM broker_accounts WHERE company_id=$1 AND active',[company])).rows[0].n,seats+1);
   await assert.rejects(db.query("SELECT * FROM redeem_access_license($1,'Other','other','Owner','owner','other@example.test','other@example.test','scrypt-v1$fixture')",[hash]),/invalid_license/);
  }
  for(const n of [0,3,6,100]) await assert.rejects(db.query('SELECT create_access_license($1,$2,NULL)',['f'.repeat(64),n]),/invalid_plan_license/);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT create_access_license($1,12,NULL)',['b'.repeat(64)]),/permission denied/);
  console.log('PASS Basic 5 / Plus 8 / Pro 12: license redemption, separate owner, exact broker limits, excess blocked, single-use license, invalid plans and restricted access');
 } finally {await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
