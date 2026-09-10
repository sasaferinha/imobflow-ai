// Pure contract tests: no provider/network/database access.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, env = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, Buffer,
    process: { env }, require(name) { return name === 'node:crypto' ? crypto : require(name); },
  });
  return module.exports;
}

const companyId = '00000000-0000-4000-8000-000000000001';
const rawConnections = JSON.stringify([{ companyId, phoneNumberId: '123456789', enabled: true }]);
const env = { META_APP_SECRET: 'test-app-secret', META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token', WHATSAPP_META_CONNECTIONS: rawConnections };
const meta = load('lib/meta-whatsapp.ts', env);
const connections = meta.configuredMetaWhatsAppConnections();

assert.equal(connections.length, 1);
assert.equal(connections[0].companyId, companyId);
assert.equal(meta.configuredMetaWhatsAppConnections('').length, 0);
for (const bad of ['null', '{}', '[{}]', JSON.stringify([{ companyId, phoneNumberId: 'abc' }]), JSON.stringify([{ companyId, phoneNumberId: '1' }, { companyId, phoneNumberId: '1' }])]) {
  assert.throws(() => meta.configuredMetaWhatsAppConnections(bad));
}
assert.equal(meta.verifyMetaWebhookToken('test-verify-token'), true);
assert.equal(meta.verifyMetaWebhookToken('wrong'), false);
const body = JSON.stringify({ object: 'whatsapp_business_account' });
const signature = 'sha256=' + crypto.createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex');
assert.equal(meta.verifyMetaWebhookSignature(body, signature), true);
assert.equal(meta.verifyMetaWebhookSignature(body, 'sha256=' + '0'.repeat(64)), false);

const payload = {
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: '123456789' },
    contacts: [{ profile: { name: 'Cliente de teste' } }],
    messages: [{ id: 'wamid.test', from: '5535999999999', timestamp: '1789000000', type: 'text', text: { body: 'Olá, quero visitar.' } }],
  } }] }],
};
const parsed = meta.parseIncomingWhatsAppMessages(payload, connections);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].companyId, companyId);
assert.equal(parsed[0].phone, '5535999999999');
assert.equal(parsed[0].text, 'Olá, quero visitar.');
assert.equal(meta.parseIncomingWhatsAppMessages({ ...payload, object: 'other' }, connections).length, 0);
assert.equal(meta.parseIncomingWhatsAppMessages({ ...payload, entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'other' }, messages: payload.entry[0].changes[0].value.messages } }] }] }, connections).length, 0);
console.log('PASS Meta WhatsApp webhook signature, tenant mapping and inbound payload contracts');
