const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const fixedNow = Date.parse('2026-09-07T15:00:00Z');
const input = {
  companyId: 'company-private', leadId: 'lead-private', conversationId: 'conversation-private',
  incomingExternalMessageId: 'incoming-private', message: 'conteudo-privado', hasImage: false,
  recipientPhone: '5535999999999', phoneNumberId: '123456789', accessToken: 'token-private',
  apiVersion: 'v26.0', occurredAt: new Date(fixedNow).toISOString(),
};
const configuredEnv = { N8N_ATTENDANCE_WEBHOOK_URL: 'https://n8n.example/webhook/private', N8N_ATTENDANCE_WEBHOOK_SECRET: 'secret-private-123456' };

function load(relative, globals) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL, AbortController, AbortSignal, Error, setTimeout, clearTimeout, ...globals });
  return module.exports;
}

function fixture(options = {}) {
  const clock = options.now ?? fixedNow;
  class FixtureDate extends Date {
    constructor(value) { super(value === undefined ? clock : value); }
    static now() { return clock; }
  }
  const calls = { n8n: 0, meta: 0, database: 0 };
  const attendance = load('lib/n8n-attendance.ts', {
    Date: FixtureDate, process: { env: options.env ?? configuredEnv },
    require(name) {
      assert.equal(name, './supabase');
      return { supabaseServiceRequest: async () => {
        calls.database++;
        if (options.databaseError) throw new Error('conteudo-privado token-private');
        return options.duplicate ? [{ id: 'private-message-id' }] : [];
      } };
    },
    fetch: async (url) => {
      if (url === configuredEnv.N8N_ATTENDANCE_WEBHOOK_URL) {
        calls.n8n++;
        if (options.n8nError) throw options.n8nError;
        return {
          ok: !options.n8nStatus, status: options.n8nStatus ?? 200,
          text: async () => options.n8nBody ?? JSON.stringify({ output: 'Resposta de teste' }),
        };
      }
      assert.equal(url, `https://graph.facebook.com/${input.apiVersion}/${input.phoneNumberId}/messages`);
      calls.meta++;
      if (options.metaError) throw options.metaError;
      return { ok: !options.metaStatus, status: options.metaStatus ?? 200, json: async () => {
        if (options.invalidMetaJson) throw new Error('invalid json with token-private');
        return options.metaPayload ?? { messages: [{ id: 'provider-private' }] };
      } };
    },
  });
  return { ...attendance, calls, currentInput: { ...input, occurredAt: new Date(clock).toISOString() } };
}

function assertPrivate(value) {
  const serialized = JSON.stringify(value);
  for (const secret of [input.companyId, input.leadId, input.conversationId, input.message, input.recipientPhone, input.phoneNumberId, input.accessToken, configuredEnv.N8N_ATTENDANCE_WEBHOOK_SECRET, 'provider-private']) {
    assert.ok(!serialized.includes(secret), `Diagnostic leaked ${secret}`);
  }
}

let tests = 0;
async function test(name, run) {
  await run();
  tests++;
  console.log('PASS', name);
}

async function failure(options) {
  const fixtureValue = fixture(options);
  try {
    await fixtureValue.requestAttendanceSuggestion(fixtureValue.currentInput);
    assert.fail('Expected an attendance failure');
  } catch (error) {
    const diagnostic = fixtureValue.attendanceFailureDiagnostic(error);
    assertPrivate(diagnostic);
    return { diagnostic, calls: fixtureValue.calls };
  }
}

