const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
(async () => {
  const db = await createDatabase();
  try {
    const name = '20261102100000_meta_ads.sql';
    for (const file of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations')).filter(file => file.endsWith('.sql') && file > isolationMigration && file <= name).sort()) await db.exec(migration(file));
    await seedCompanies(db);
    await db.query('INSERT INTO meta_ads_connections(company_id,connected_by,token_ciphertext,account_id) VALUES($1,$2,$3,$4)', [id(1), id(11), 'synthetic-ciphertext', 'act_12345']);
    await db.query('INSERT INTO meta_ads_oauth_requests(state_hash,company_id,broker_id,redirect_uri,expires_at) VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')', ['a'.repeat(64), id(1), id(11), 'https://example.test/callback']);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(() => db.query('SELECT * FROM meta_ads_connections'), /permission denied/);
      await assert.rejects(() => db.query('DELETE FROM meta_ads_oauth_requests'), /permission denied/);
      await db.exec('RESET ROLE');
    }
    await db.exec('SET ROLE service_role');
    const consume = () => db.query('DELETE FROM meta_ads_oauth_requests WHERE state_hash=$1 AND expires_at>now() RETURNING company_id', ['a'.repeat(64)]);
    assert.equal((await consume()).rows[0].company_id, id(1)); assert.equal((await consume()).rows.length, 0, 'one-time authorization');
    await assert.rejects(() => db.query('UPDATE meta_ads_connections SET account_id=$1', ['../../other']), /check constraint/);
    console.log('Meta Ads SQL: migration, private token tables and one-time OAuth state passed.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
