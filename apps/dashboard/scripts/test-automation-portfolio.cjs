// Actual automation SQL runs in PGlite. No Neon/Supabase network, provider calls
// or real customer data. The production modules are transpiled without edits.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = id(1), timestamp = '2026-11-01T12:00:00.000Z';
let account = { companyId: company, brokerId: id(12), name: 'Corretor A', role: 'broker' };
const leadRows = [
  { id: id(101), company_id: company, name: 'Cliente A', phone: '5535999990101', assigned_to: 'Corretor A', lifecycle_status: 'Novo', created_at: timestamp },
  { id: id(102), company_id: company, name: 'Cliente B', phone: '5535999990102', assigned_to: 'Corretor B', lifecycle_status: 'Novo', created_at: timestamp },
];
const reads = [];

(async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE site_automation_settings(company_id uuid,id text,active boolean DEFAULT false,PRIMARY KEY(company_id,id));
      CREATE TABLE site_automation_lock(company_id uuid PRIMARY KEY,token uuid,expires_at timestamptz);
      CREATE TABLE site_automation_results(id uuid DEFAULT gen_random_uuid(),company_id uuid,flow_id text,lead_id uuid,fingerprint text,summary text,detail jsonb,status text,created_at timestamptz DEFAULT now(),UNIQUE(company_id,flow_id,lead_id,fingerprint));
      CREATE TABLE site_automation_runs(id uuid DEFAULT gen_random_uuid(),company_id uuid,flow_id text,trigger text,status text,processed integer,message text,created_at timestamptz DEFAULT now());
    `);
    for (const lead of leadRows) {
      await db.query("INSERT INTO site_automation_results(company_id,flow_id,lead_id,fingerprint,summary,detail,status) VALUES($1,'followup',$2,$3,'Fixture',$4,'open')", [company, lead.id, lead.id, JSON.stringify({ contactVersion: timestamp })]);
    }
    await db.query("INSERT INTO site_automation_results(company_id,flow_id,lead_id,detail,status) VALUES($1,'followup',$2,$3,'open')", [id(2), id(201), JSON.stringify({ contactVersion: timestamp })]);
    const sql = async (parts, ...values) => {
      const query = parts.reduce((result, part, index) => result + (index ? `$${index}` : '') + part, '');
      return (await db.query(query, values)).rows;
    };
    const supabaseRequest = async (resource, options = {}) => {
      reads.push(resource);
      if (resource.startsWith('leads?')) {
        assert.equal(new URLSearchParams(resource.split('?')[1]).get('company_id'), `eq.${company}`);
        assert.equal(options.allRows, true, 'internal full-company read remains paginated');
        return leadRows;
      }
      if (resource === 'rpc/read_classic_crm_records') {
        assert.equal(options.body.p_company_id, company);
        assert.equal(options.body.p_actor_id, account.brokerId);
        return account.role === 'owner' ? leadRows : leadRows.filter(row => row.assigned_to === account.name);
      }
      if (resource.startsWith('properties?')) return [];
      throw Error(`Unexpected synthetic Supabase operation: ${resource}`);
    };
    const cache = new Map();
    function load(file) {
      file = path.normalize(file);
      if (cache.has(file)) return cache.get(file);
      const mod = { exports: {} };
      cache.set(file, mod.exports);
      const requireMock = name => {
        if (name === 'node:crypto') return require(name);
        if (name === '@neondatabase/serverless') return { neon: () => sql };
        const resolved = name.startsWith('.') ? path.join(path.dirname(file), name) : name;
        const normalized = resolved.replaceAll('\\', '/');
        if (normalized === 'lib/supabase') return { supabaseCompanyId: () => account.companyId, supabaseRequest };
        if (normalized === 'lib/tenant-context') return { currentAccount: () => account };
        return load(`${resolved}.ts`);
      };
      const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      vm.runInNewContext(source, { module: mod, exports: mod.exports, require: requireMock, Date, Map, Set, Error, console, Buffer, process: { env: { DATABASE_URL: 'synthetic-no-network' } } }, { filename: file });
      return mod.exports;
    }
    const database = load('lib/database.ts'), automations = load('lib/automations.ts');
    const statuses = async () => (await db.query("SELECT lead_id,status FROM site_automation_results WHERE flow_id='followup' ORDER BY lead_id")).rows;
    assert.deepEqual((await database.listLeads()).map(row => row.id), [id(101)], 'browser broker read stays within the portfolio');
    reads.length = 0;
    await automations.runAutomations('event');
    assert(reads.some(resource => resource.startsWith('leads?')), 'company-wide reconciliation uses the explicitly internal read');
    assert(!reads.includes('rpc/read_classic_crm_records'), 'a partial broker list must never cancel other portfolios');
    assert.deepEqual(await statuses(), [{ lead_id: id(101), status: 'open' }, { lead_id: id(102), status: 'open' }, { lead_id: id(201), status: 'open' }]);
    leadRows[0].lifecycle_status = 'Convertido';
    await automations.runAutomationsAfterEvent();
    assert.deepEqual(await statuses(), [{ lead_id: id(101), status: 'cancelled' }, { lead_id: id(102), status: 'open' }, { lead_id: id(201), status: 'open' }], 'only obsolete followup is cancelled; other broker and tenant survive');
    account = { ...account, brokerId: 'system', role: 'owner' };
    await automations.runAutomations('cron');
    assert.equal((await statuses()).find(row => row.lead_id === id(102)).status, 'open', 'scheduler still reads the entire company without a browser UUID');
    account = { ...account, brokerId: id(12), role: 'broker' };
    const draft = (await db.query("INSERT INTO site_automation_results(company_id,flow_id,lead_id,detail,status) VALUES($1,'new-property',$2,'{}','open') RETURNING id", [company, id(102)])).rows[0].id;
    const result = await automations.prepareMatchMessage(draft);
    assert(result.error, 'interactive preparation cannot send a draft belonging to another portfolio');
    assert.equal(result.phone, undefined);
    console.log('PASS automation portfolio: real reconciliation SQL preserves other brokers and tenants after broker-triggered events; internal full-company reads retain pagination; cron works without browser identity; interactive Match remains scoped. No network.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
