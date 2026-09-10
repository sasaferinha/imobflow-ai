// Isolated PostgreSQL/WASM validation. Never connects to the live database.
// Supply an installed @electric-sql/pglite entry point as PGLITE_MODULE.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const root=path.resolve(__dirname,'../../..');
async function run(){
  const db=await PGlite.create();
  try {
    // Minimal pre-existing CRM/account schema needed by the exact migration.
    // The production migration is never rewritten for the test.
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE companies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,slug text NOT NULL UNIQUE);
      CREATE TABLE account_companies(company_id uuid PRIMARY KEY REFERENCES companies(id),name text NOT NULL,name_key text NOT NULL UNIQUE,seat_limit int NOT NULL DEFAULT 5);
      CREATE TABLE access_licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),key_hash text UNIQUE NOT NULL,company_id uuid REFERENCES companies(id),seat_limit integer NOT NULL,active boolean NOT NULL DEFAULT true,expires_at timestamptz,redeemed_at timestamptz);
      CREATE TABLE broker_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES account_companies(company_id),name text NOT NULL,name_key text NOT NULL,email text,email_key text,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('owner','broker')),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(company_id,name_key),UNIQUE(company_id,email_key));
      CREATE TABLE account_sessions(token_hash text PRIMARY KEY,broker_id uuid NOT NULL REFERENCES broker_accounts(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260909080000_fix_broker_provisioning.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260910090000_account_recovery_and_staff.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260910110000_basic_three_brokers.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/tests/account_recovery_and_staff.sql'),'utf8'));
    assert.equal((await db.query('SELECT count(*)::int AS total FROM companies')).rows[0].total,0);
    const baseline=fs.readFileSync(path.join(root,'neon/migrations/20260910090000_runtime_schema_baseline.sql'),'utf8');
    await db.exec(baseline);
    await db.exec(baseline);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM imobflow_schema_migrations')).rows[0].total,1);
    console.log('PASS PostgreSQL migration syntax and recovery/expiry/reuse/password/email invalidation/seat/tenant tests; fixtures rolled back');
    console.log('PASS Neon baseline on an empty database and repeated application');
    console.log('Isolated PGlite test only: live schema, concurrency between independent connections, backups and deployed endpoints remain separate checks.');
  } finally {await db.close();}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
