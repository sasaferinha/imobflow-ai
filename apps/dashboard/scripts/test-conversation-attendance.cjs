// Fictional tenants and conversations only; no provider or database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const base = path.join(__dirname, '..');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(base, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    module: mod, exports: mod.exports, Date, Intl,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('./')) {
        const target = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(file), name);
        return load(target + (fs.existsSync(path.join(base, target + '.tsx')) ? '.tsx' : '.ts'), mocks);
      }
      return require(name);
    },
  });
  return mod.exports;
}

(async () => {
  const { describeConversationAttendance: describe, ConversationAttendanceBanner: Banner } = load('app/conversation-attendance.tsx');
  const owned = { attendanceMode: 'human', assignedTo: 'Ana Teste', assignedBrokerId: 'broker-a' };
  const own = describe({ snapshot: owned, currentBrokerId: 'broker-a', hasMessages: true });
  assert.equal(own.title, 'Bot pausado — atendimento humano');
  assert.equal(own.canSend, true);
  assert.equal(own.canRelease, true);
  const ownHtml = renderToStaticMarkup(createElement(Banner, { attendance: own, ready: true, saving: false, release() {} }));
  assert.match(ownHtml, /Responsável: Ana Teste \(você\)/);
  assert.match(ownHtml, /Devolver ao bot/);
  assert.match(ownHtml, /próximas mensagens/);

  for (const currentBrokerId of ['broker-admin', 'broker-b', undefined]) {
    const other = describe({ snapshot: owned, currentBrokerId, hasMessages: true });
    assert.equal(other.canSend, false);
    assert.equal(other.canClaim, false);
    assert.equal(other.canRelease, false, 'a different account, including the administrator, cannot release another owner');
    assert.doesNotMatch(renderToStaticMarkup(createElement(Banner, { attendance: other, ready: true, saving: false, release() {} })), /<button/);
  }
  const legacy = describe({ snapshot: { ...owned, assignedBrokerId: null }, currentBrokerId: 'broker-a', hasMessages: true });
  assert.equal(legacy.canRelease, false, 'a matching display name is never authorization');
  const waiting = describe({ snapshot: { attendanceMode: 'paused' }, currentBrokerId: 'broker-a', hasMessages: false });
  assert.equal(waiting.canClaim, true);
  assert.equal(waiting.canRelease, true, 'the existing owner RPC permits releasing an unassigned paused conversation');
  const closed = describe({ snapshot: { ...owned, attendanceMode: 'closed' }, currentBrokerId: 'broker-a', hasMessages: true });
  assert.equal(closed.title, 'Encerrada');
  assert.equal(closed.canSend || closed.canClaim || closed.canRelease, false);
  for (const lifecycleStatus of ['Convertido', 'Perdido']) {
    const finished = describe({ snapshot: { attendanceMode: 'automatic' }, currentBrokerId: 'broker-a', lifecycleStatus, hasMessages: true });
    assert.equal(finished.mode, 'paused');
    assert.equal(finished.canRelease, false);
    assert.match(finished.description, /convertidos ou perdidos/);
  }
  const unknown = describe({ currentBrokerId: 'broker-a', hasMessages: false });
  assert.equal(unknown.mode, 'unknown');
  assert.equal(unknown.canSend || unknown.canClaim || unknown.canRelease, false);
  assert.match(renderToStaticMarkup(createElement(Banner, { attendance: own, ready: false, saving: false, release() {} })), /disabled=""/);
  console.log('PASS visible bot pause, named owner, ID-based controls, administrator ownership, closed leads and stale-state controls');

  const rows = [
    { id: 'conversation-a', lead_id: 'lead-a', status: 'open', bot_paused: true, assigned_to: 'Ana Teste', assigned_broker_id: 'broker-a' },
    { id: 'conversation-empty', lead_id: 'lead-empty', status: 'open', bot_paused: true, assigned_to: null, assigned_broker_id: null },
    { id: 'conversation-closed', lead_id: 'lead-closed', status: 'closed', bot_paused: false, assigned_to: null, assigned_broker_id: null },
    { id: 'conversation-auto', lead_id: 'lead-auto', status: 'Aberta', bot_paused: false, assigned_to: null, assigned_broker_id: null },
    { id: 'conversation-unknown', lead_id: 'lead-unknown', status: 'unrecognized', bot_paused: false, assigned_to: null, assigned_broker_id: null },
  ];
  const { listConversationData } = load('lib/conversations.ts', {
    './supabase': { supabaseCompanyId: () => 'tenant-a', supabaseRequest: async query => {
      assert.match(query, /company_id=eq\.tenant-a/, 'every read is scoped to the current tenant');
      if (query.startsWith('conversations?')) return rows;
      if (query.startsWith('messages?')) return [{ id: 'message-a', conversation_id: 'conversation-a', direction: 'incoming', content: 'Olá', created_at: '2026-09-12T12:00:00Z' }];
      return [];
    } },
    './tenant-context': {}, './message-delivery': {}, './message-outbox': {}, './whatsapp-media': {},
  });
  const result = await listConversationData();
  assert.equal(result.messages.length, 1);
  assert.equal(result.attendance.length, 5);
  assert.equal(result.attendance.find(item => item.leadId === 'lead-empty').attendanceMode, 'paused');
  assert.equal(result.attendance.find(item => item.leadId === 'lead-closed').attendanceMode, 'closed');
  assert.equal(result.attendance.find(item => item.leadId === 'lead-auto').attendanceMode, 'automatic');
  assert.equal(result.attendance.find(item => item.leadId === 'lead-unknown').attendanceMode, 'unknown', 'unknown database state cannot claim the bot is active');
  assert.equal(result.messages[0].attendanceMode, 'human');

  const { createLiveConversationState, demoConversationReducer: reduce } = load('lib/demo-conversations.ts');
  let state = reduce(createLiveConversationState(), { type: 'hydrate', contacts: [{ id: 'lead-empty', messages: [], attendance: result.attendance[1] }] });
  state = reduce(state, { type: 'draft', id: 'lead-empty', text: 'Rascunho preservado' });
  state = reduce(state, { type: 'hydrate', contacts: [{ id: 'lead-empty', messages: [], attendance: { ...result.attendance[1], attendanceMode: 'automatic' } }] });
  assert.equal(state.threads['lead-empty'].attendance.attendanceMode, 'automatic');
  assert.equal(state.threads['lead-empty'].draft, 'Rascunho preservado');
  state = reduce(state, { type: 'hydrate', contacts: [{ id: 'lead-empty', messages: [], attendance: null }] });
  assert.equal(state.threads['lead-empty'].attendance, null, 'confirmed missing conversation clears stale metadata');
  console.log('PASS tenant-scoped attendance summaries, empty conversations, closed status and hydrated state without changing draft');
})().catch(error => { console.error(error); process.exitCode = 1; });