function routeFixture(options = {}) {
  const logs = [];
  const pending = [];
  let saves = 0;
  let attendanceCalls = 0;
  const connection = fixture();
  const route = load('app/api/integrations/meta/whatsapp/route.ts', {
    console: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (...args) => logs.push([level, ...args])])),
    require(name) {
      if (name === 'next/server') return {
        after: callback => pending.push(callback),
        NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) },
      };
      if (name === '@/lib/meta-whatsapp') return {
        verifyMetaWebhookSignature: () => true,
        configuredMetaWhatsAppConnections: () => [],
        parseIncomingWhatsAppMessages: () => options.empty ? [] : [input, input],
      };
      if (name === '@/lib/meta-whatsapp-store') return { saveIncomingWhatsAppMessage: async () => {
        if (options.storeFails) throw new Error('conteudo-privado token-private');
        saves++;
        return saves === 1 ? { saved: false } : { saved: true, ...input };
      } };
      if (name === '@/lib/n8n-attendance') return {
        attendanceFailureDiagnostic: connection.attendanceFailureDiagnostic,
        requestAttendanceSuggestion: async () => {
          attendanceCalls++;
          if (options.attendanceFails) throw new Error('conteudo-privado token-private');
          return { requested: false, afterHours: true, sent: true, providerMessageId: 'provider-private', reason: 'after_hours_reply_accepted' };
        },
      };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return {
    logs, get attendanceCalls() { return attendanceCalls; },
    run: async () => {
      const result = await route.POST({ headers: new Headers(), text: async () => JSON.stringify({ private: input.message }) });
      for (const callback of pending) await callback();
      assertPrivate(logs);
      return result;
    },
  };
}

