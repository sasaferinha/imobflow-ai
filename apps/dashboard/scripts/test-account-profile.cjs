// No remote access: API validation and exact PostgreSQL RPC in isolated PGlite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../..');
const companyA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const companyB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const brokerA = '11111111-1111-4111-8111-111111111111';
const brokerB = '22222222-2222-4222-8222-222222222222';
const ownerA = '33333333-3333-4333-8333-333333333333';

async function run() {
  let calls = [];
  let actor = { companyId: companyA, brokerId: brokerA, name: 'Ana Original', company: 'Empresa A', role: 'broker' };
  let failure = null;
  const source = fs.readFileSync(path.join(__dirname, '../app/api/account/profile/route.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const deps = {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } },
    '@/lib/accounts': { protectedRoute: fn => async req => actor ? fn(req) : { status: 401 }, normalizeName: value => value.toLowerCase() },
    '@/lib/tenant-context': { currentAccount: () => actor },
    '@/lib/request-security': { hasSameOrigin: request => request.safe },
    '@/lib/supabase': { supabaseRequest: async (route, options) => {
      calls.push({ route, options });
      if (failure) throw new Error(failure);
      return [{ broker_id: brokerA, name: options.body.p_name, company: options.body.p_company, role: 'broker' }];
    } },
  };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require: key => deps[key], Buffer, Error });
  const route = mod.exports;
  const payload = { name: 'Ana Nova', company: 'Empresa A', expectedName: actor.name, expectedCompany: actor.company };
  const request = (body = payload, safe = true) => ({ safe, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await route.GET()).body.data.brokerId, brokerA);
  assert.equal((await route.PATCH(request(payload, false))).status, 403);
  assert.equal((await route.PATCH(request('{'))).status, 400);
  assert.equal((await route.PATCH(request('null'))).status, 400);
  assert.equal((await route.PATCH(request('x'.repeat(5000)))).status, 413);
  assert.equal((await route.PATCH(request({ ...payload, name: 'a' }))).status, 400);
  assert.equal((await route.PATCH(request({ ...payload, company: 'Outra empresa' }))).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await route.PATCH(request({ ...payload, brokerId: brokerB, companyId: companyB }))).status, 200);
  assert.equal(calls[0].route, 'rpc/update_account_profile');
  assert.equal(calls[0].options.body.p_broker_id, brokerA, 'request cannot impersonate a broker');
  assert.equal(calls[0].options.body.p_company_id, companyA, 'request cannot change tenant');
  failure = 'Supabase 409: 23505 constraint';
  assert.equal((await route.PATCH(request())).status, 409);
  failure = 'private internal error';
  const unavailable = await route.PATCH(request());
  assert.equal(unavailable.status, 503);
  assert.ok(!JSON.stringify(unavailable.body).includes('private'));
  actor = null;
  assert.equal((await route.PATCH(request())).status, 401);
  console.log('PASS profile API session identity, validation, same-origin, broker restrictions and safe errors');

  const db = await PGlite.create();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE companies(id uuid PRIMARY KEY,name text NOT NULL);
      CREATE TABLE account_companies(company_id uuid PRIMARY KEY REFERENCES companies(id),name text NOT NULL,name_key text UNIQUE);
      CREATE TABLE broker_accounts(id uuid PRIMARY KEY,company_id uuid NOT NULL,name text NOT NULL,name_key text NOT NULL,role text NOT NULL,active boolean NOT NULL DEFAULT true,UNIQUE(company_id,name_key));
      CREATE TABLE conversations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,assigned_broker_id uuid,assigned_to text);
      CREATE TABLE leads(LIKE conversations INCLUDING ALL);
      CREATE TABLE appointments(LIKE conversations INCLUDING ALL);
      INSERT INTO companies VALUES('${companyA}','Empresa A'),('${companyB}','Empresa B');
      INSERT INTO account_companies VALUES('${companyA}','Empresa A','empresa a'),('${companyB}','Empresa B','empresa b');
      INSERT INTO broker_accounts(id,company_id,name,name_key,role) VALUES
        ('${brokerA}','${companyA}','Ana Original','ana original','broker'),
        ('${brokerB}','${companyB}','Ana Original','ana original','broker'),
        ('${ownerA}','${companyA}','Administrador','administrador','owner');
      INSERT INTO conversations(company_id,assigned_broker_id,assigned_to) VALUES('${companyA}','${brokerA}','Ana Original'),('${companyB}','${brokerB}','Ana Original');
      INSERT INTO leads SELECT * FROM conversations; INSERT INTO appointments SELECT * FROM conversations;`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260924110000_account_profile.sql'), 'utf8'));
    const update = (id, name, company, previous, previousCompany = 'Empresa A', tenant = companyA) => db.query(
      'SELECT * FROM update_account_profile($1,$2,$3,$4,$5,$6,$7,$8)', [tenant, id, name, name.toLowerCase(), company, company.toLowerCase(), previous, previousCompany]);
    assert.equal((await update(brokerA, 'Ana Nova', 'Empresa A', 'Ana Original')).rows[0].name, 'Ana Nova');
    for (const table of ['conversations', 'leads', 'appointments']) {
      assert.equal((await db.query(`SELECT assigned_to FROM ${table} WHERE company_id=$1`, [companyA])).rows[0].assigned_to, 'Ana Nova');
      assert.equal((await db.query(`SELECT assigned_to FROM ${table} WHERE company_id=$1`, [companyB])).rows[0].assigned_to, 'Ana Original');
    }
    assert.equal((await update(brokerA, 'Nome atrasado', 'Empresa A', 'Ana Original')).rows.length, 0, 'stale edit rejected');
    await assert.rejects(() => update(brokerA, 'Ana Nova', 'Empresa X', 'Ana Nova'), /owner_required/);
    await assert.rejects(() => update(brokerB, 'Intruso', 'Empresa A', 'Ana Original'), /profile_unavailable/);
    await assert.rejects(() => update(brokerA, 'Administrador', 'Empresa A', 'Ana Nova'), /unique/);
    assert.equal((await db.query('SELECT name FROM broker_accounts WHERE id=$1', [brokerA])).rows[0].name, 'Ana Nova', 'duplicate conflict rolled back');
    assert.equal((await update(ownerA, 'Gestor', 'Empresa Renomeada', 'Administrador')).rows[0].company, 'Empresa Renomeada');
    assert.equal((await db.query('SELECT name FROM companies WHERE id=$1', [companyA])).rows[0].name, 'Empresa Renomeada');
    await db.exec(`UPDATE broker_accounts SET active=false WHERE id='${brokerA}'`);
    await assert.rejects(() => update(brokerA, 'Ana Offline', 'Empresa Renomeada', 'Ana Nova', 'Empresa Renomeada'), /profile_unavailable/);
    const permissions = (await db.query("SELECT has_function_privilege('anon','update_account_profile(uuid,uuid,text,text,text,text,text,text)','EXECUTE') AS anon, has_function_privilege('authenticated','update_account_profile(uuid,uuid,text,text,text,text,text,text)','EXECUTE') AS authenticated")).rows[0];
    assert.equal(permissions.anon, false);
    assert.equal(permissions.authenticated, false);
    console.log('PASS profile PostgreSQL RPC: atomic persistence, renamed assignments, tenants, conflicts, permissions, inactive accounts and stale edits');
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
