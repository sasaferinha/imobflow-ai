const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createDatabase, seedCompanies, id, migration } = require('./helpers/tenant-test-database.cjs');
const root = path.resolve(__dirname, '..');
function load(file, deps) { const module = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: name => deps[name], Date, Map, Set, Intl }); return module.exports; }
(async () => {
  const db = await createDatabase();
  try {
    await seedCompanies(db); await db.exec(migration('20261102130000_buyer_reports.sql'));
    const reports = load('lib/evolution/buyer-report.ts', {}), now = new Date('2026-11-02T12:00:00Z');
    const state = { companyId: id(1), settings: { buyerReportFrequency: 'monthly' }, records: [], events: [], members: [] };
    let writes = 0;
    const store = load('lib/evolution/buyer-report-store.ts', { './buyer-report': reports, '../supabase': { supabaseServiceRequest: async (url, options = {}) => {
      if (options.method === 'POST') {
        writes++; const body = options.body;
        assert.equal(options.prefer, 'resolution=ignore-duplicates,return=representation');
        return (await db.query('INSERT INTO crm_buyer_reports(company_id,frequency,period_key,period_start,period_end,generated_at,report) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING period_key', [body.company_id, body.frequency, body.period_key, body.period_start, body.period_end, body.generated_at, JSON.stringify(body.report)])).rows;
      }
      const params = new URLSearchParams(url.split('?')[1]); assert.equal(params.get('company_id'), `eq.${id(1)}`);
      const result = await db.query('SELECT * FROM crm_buyer_reports WHERE company_id=$1 AND frequency=$2 ORDER BY period_start DESC', [id(1), params.get('frequency').slice(3)]);
      const key = params.get('period_key'); return result.rows.filter(row => !key || row.period_key === key.slice(3)).map(row => ({ ...row, generated_at: row.generated_at.toISOString?.() || row.generated_at }));
    } } });
    await db.exec('SET ROLE service_role');
    const results = await Promise.all([store.generateScheduledBuyerReport(state, now), store.generateScheduledBuyerReport(state, now)]);
    assert.equal(results.filter(row => row.status === 'generated').length, 1);
    assert.equal((await store.generateScheduledBuyerReport(state, now)).status, 'already-generated');
    assert.equal((await db.query('SELECT * FROM crm_buyer_reports')).rows.length, 1);
    const rows = await store.readScheduledBuyerReports(id(1), 'monthly'); assert.equal(rows[0].periodKey, '2026-10'); assert.equal(rows[0].report.sales, 0);
    state.settings.buyerReportFrequency = 'weekly'; assert.equal((await store.generateScheduledBuyerReport(state, now)).status, 'generated');
    assert.equal((await db.query('SELECT * FROM crm_buyer_reports')).rows.length, 2);
    await assert.rejects(() => db.query("UPDATE crm_buyer_reports SET report='{}'"), /permission denied/);
    await db.exec('RESET ROLE');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`); await assert.rejects(() => db.query('SELECT * FROM crm_buyer_reports'), /permission denied/); await db.exec('RESET ROLE');
    }
    assert.ok(writes >= 2);
    console.log('PASS scheduled buyer reports: actual SQL, private snapshots, SP weekly/monthly cadence, concurrent idempotence and immutable service permissions.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
