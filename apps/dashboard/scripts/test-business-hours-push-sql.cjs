const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const {createDatabase, seedCompanies, id, migration, isolationMigration} = require('./helpers/tenant-test-database.cjs');
const root = path.resolve(__dirname, '..');
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/business-hours.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const moduleState = {exports: {}};
vm.runInNewContext(source, {module: moduleState, exports: moduleState.exports, Intl, Date});
const {defaultBusinessHours: defaults, businessTime, validateBusinessHours} = moduleState.exports;

(async () => {
 const db = await createDatabase();
 try {
  for (const file of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations')).filter(file => file.endsWith('.sql') && file > isolationMigration).sort()) await db.exec(migration(file));
  await seedCompanies(db);
  const save = async (settings, company = 1) => db.query('INSERT INTO conversation_settings(company_id,business_hours) VALUES($1,$2::jsonb) ON CONFLICT(company_id) DO UPDATE SET business_hours=EXCLUDED.business_hours', [id(company), JSON.stringify(settings)]);
  const open = async (at, company = 1) => (await db.query('SELECT web_push_business_hours_open($1,$2::timestamptz) value', [id(company), at])).rows[0].value;
  assert.equal((await db.query('SELECT urgent_alert_policy_version() version')).rows[0].version, 3);
  for (const settings of [undefined, {}]) {
   if (settings === undefined) await db.query('DELETE FROM conversation_settings WHERE company_id=$1', [id(1)]); else await save(settings);
   assert.equal(await open('2026-10-19T10:59:59.999Z'), false, 'before default opening');
   assert.equal(await open('2026-10-19T11:00:00Z'), true, 'default opening inclusive');
   assert.equal(await open('2026-10-19T20:59:59.999Z'), true, 'before default closing');
   assert.equal(await open('2026-10-19T21:00:00Z'), false, 'default closing exclusive');
   assert.equal(await open('2026-10-18T15:00:00Z'), false, 'default Sunday closed');
  }
  const scenarios = [
   [defaults, '2026-10-19T11:00:00Z'],
   [{...defaults, timeZone: 'america/sao_paulo'}, '2026-10-19T15:00:00Z'],
   [{...defaults, timeZone: 'America/Manaus'}, '2026-10-19T21:30:00Z'],
   [{...defaults, timeZone: 'Asia/Kathmandu'}, '2026-10-19T02:15:00Z'],
   [{...defaults, timeZone: 'Pacific/Kiritimati'}, '2026-10-18T18:00:00Z'],
   [{...defaults, holidays: ['2026-10-19']}, '2026-10-19T15:00:00Z'],
   [{...defaults, weekdays: [0, 0, 1, 2, 3, 4, 5, 6]}, '2026-10-18T15:00:00Z'],
   [{...defaults, holidays: ['0000-02-29', '2024-02-29']}, '2026-10-19T15:00:00Z'],
   [{...defaults, timeZone: 'America/New_York', opens: '01:00', closes: '02:30', weekdays: [0]}, '2026-03-08T06:59:59Z'],
   [{...defaults, timeZone: 'America/New_York', opens: '01:00', closes: '02:30', weekdays: [0]}, '2026-03-08T07:00:00Z'],
   [{...defaults, timeZone: 'America/New_York', opens: '01:00', closes: '01:30', weekdays: [0]}, '2026-11-01T05:30:00Z'],
   [{...defaults, timeZone: 'America/New_York', opens: '01:00', closes: '01:30', weekdays: [0]}, '2026-11-01T06:00:00Z'],
   [{...defaults, awayMessage: '😀'.repeat(500)}, '2026-10-19T15:00:00Z'],
  ];
  for (const [settings, at] of scenarios) {
   const expected = !businessTime(new Date(at), validateBusinessHours(settings)).afterHours;
   await save(settings);
   assert.equal(await open(at), expected, `JS/SQL business-time parity: ${settings.timeZone} ${at}`);
  }
  const invalid = [
   {timeZone: 'UTC'}, {...defaults, timeZone: 'Not/AZone'}, {...defaults, timeZone: 3},
   {...defaults, opens: '24:00'}, {...defaults, opens: ['08:00']}, {...defaults, closes: '08:00'},
   {...defaults, opens: '19:00', closes: '08:00'}, {...defaults, weekdays: []}, {...defaults, weekdays: ['1']},
   {...defaults, weekdays: [1.5]}, {...defaults, weekdays: [7]}, {...defaults, holidays: ['2026-02-30']},
   {...defaults, holidays: ['2025-02-29']}, {...defaults, holidays: ['2026-2-01']}, {...defaults, holidays: [null]},
   {...defaults, holidays: Array(367).fill('2026-01-01')}, {...defaults, awayMessage: '\t\n\u00a0\ufeff'},
   {...defaults, awayMessage: '😀'.repeat(501)}, {...defaults, awayMessage: null},
  ];
  for (const settings of invalid) {
   assert.throws(() => validateBusinessHours(settings));
   await save(settings);
   assert.equal(await open('2026-10-19T15:00:00Z'), false, 'invalid company fails closed without aborting others');
  }
  await save(defaults);
  assert.equal(await open(null), false); assert.equal(await open('infinity'), false);
  // Both companies deliberately use a named fixed zone with local noon now, so
  // this queue regression is independent of the machine's current hour/weekend.
  const offset = 12 - new Date().getUTCHours();
  const zone = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
  const alwaysOpen = {...defaults, timeZone: zone, opens: '00:00', closes: '23:59', weekdays: [0, 1, 2, 3, 4, 5, 6]};
  const localDate = businessTime(new Date(), alwaysOpen).date;
  await save({...alwaysOpen, holidays: [localDate]}, 1);
  await save(alwaysOpen, 2);
  const fixtures = Array.from({length: 602}, (_, i) => ({company: id(i === 601 ? 2 : 1), lead: id(10000 + i), conversation: id(20000 + i), message: id(30000 + i)}));
  const input = JSON.stringify(fixtures);
  await db.query("INSERT INTO leads(id,company_id,name,phone,assigned_to) SELECT lead,company,'Synthetic waiting client','000',NULL FROM jsonb_to_recordset($1::jsonb) AS rows(company uuid,lead uuid)", [input]);
  await db.query("INSERT INTO conversations(id,company_id,lead_id,status) SELECT conversation,company,lead,'Aberta' FROM jsonb_to_recordset($1::jsonb) AS rows(company uuid,lead uuid,conversation uuid)", [input]);
  await db.query("INSERT INTO messages(id,company_id,conversation_id,direction,sender_type,content,created_at) SELECT message,company,conversation,'incoming','client','Synthetic message',now()-interval '10 minutes' FROM jsonb_to_recordset($1::jsonb) AS rows(company uuid,conversation uuid,message uuid)", [input]);
  for (const [company, broker, character] of [[1, 11, 'a'], [2, 21, 'b']]) {
   const token = character.repeat(64);
   await db.query("INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [token, id(broker)]);
   await db.query('SELECT register_web_push($1,$2,$3,$4,$5::jsonb)', [id(company), id(broker), token, token, JSON.stringify({endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-${company}`, keys: {p256dh: 'fixture-only', auth: 'fixture-only'}})]);
  }
  assert.equal((await db.query('SELECT count(*)::int count FROM broker_unassigned_waiting($1,$2)', [id(1), id(11)])).rows[0].count, 601, 'fixture has more than former 600-row scan budget');
  const candidates = async (limit = 60, offset = 0) => (await db.query('SELECT list_web_push_candidates($1,$2) value', [limit, offset])).rows[0].value;
  const firstPage = await candidates(1);
  assert.equal(firstPage.length, 1); assert.equal(firstPage[0].lead_id, fixtures[601].lead, 'first page reaches open company after 601 closed candidates');
  assert.equal(firstPage[0].company_id, id(2));
  assert.equal((await candidates(1, 1)).length, 0, 'offset applies after business-hours filtering');
  await save({timeZone: 'invalid'}, 1);
  assert.equal((await candidates(1))[0].company_id, id(2), 'invalid company cannot starve valid open company');
  await save({...alwaysOpen, holidays: [localDate]}, 2);
  assert.equal((await candidates()).length, 0, 'all closed produces no notification candidates');
  const permissions = (await db.query("SELECT has_function_privilege('anon','web_push_business_hours_open(uuid,timestamptz)','EXECUTE') a,has_function_privilege('authenticated','web_push_business_hours_open(uuid,timestamptz)','EXECUTE') b,has_function_privilege('service_role','web_push_business_hours_open(uuid,timestamptz)','EXECUTE') service")).rows[0];
  assert.equal(permissions.a || permissions.b, false); assert.equal(permissions.service, true);
  console.log('PASS business-hours SQL: default/invalid distinction, JS parity, IANA offsets and DST, holidays and exact boundaries, UTF-16 validation, service-only helper, and 601 closed contacts cannot starve an open company before pagination. Local PGlite only.');
 } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
