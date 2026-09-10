// Contract/integration tests using an isolated fake DB/provider. Never sends real messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const cache = new Map();
let logs = 0;
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, URL, Buffer, AbortSignal, process: { env: {} },
    console: { error: () => logs++ }, fetch: () => { throw new Error('Real fetch prohibited'); },
    require: name => name.startsWith('.') ? load(path.posix.join(path.posix.dirname(relative), name + '.ts')) : require(name) });
  cache.set(relative, module.exports);
  return module.exports;
}
const { propertyAutomationConnection, parsePropertyPreferencesEvent } = load('lib/n8n-property-auth.ts');
const { dispatchImmediateProperty } = load('lib/n8n-property-dispatch.ts');
const token = 't'.repeat(43);
const connection = { companyId: '00000000-0000-4000-8000-000000000001', tokenSha256: crypto.createHash('sha256').update(token).digest('hex'), enabled: true, provider: 'meta', phoneNumberId: '12345678', accessToken: 'FAKE_ONLY_NOT_A_CREDENTIAL', apiVersion: 'v23.0' };
const event = { type: 'lead.preferences.updated', leadId: '00000000-0000-4000-8000-000000000002', incomingMessageId: '00000000-0000-4000-8000-000000000003', profileUpdatedAt: '2026-09-09T08:00:00.123456+00:00' };
let tests = 0;
async function test(name, fn) { await fn(); tests++; console.log('PASS', name); }

function fixture(options = {}) {
  const lead = { company_id: connection.companyId, id: event.leadId, name: 'Teste', phone: '11999999999', goal: 'Comprar', property_type: 'Apartamento', region: 'Centro', budget_min: 300000, budget_max: 500000, details: '2 quartos', lifecycle_status: 'Novo', updated_at: event.profileUpdatedAt, ...options.lead };
  const property = { company_id: connection.companyId, id: '00000000-0000-4000-8000-000000000004', title: 'Apartamento Central', district: 'Centro', property_type: 'Apartamento', price: 400000, bedrooms: 2, status: 'Disponível', purpose: 'Venda', updated_at: event.profileUpdatedAt, created_at: '2020-01-01T00:00:00Z', ...options.property };
  const calls = [];
  let reserved = false;
  let accepted = false;
  let sends = 0;
  const deps = {
    request: async (url, request) => {
      calls.push({ url, request });
      if (url.startsWith('leads?')) return options.noLead ? [] : [lead];
      if (url.startsWith('properties?')) return [property];
      if (url === 'rpc/claim_property_auto_delivery') {
        if (options.claimThrows) throw new Error('DB validation blocked');
        if (reserved || options.duplicate) return null;
        reserved = true;
        assert.equal(request.body.p_company_id, connection.companyId);
        assert.equal(request.body.p_lead_updated_at, event.profileUpdatedAt);
        assert.equal(request.body.p_phone_number_id, connection.phoneNumberId);
        return 'delivery-test-id';
      }
      if (url === 'rpc/finish_property_auto_delivery') {
        if (options.finishThrows) throw new Error('DB unavailable after send');
        assert.equal(request.body.p_provider_message_id, 'wamid.TEST');
        accepted = true; return 'message-test-id';
      }
      if (url === 'rpc/mark_property_auto_delivery_uncertain') return;
      throw new Error('Unexpected database path ' + url);
    },
    fetch: async (url, request) => {
      sends++;
      assert.equal(reserved, true);
      assert.equal(url, 'https://graph.facebook.com/v23.0/12345678/messages');
      const body = JSON.parse(request.body);
      assert.equal(body.to, '5511999999999');
      assert.equal(body.type, 'text');
      assert.equal(body.biz_opaque_callback_data, 'delivery-test-id');
      assert.match(body.text.body, /Apartamento Central/);
      assert.equal(request.redirect, 'error');
      if (options.timeout) throw new Error('Provider response lost');
      return { ok: !options.providerError, json: async () => options.missingReceipt ? {} : { messages: [{ id: 'wamid.TEST' }] } };
    },
  };
  return { deps, calls, get sends() { return sends; }, get accepted() { return accepted; } };
}

