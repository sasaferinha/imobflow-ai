// Isolated metadata transport; no real credentials, customer content or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const company = id(1);
let records = [], receipts = [], calls = [], active = 0, maxActive = 0, fail = false, foreign = false;
const warnings = [];
const load = (file, dependencies) => {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, Date, Map, Set, URLSearchParams, console: { warn: text => warnings.push(text) } });
  return mod.exports;
};
const pure = load('lib/conversation-stage.ts', {});
const sort = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
async function request(url, options = {}) {
  assert.ok(!options.method, 'Stage detection is read-only');
  assert.ok(!options.allRows, 'Never download the entire transcript');
  assert.equal(options.timeoutMs, 4000);
  const [table, query] = url.split('?'), params = new URLSearchParams(query);
  assert.equal(params.get('company_id'), `eq.${company}`);
  assert.ok(!/content|phone|name/.test(params.get('select')), 'Only message metadata is requested');
  calls.push({ table, params });
  active += 1; maxActive = Math.max(maxActive, active);
  await new Promise(resolve => setImmediate(resolve));
  active -= 1;
  if (fail) throw new Error('Simulated read failure');
  const limit = Number(params.get('limit'));
  if (table === 'message_delivery_events') {
    assert.ok(limit <= 16);
    const ids = JSON.parse(`[${params.get('external_message_id').slice(4, -1)}]`);
    return receipts.filter(row => ids.includes(row.external_message_id)).slice(0, limit);
  }
  assert.equal(table, 'messages');
  assert.ok(limit <= 4);
  const conversation = params.get('conversation_id').slice(3);
  let rows = records.filter(row => row.company_id === company && row.conversation_id === conversation);
  if (params.get('direction') === 'in.(incoming,Entrada)') {
    assert.equal(params.get('sender_type'), 'in.(client,Cliente)');
    rows = rows.filter(row => ['incoming', 'Entrada'].includes(row.direction) && ['client', 'Cliente'].includes(row.sender_type));
  } else {
    assert.equal(params.get('direction'), 'in.(outgoing,Saída,Saida)');
    assert.equal(params.get('sender_type'), 'in.(human,ai,automation,Corretor,"Agente de IA")');
    rows = rows.filter(row => ['outgoing', 'Saída', 'Saida'].includes(row.direction)
      && ['human', 'ai', 'automation', 'Corretor', 'Agente de IA'].includes(row.sender_type)
      && (['sent', 'delivered', 'read'].includes(row.delivery_status) || row.delivery_status == null && row.external_message_id));
    assert.ok(params.get('or').includes('delivery_status.in.(sent,delivered,read)'));
  }
  if (params.has('created_at')) rows = rows.filter(row => Date.parse(row.created_at) > Date.parse(params.get('created_at').slice(3)));
  if (params.has('and')) {
    const cursor = params.get('and').match(/^\(or\(created_at\.gt\.(.+),and\(created_at\.eq\.(.+),id\.gt\.(.+)\)\)\)$/);
    assert.ok(cursor); assert.equal(cursor[1], cursor[2]);
    rows = rows.filter(row => sort(row, { created_at: cursor[1], id: cursor[3] }) > 0);
  }
  rows.sort(sort); if (params.get('order') === 'created_at.desc,id.desc') rows.reverse();
  return rows.slice(0, limit).map(row => ({ ...row, ...(foreign ? { company_id: id(2) } : {}) }));
}
const api = load('lib/conversation-stage-reader.ts', { './supabase': { supabaseRequest: request }, './conversation-stage': pure });
let nextId = 100;
function add(conversation, second, direction, extra = {}) {
  const messageId = id(nextId++);
  const row = { id: messageId, company_id: company, conversation_id: id(conversation), direction,
    sender_type: direction === 'incoming' ? 'client' : 'human', delivery_status: direction === 'outgoing' ? 'sent' : null,
    created_at: new Date(Date.UTC(2026, 9, 11, 12, 0, second)).toISOString(),
    external_message_id: `provider.${messageId}`, ...extra };
  records.push(row); return row;
}
function thread(conversation, directions) { directions.forEach((direction, index) => add(conversation, index + 1, direction)); }
(async () => {
  thread(10, ['incoming', 'outgoing']);
  thread(11, ['incoming', 'outgoing', 'incoming']);
  thread(12, ['incoming', 'outgoing', 'incoming', 'outgoing']);
  thread(13, ['incoming', 'incoming', 'incoming', 'incoming', 'outgoing']);
  thread(14, ['incoming', 'outgoing', 'outgoing', 'outgoing', 'outgoing']);
  for (let i = 0; i < 12050; i++) add(15, i + 1, 'incoming');
  add(15, 12051, 'outgoing'); add(15, 12052, 'incoming');
  thread(16, ['incoming', 'outgoing', 'incoming', 'incoming']);
  const denied = records.find(row => row.conversation_id === id(16) && row.direction === 'outgoing');
  receipts.push({ external_message_id: denied.external_message_id, status: 'failed' });
  const stage = await api.readAutomaticConversationStages(company, [10, 11, 12, 13, 14, 15, 16].map(id));
  for (const conversation of [10, 11, 13, 14, 16]) assert.equal(stage.get(id(conversation)), 'Lead');
  for (const conversation of [12, 15]) assert.equal(stage.get(id(conversation)), 'Atendimento');
  assert.ok(maxActive <= 4, 'Concurrent metadata queries stay bounded');
  assert.equal(calls.filter(call => call.table === 'messages' && call.params.get('conversation_id') === `eq.${id(15)}`).length, 3, 'A long initial burst plus later return needs only three bounded metadata pages');
  receipts.push({ external_message_id: denied.external_message_id, status: 'delivered' });
  assert.equal((await api.readAutomaticConversationStages(company, [id(16)])).get(id(16)), 'Atendimento', 'Confirmed delivery wins over an earlier failed receipt');
  receipts.pop(); denied.delivery_status = 'read';
  assert.equal((await api.readAutomaticConversationStages(company, [id(16)])).get(id(16)), 'Atendimento', 'A confirmed read on the message also wins over an older failed receipt');

  // Many failed provider attempts must be skipped, never counted toward four messages.
  add(17, 1, 'incoming');
  for (let i = 2; i < 6; i++) { const row = add(17, i, 'outgoing'); receipts.push({ external_message_id: row.external_message_id, status: 'failed' }); }
  add(17, 6, 'outgoing'); add(17, 7, 'incoming'); add(17, 8, 'incoming');
  assert.equal((await api.readAutomaticConversationStages(company, [id(17)])).get(id(17)), 'Atendimento');

  add(18, 1, 'incoming');
  for (let i = 2; i < 20; i++) { const row = add(18, i, 'outgoing'); receipts.push({ external_message_id: row.external_message_id, status: 'failed' }); }
  add(18, 21, 'incoming'); add(18, 22, 'incoming');
  calls = [];
  assert.equal((await api.readAutomaticConversationStages(company, [id(18)])).has(id(18)), false, 'Truncated evidence is unknown, never a downgrade to Lead');
  assert.ok(calls.length <= 10);
  assert.ok(warnings.includes('conversation_stage_evidence_incomplete'));

  fail = true;
  assert.equal((await api.readAutomaticConversationStages(company, [id(12)])).has(id(12)), false, 'A database outage preserves the caller’s current stage');
  fail = false; foreign = true;
  await assert.rejects(() => api.readAutomaticConversationStages(company, [id(12)]), /validar/);
  foreign = false;
  await assert.rejects(() => api.readAutomaticConversationStages(company, ['invalid']), /inválido/);
  assert.equal((await api.readAutomaticConversationStages(company, [])).size, 0);
  console.log('PASS automatic stage reader: bounded metadata, long histories, separate conversations, receipt failures, concurrency and unknown fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
