const assert=require('node:assert/strict');
const {createDatabase,seedCompanies,id}=require('./helpers/tenant-test-database.cjs');
(async()=>{
  const db=await createDatabase();
  try {
    await seedCompanies(db);
    for(const [record,company] of [[9001,1],[9002,1],[9003,2]]) {
      await db.query(`INSERT INTO leads(id,company_id,name,phone,source,goal,property_type,region,interest_profile)
        VALUES($1,$2,'Contato social fictício','','Instagram Direct','Não informado','Não informado','Não informado','{}')`,[id(record),id(company)]);
    }
    assert.equal((await db.query("SELECT count(*)::int AS count FROM leads WHERE phone='' AND company_id=$1",[id(1)])).rows[0].count,2,'independent social contacts do not need invented phone numbers');
    assert.equal((await db.query("SELECT count(*)::int AS count FROM leads WHERE phone='' AND company_id=$1",[id(2)])).rows[0].count,1,'separate tenant rows stay separate');
    await db.query("INSERT INTO leads(id,company_id,name,phone) VALUES($1,$2,'Retry must not overwrite','') ON CONFLICT(id) DO NOTHING",[id(9001),id(1)]);
    assert.equal((await db.query('SELECT name FROM leads WHERE id=$1',[id(9001)])).rows[0].name,'Contato social fictício');
    console.log('PASS social intake SQL: synthetic empty-phone contacts coexist, tenant ownership and conflict-safe insert preserved. Local PGlite schema only, not proof of remote schema or delivery.');
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exit(1);});