(async () => {
  await test('credential binds one company and defaults to disabled', () => {
    const auth = 'Bearer ' + token;
    assert.equal(propertyAutomationConnection(auth, undefined), null);
    for (const config of ['', 'bad json', '{}', 'null', JSON.stringify([connection, connection]), JSON.stringify([{ ...connection, enabled: false }]), JSON.stringify([{ ...connection, provider: 'evolution' }]), JSON.stringify([{ ...connection, companyId: '../../x' }]), JSON.stringify([{ ...connection, phoneNumberId: '../evil' }]), JSON.stringify([{ ...connection, apiVersion: 'v23.0/../me' }])]) assert.equal(propertyAutomationConnection(auth, config), null);
    assert.equal(propertyAutomationConnection(auth, JSON.stringify([connection])).companyId, connection.companyId);
    for (const bad of [null, '', token, 'Bearer short', 'Bearer ' + 'x'.repeat(43)]) assert.equal(propertyAutomationConnection(bad, JSON.stringify([connection])), null);
  });
  await test('event rejects caller-selected tenant, phone, text and property', () => {
    assert.ok(parsePropertyPreferencesEvent(event));
    for (const key of ['companyId', 'phone', 'content', 'propertyId', 'url']) assert.equal(parsePropertyPreferencesEvent({ ...event, [key]: 'untrusted' }), null);
    for (const bad of [null, [], {}, { ...event, type: 'property.created' }, { ...event, leadId: 'x&company=evil' }, { ...event, profileUpdatedAt: 'yesterday' }]) assert.equal(parsePropertyPreferencesEvent(bad), null);
  });
  await test('all reads scoped to authenticated company; real acceptance precedes history', async () => {
    const db = fixture();
    assert.equal((await dispatchImmediateProperty(connection, event, db.deps)).status, 'accepted');
    assert.equal(db.sends, 1); assert.equal(db.accepted, true);
    for (const call of db.calls.filter(c => !c.url.startsWith('rpc/'))) assert.ok(call.url.includes('company_id=eq.' + connection.companyId));
    assert.ok(db.calls.find(c => c.url === 'rpc/finish_property_auto_delivery'));
  });
  await test('parallel repeated event sends once', async () => {
    const db = fixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => dispatchImmediateProperty(connection, event, db.deps)));
    assert.equal(db.sends, 1); assert.equal(results.filter(r => r.status === 'accepted').length, 1);
  });
  await test('unknown availability, other tenant, unavailable and mismatched properties do not send', async () => {
    for (const property of [{ company_id: 'another-company' }, { status: null }, { status: 'unknown' }, { status: 'Vendido' }, { status: 'Reservado' }, { purpose: '' }, { price: 290000 }, { price: 500001 }, { bedrooms: 3 }, { district: 'Outra região' }]) {
      const db = fixture({ property }); assert.equal((await dispatchImmediateProperty(connection, event, db.deps)).status, 'skipped'); assert.equal(db.sends, 0);
    }
  });
  await test('human ownership, advanced stage, stale profile including microseconds, unsupported criteria do not send', async () => {
    for (const lead of [{ assigned_to: 'Samuel' }, { lifecycle_status: 'Proposta' }, { company_id: 'another-company' }, { updated_at: '2026-09-09T08:00:00.123457+00:00' }, { parking_spaces: 1 }, { payment_method: 'Financiamento' }, { details: '2 quartos com varanda' }, { budget_min: 450000 }, { bedrooms: 3 }]) {
      const db = fixture({ lead }); assert.equal((await dispatchImmediateProperty(connection, event, db.deps)).status, 'skipped'); assert.equal(db.sends, 0);
    }
  });
  await test('structured bedrooms work without free text, without public link', async () => {
    const db = fixture({ lead: { details: null, bedrooms: 2 } });
    assert.equal((await dispatchImmediateProperty(connection, event, db.deps)).status, 'accepted');
  });
  await test('DB reservation rejection never calls provider', async () => {
    const db = fixture({ claimThrows: true });
    await assert.rejects(dispatchImmediateProperty(connection, event, db.deps)); assert.equal(db.sends, 0);
  });
  await test('timeout, provider rejection, missing receipt and receipt-write failure stay blocked', async () => {
    for (const option of ['timeout', 'providerError', 'missingReceipt', 'finishThrows']) {
      const db = fixture({ [option]: true });
      assert.equal((await dispatchImmediateProperty(connection, event, db.deps)).status, 'uncertain');
      assert.equal(db.accepted, false); assert.equal(db.sends, 1);
      assert.ok(db.calls.find(c => c.url === 'rpc/mark_property_auto_delivery_uncertain'));
      assert.equal((await dispatchImmediateProperty(connection, event, db.deps)).status, 'skipped'); assert.equal(db.sends, 1);
    }
    assert.equal(logs, 4);
  });
  await test('n8n template inactive, authenticated, single sender, no retry or credentials', () => {
    const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../../..', 'integrations/n8n/04-immediate-property-offer.json'), 'utf8'));
    assert.equal(workflow.active, false);
    const webhook = workflow.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
    assert.equal(webhook.parameters.authentication, 'headerAuth');
    const http = workflow.nodes.filter(n => n.type === 'n8n-nodes-base.httpRequest');
    assert.equal(http.length, 1); assert.equal(http[0].retryOnFail, false); assert.equal(http[0].parameters.genericAuthType, 'httpHeaderAuth');
    assert.ok(workflow.nodes.every(n => !n.credentials));
    const code = workflow.nodes.find(n => n.type === 'n8n-nodes-base.code').parameters.jsCode;
    assert.equal(vm.runInNewContext('(function(){' + code + '})()', { $json: { body: event } })[0].json.leadId, event.leadId);
    assert.throws(() => vm.runInNewContext('(function(){' + code + '})()', { $json: { body: { ...event, phone: 'untrusted' } } }));
  });
  console.log(`${tests} integration/contract tests passed. Mocked provider only; no actual WhatsApp/n8n connection.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
