const assert = require('node:assert/strict');
const { check, schemaProblems, requiredTables, requiredFunctions } = require('./check-crm-schema.cjs');
const schema = { definitions: Object.fromEntries(Object.entries(requiredTables).map(([name, cols]) => [name, { properties: Object.fromEntries(cols.map(col => [col, {}])) }])),
  paths: Object.fromEntries(requiredFunctions.map(name => [`/rpc/${name}`, { post: {} }])) };
async function main() {
  assert.deepEqual(schemaProblems(schema), []);
  let calls = 0;
  const env = { SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SECRET_KEY: 'fixture-key' };
  const request = async (url, options) => {
    calls++;
    assert.equal(url, 'https://fixture.supabase.co/rest/v1/');
    assert.equal(options.method, undefined, 'only GET metadata, never SQL/mutations');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.apikey, 'fixture-key');
    return { ok: true, json: async () => schema };
  };
  assert.deepEqual(await check({ env, request }), { skipped: false });
  assert.equal(calls, 1);
  assert.deepEqual(await check({ env: {}, request, optional: true }), { skipped: true });
  await assert.rejects(() => check({ env: { VERCEL: '1' }, request, optional: true }), /obrigatórios/);
  await assert.rejects(() => check({ env: { SUPABASE_URL: env.SUPABASE_URL }, request }), /obrigatórios/);
  await assert.rejects(() => check({ env: { ...env, SUPABASE_URL: 'http://fixture.supabase.co' }, request }), /inválida/);
  delete schema.definitions.messages.properties.dashboard_hidden_at;
  delete schema.paths['/rpc/update_account_profile'];
  await assert.rejects(() => check({ env, request }), error => /messages.dashboard_hidden_at/.test(error.message) && /update_account_profile/.test(error.message) && !error.message.includes('fixture-key'));
  console.log('PASS CRM release gate: metadata only, required columns/RPCs, missing config/schema fail closed, no secret output');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