(async () => {
  await test('validation returns actionable reasons without sending or revealing input', async () => {
    const cases = [
      [{ accessToken: null }, 'meta_access_token_missing'],
      [{ recipientPhone: 'invalid' }, 'recipient_phone_invalid'],
      [{ phoneNumberId: 'invalid' }, 'phone_number_id_invalid'],
      [{ apiVersion: 'invalid' }, 'meta_api_version_invalid'],
      [{ occurredAt: 'invalid' }, 'inbound_timestamp_invalid'],
      [{ occurredAt: new Date(fixedNow + 300_001).toISOString() }, 'inbound_timestamp_future'],
      [{ occurredAt: new Date(fixedNow - 86_400_001).toISOString() }, 'inbound_outside_reply_window'],
    ];
    for (const [changes, reason] of cases) {
      const instance = fixture();
      const result = await instance.requestAttendanceSuggestion({ ...input, ...changes });
      assert.equal(result.reason, reason);
      assert.equal(result.requested, false);
      assert.deepEqual(instance.calls, { n8n: 0, meta: 0, database: 0 });
      assertPrivate(result);
    }
  });
  await test('missing or invalid n8n configuration is diagnosed without network calls', async () => {
    const cases = [
      [{ N8N_ATTENDANCE_WEBHOOK_URL: '' }, 'n8n_webhook_url_missing'],
      [{ N8N_ATTENDANCE_WEBHOOK_SECRET: '' }, 'n8n_webhook_secret_missing'],
      [{ N8N_ATTENDANCE_WEBHOOK_SECRET: 'short' }, 'n8n_webhook_secret_invalid'],
      [{ N8N_ATTENDANCE_WEBHOOK_URL: 'http://example.com' }, 'n8n_webhook_url_invalid'],
      [{ N8N_ATTENDANCE_WEBHOOK_URL: 'invalid' }, 'n8n_webhook_url_invalid'],
    ];
    for (const [changes, reason] of cases) {
      const instance = fixture({ env: { ...configuredEnv, ...changes } });
      const result = await instance.requestAttendanceSuggestion(input);
      assert.equal(result.reason, reason);
      assert.deepEqual(instance.calls, { n8n: 0, meta: 0, database: 0 });
      assertPrivate(result);
    }
  });
  await test('empty n8n output does not call Meta and includes a reason', async () => {
    for (const n8nBody of ['', '{}', 'null', '{"output":"  "}']) {
      const instance = fixture({ n8nBody });
      const result = await instance.requestAttendanceSuggestion(input);
      assert.equal(result.reason, 'n8n_response_empty');
      assert.equal(result.requested, true);
      assert.equal(result.sent, false);
      assert.deepEqual(instance.calls, { n8n: 1, meta: 0, database: 0 });
    }
  });
  await test('n8n HTTP and timeout failures preserve safe diagnostic codes', async () => {
    const rejected = await failure({ n8nStatus: 403 });
    assert.equal(rejected.diagnostic.reason, 'n8n_response_rejected');
    assert.equal(rejected.diagnostic.httpStatus, 403);
    assert.equal(rejected.calls.meta, 0);
    const timeout = new Error('token-private');
    timeout.name = 'AbortError';
    assert.equal((await failure({ n8nError: timeout })).diagnostic.reason, 'n8n_request_timeout');
    assert.equal((await failure({ n8nError: new Error('token-private') })).diagnostic.reason, 'n8n_request_failed');
  });
  await test('Meta failures expose numeric codes only, never provider messages', async () => {
    const rejected = await failure({ metaStatus: 400, metaPayload: { error: { code: 190, error_subcode: 463, message: 'token-private', error_data: { details: input.recipientPhone } } } });
    assert.equal(rejected.diagnostic.reason, 'meta_response_rejected');
    assert.equal(rejected.diagnostic.httpStatus, 400);
    assert.equal(rejected.diagnostic.providerCode, 190);
    assert.equal(rejected.diagnostic.providerSubcode, 463);
    assert.deepEqual(rejected.calls, { n8n: 1, meta: 1, database: 0 });
    const untrusted = await failure({ metaStatus: 400, metaPayload: { error: { code: input.recipientPhone, error_subcode: 123456789000, message: input.message } } });
    assert.equal(untrusted.diagnostic.providerCode, undefined);
    assert.equal(untrusted.diagnostic.providerSubcode, undefined);
    assert.equal((await failure({ metaStatus: 500, invalidMetaJson: true })).diagnostic.httpStatus, 500);
  });
  await test('Meta receipt, network and database errors retain their phase and do not retry', async () => {
    assert.equal((await failure({ metaPayload: {} })).diagnostic.reason, 'meta_receipt_missing');
    const network = await failure({ metaError: new Error('token-private') });
    assert.equal(network.diagnostic.reason, 'meta_request_failed');
    assert.equal(network.calls.meta, 1);
    const database = await failure({ databaseError: true });
    assert.equal(database.diagnostic.reason, 'database_request_failed');
    assert.equal(database.calls.meta, 1);
  });
  await test('successful daytime attendance preserves the existing single-send flow', async () => {
    const instance = fixture();
    const result = await instance.requestAttendanceSuggestion(input);
    assert.equal(result.reason, 'attendance_reply_accepted');
    assert.equal(result.sent, true);
    assert.deepEqual(instance.calls, { n8n: 1, meta: 1, database: 1 });
    assertPrivate(result);
  });
  await test('after-hours dedupe remains unchanged and gets a distinct reason', async () => {
    const instance = fixture({ now: Date.parse('2026-09-07T22:00:00Z'), duplicate: true });
    const result = await instance.requestAttendanceSuggestion(instance.currentInput);
    assert.equal(result.reason, 'after_hours_reply_already_sent');
    assert.equal(result.afterHours, true);
    assert.deepEqual(instance.calls, { n8n: 0, meta: 0, database: 1 });
  });
  await test('webhook logs matched, saved and duplicate counts without tenant/message fields', async () => {
    const instance = routeFixture();
    assert.equal((await instance.run()).status, 200);
    const matched = instance.logs.find(row => row[1] === 'meta_whatsapp_webhook_matched')[2];
    const saved = instance.logs.find(row => row[1] === 'meta_whatsapp_webhook_saved')[2];
    assert.equal(matched.matchedCount, 2);
    assert.equal(saved.savedCount, 1);
    assert.equal(saved.duplicateCount, 1);
    assert.equal(instance.attendanceCalls, 1);
    assert.ok(instance.logs.some(row => row[1] === 'n8n_attendance_result'));
  });
  await test('zero matches, store failure and attendance failure remain safely observable', async () => {
    const unmatched = routeFixture({ empty: true });
    assert.equal((await unmatched.run()).status, 200);
    assert.equal(unmatched.logs.find(row => row[1] === 'meta_whatsapp_webhook_matched')[2].matchedCount, 0);
    assert.equal(unmatched.attendanceCalls, 0);
    const storeFailure = routeFixture({ storeFails: true });
    assert.equal((await storeFailure.run()).status, 500);
    assert.ok(storeFailure.logs.some(row => row[1] === 'meta_whatsapp_webhook_processing_failed'));
    const attendanceFailure = routeFixture({ attendanceFails: true });
    assert.equal((await attendanceFailure.run()).status, 200);
    assert.equal(attendanceFailure.logs.find(row => row[1] === 'n8n_attendance_delivery_failed')[2].reason, 'attendance_unexpected_failure');
  });
  console.log(`PASS ${tests} attendance diagnostics groups; all network and database calls mocked`);
})().catch(error => { console.error(error); process.exitCode = 1; });
