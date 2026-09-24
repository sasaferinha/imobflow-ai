const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { AsyncLocalStorage } = require('node:async_hooks');
const { PGlite } = require('@electric-sql/pglite');
const context = new AsyncLocalStorage();
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calls = [];
let db;
function load(file, overrides) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: name => {
    if (name in overrides) return overrides[name];
    throw Error(`Unexpected dependency ${name}`);
  }, Date, Map, URLSearchParams, console });
  return module.exports;
}
// Translate only the read syntax used by the production page into parameterized SQL.
// No network, real credentials, customer data, or outgoing messages.
async function request(resource, options = {}) {
  const [table, query] = resource.split('?');
  assert.ok(['conversations', 'messages', 'message_delivery_events', 'message_outbox'].includes(table));
  const params = new URLSearchParams(query);
  assert.equal(params.get('company_id'), `eq.${context.getStore()}`);
  if (table === 'messages') {
    assert.ok(!options.allRows, 'Message history must never use an unbounded read');
    assert.ok(Number(params.get('limit')) <= 201);
  }
  if (table === 'message_outbox') assert.ok(params.has('id'));
  if (table === 'message_delivery_events') assert.ok(params.has('external_message_id'));
  calls.push({ table, params });
  const values = [], predicates = [];
  const bind = value => { values.push(value); return `$${values.length}`; };
  for (const [key, value] of params) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    if (key === 'or') {
      const match = value.match(/^\(created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)\)$/);
      assert.ok(match); assert.equal(match[1], match[2]);
      predicates.push(`(created_at,id)<(${bind(match[1])}::timestamptz,${bind(match[3])}::uuid)`);
    } else {
      assert.match(key, /^[a-z_]+$/);
      if (value.startsWith('eq.')) predicates.push(`${key}=${bind(value.slice(3))}`);
      else {
        assert.ok(value.startsWith('in.('));
        predicates.push(`${key} IN (${value.slice(4, -1).split(',').map(v => bind(v.replace(/^"|"$/g, ''))).join(',')})`);
      }
    }
  }
  const columns = params.get('select') || '*'; assert.match(columns, /^[a-z_,*]+$/);
  const order = params.get('order');
  const orderSql = order ? ' ORDER BY ' + order.split(',').map(v => { const [column, direction] = v.split('.'); assert.match(column, /^[a-z_]+$/); return `${column} ${direction === 'desc' ? 'DESC' : 'ASC'}`; }).join(',') : '';
  const limit = Number(params.get('limit') || 10000);
  const result = await db.query(`SELECT ${columns} FROM ${table} WHERE ${predicates.join(' AND ')}${orderSql} LIMIT ${limit}`, values);
  return result.rows.map(row => ({ ...row, ...(row.created_at ? { created_at: new Date(row.created_at).toISOString() } : {}) }));
}
(async () => {
  db = await PGlite.create();
  await db.exec(`
    CREATE TABLE conversations(id uuid PRIMARY KEY,company_id uuid,lead_id uuid,status text,assigned_broker_id uuid,assigned_to text,bot_paused boolean);
    CREATE TABLE messages(id uuid PRIMARY KEY,company_id uuid,conversation_id uuid,created_at timestamptz,direction text,content text,external_message_id text,media_urls jsonb);
    CREATE TABLE message_delivery_events(company_id uuid,external_message_id text,status text,error_code int);
    CREATE TABLE message_outbox(id uuid,company_id uuid,state text,attempts int,next_attempt_at text);
    INSERT INTO conversations SELECT ('00000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,
      ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      ('00000000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,'open',NULL,NULL,false FROM generate_series(1,30) n;
    INSERT INTO messages SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${id(1)}','${id(101)}',
      '2026-09-15 12:00:00Z'::timestamptz + (n/3)*interval '1 second','incoming','Fictício',NULL,'[]' FROM generate_series(1,12050) n;
    INSERT INTO messages SELECT gen_random_uuid(),company_id,id,now(),'incoming','Outra empresa',NULL,'[]' FROM conversations WHERE company_id<>'${id(1)}';
  `);
  await db.exec(fs.readFileSync(path.resolve(root, '../../supabase/migrations/20260915220000_conversation_read_indexes.sql'), 'utf8'));
  await db.exec(`UPDATE messages SET external_message_id=repeat('w',450)||id::text,direction='outgoing' WHERE company_id='${id(1)}' AND id>'${id(12990)}';
    INSERT INTO message_delivery_events SELECT company_id,external_message_id,'read',NULL FROM messages WHERE external_message_id IS NOT NULL;`);
  const api = load('lib/conversations.ts', {
    './supabase': { supabaseCompanyId: () => context.getStore(), supabaseRequest: request },
    './tenant-context': { currentAccount: () => null },
    './whatsapp-media': { isWhatsAppMediaPath: () => false, isWhatsAppAudioPath: () => false },
    './message-delivery': { deliveryError: () => 'Falha' }, './message-outbox': {},
  });
  await context.run(id(1), async () => {
    const initial = await api.listConversationData(); assert.equal(initial.messages.length, 200);
    assert.equal(initial.messages.at(-1).deliveryStatus, 'read');
    assert.ok(calls.filter(call => call.table === 'message_delivery_events').every(call => call.params.toString().length < 7000), 'Long provider IDs stay within bounded request URLs');
    let cursor, seen = new Set();
    do {
      const page = await api.listConversationData({ leadId: id(201), before: cursor });
      assert.ok(page.messages.length <= 50);
      for (const message of page.messages) { assert.ok(!seen.has(message.id), 'Duplicate across cursor boundaries'); seen.add(message.id); assert.equal(message.leadId, id(201)); }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 12050, 'Complete history remains reachable, including identical timestamps');
    const foreign = await api.listConversationData({ leadId: id(202) }); assert.equal(foreign.messages.length, 0);
    await assert.rejects(() => api.listConversationData({ leadId: id(201), before: 'injected' }), /invalid_conversation_page/);
    await assert.rejects(() => api.listConversationData({ leadId: 'bad-id' }), /invalid_conversation_page/);
  });
  await Promise.all(Array.from({ length: 30 }, (_, i) => context.run(id(i+1), async () => {
    const result = await api.listConversationData({ leadId: id(201+i) });
    assert.ok(result.messages.length > 0); assert.ok(result.messages.every(message => message.leadId === id(201+i)));
  })));
  const reducer = load('lib/demo-conversations.ts', {});
  let state = reducer.createLiveConversationState();
  const message = { id: 'a', createdAt: '2026-09-15T12:00:00Z', text: 'A', time: '12:00', side: 'incoming' };
  state = reducer.demoConversationReducer(state, { type: 'hydrate', merge: true, contacts: [{ id: 'lead', messages: [message] }] });
  state = reducer.demoConversationReducer(state, { type: 'hydrate', merge: true, contacts: [{ id: 'lead', messages: [{ ...message, text: 'Atualizado' }, { ...message, id: 'older', createdAt: '2026-09-14T12:00:00Z' }] }] });
  assert.equal(state.threads.lead.messages.length, 2);
  assert.equal(state.threads.lead.messages[0].id, 'older');
  assert.equal(state.threads.lead.messages[1].text, 'Atualizado');
  console.log('PASS: 12,050 messages paginated without loss/duplicates; 30 interleaved tenant reads isolated; invalid cursors rejected; additive indexes applied; merge preserves history. Local database only, NOT a production load test.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db?.close(); });
