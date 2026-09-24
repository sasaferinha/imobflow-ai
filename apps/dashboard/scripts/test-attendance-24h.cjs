// Stateful fictional conversation: never calls Meta, OpenAI or the live database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, Intl, URL, console,
    process: { env: {} }, require: name => name in mocks ? mocks[name] : name.startsWith('.')
      ? load(path.posix.join(path.posix.dirname(file), name + '.ts'), mocks) : require(name) });
  return module.exports;
}
const { businessTime, defaultBusinessHours } = load('lib/business-hours.ts');
const { QUALIFICATION_COMPLETE_MESSAGE } = load('lib/ai/qualification.ts');
async function scenario(date, settings, closed) {
  let profile = {}, saveAllowed = true;
  const sent = [], claims = new Set();
  let paused = false;
  const api = load('lib/attendance.ts', {
    './ai/openai-provider': { configuredAIProvider: () => null },
    './conversation-settings': { readBusinessHours: async companyId => {
      assert.equal(companyId, 'company-test'); return settings;
    } },
    './business-hours': { businessTime: (_, config) => businessTime(new Date(date), config) },
    './message-outbox': { sendQueuedMessage: async () => {} },
    './supabase': { supabaseServiceRequest: async (query, options = {}) => {
      if (query === 'rpc/claim_attendance_reply') {
        if (claims.has(options.body.p_key)) return false;
        claims.add(options.body.p_key); return true;
      }
      if (query.startsWith('leads?')) {
        assert.match(query, /company_id=eq.company-test&id=eq.lead-test/);
        return [{ interest_profile: profile, goal: '', property_type: '', region: '', budget_max: 0, updated_at: 'v1' }];
      }
      if (query === 'rpc/merge_attendance_profile') {
        assert.equal(options.body.p_company_id, 'company-test');
        if (saveAllowed) profile = { ...profile, ...options.body.p_profile };
        return saveAllowed;
      }
      if (query === 'rpc/enqueue_conversation_message') {
        sent.push(options.body.p_content); return 'test-outbox-id';
      }
      if (query.startsWith('conversations?')) { paused = options.body.bot_paused; return null; }
      assert.fail('Unexpected operation: ' + query);
    } },
  });
  const input = { companyId: 'company-test', leadId: 'lead-test', conversationId: 'conversation-test',
    recipientPhone: '5535999999999', phoneNumberId: '123456789', apiVersion: 'v26.0',
    accessToken: null, occurredAt: new Date().toISOString(), hasImage: false };
  const messages = ['Oi', 'Comprar', 'Casa', 'Lavras', 'Centro', '500 mil', 'não', '3 quartos, sem garagem'];
  for (const [i, message] of messages.entries()) {
    await api.respondToIncomingMessage({ ...input, message, incomingExternalMessageId: 'event-' + i });
    assert.equal(sent.length, i + 1, 'every distinct answer must receive a response');
    assert.doesNotMatch(sent.at(-1), /não há corretores|cadastro foi concluído/);
    assert.equal(paused, false, 'qualification must not be paused by business hours');
  }
  assert.match(sent.at(-1), /Está certo\?$/);
  // A rejected save must not produce a successful completion notice.
  saveAllowed = false;
  await api.respondToIncomingMessage({ ...input, message: 'sim', incomingExternalMessageId: 'failed-save' });
  assert.doesNotMatch(sent.at(-1), /cadastro foi concluído|Muito obrigado pelas informações/);
  saveAllowed = true;
  const confirmation = { ...input, message: 'sim', incomingExternalMessageId: 'confirmed' };
  await api.respondToIncomingMessage(confirmation);
  assert.equal(profile.summaryConfirmed, true);
  if (closed) {
    assert.match(sent.at(-1), /Muito obrigado pelas informações! Seu cadastro foi concluído/);
    assert.match(sent.at(-1), /No momento não há corretores disponíveis/);
    assert.match(sent.at(-1), /próximo horário comercial/);
    assert.ok(!sent.at(-1).includes(QUALIFICATION_COMPLETE_MESSAGE));
  } else assert.equal(sent.at(-1), QUALIFICATION_COMPLETE_MESSAGE);
  const count = sent.length;
  await api.respondToIncomingMessage(confirmation);
  assert.equal(sent.length, count, 'webhook replay must not duplicate the closing message');
  await api.respondToIncomingMessage({ ...input, message: 'Oi', incomingExternalMessageId: 'returning' });
  assert.match(sent.at(-1), /cadastro já está registrado/);
  if (closed) assert.match(sent.at(-1), /não há corretores disponíveis/);
  assert.equal(paused, true, 'returning completed client waits for human attendance');
  console.log('PASS 24h qualification, confirmed save, correct closing, duplicate protection:', date, settings.timeZone);
}
(async () => {
  for (const [date, closed] of [
    ['2026-09-15T02:00:00Z', true], // Monday 23h Sao Paulo
    ['2026-09-19T15:00:00Z', true], // Saturday
    ['2026-09-15T10:59:00Z', true], // Before opening
    ['2026-09-15T11:00:00Z', false], // Opening
    ['2026-09-15T20:59:00Z', false],
    ['2026-09-15T21:00:00Z', true], // Closing
  ]) await scenario(date, defaultBusinessHours, closed);
  await scenario('2026-09-15T15:00:00Z', { ...defaultBusinessHours, holidays: ['2026-09-15'] }, true);
  await scenario('2026-09-15T21:00:00Z', { ...defaultBusinessHours, timeZone: 'America/Manaus' }, false);
})().catch(error => { console.error(error); process.exitCode = 1; });
