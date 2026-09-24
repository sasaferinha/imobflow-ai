// Isolated diagnostic: no credentials, production writes or provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

async function main() {
  let outage = false, persisted = false, replies = 0, echoSaves = 0;
  const jobs = [];
  const mocks = {
    'next/server': { NextResponse: Response, after: job => jobs.push(job) },
    '@/lib/meta-whatsapp': {
      verifyMetaWebhookSignature: () => true,
      parseIncomingWhatsAppMessages: () => [{ externalMessageId: 'fixture' }],
    },
    '@/lib/meta-whatsapp-connections': { loadMetaWhatsAppConnections: async () => [] },
    '@/lib/message-delivery': { parseDeliveryEvents: () => [], saveDeliveryEvents: async () => {} },
    '@/lib/whatsapp-business-echo': {
      parseBusinessAppMessages: () => [],
      saveBusinessAppMessage: async () => { echoSaves++; },
    },
    '@/lib/meta-whatsapp-store': { saveIncomingWhatsAppMessage: async () => {
      if (outage) throw Error('simulated database outage');
      if (persisted) return { saved: false };
      persisted = true;
      return { saved: true, messageId: 'fixture' };
    } },
    '@/lib/attendance': { respondToIncomingMessage: async () => {
      replies++;
      throw Error('simulated outage before reply enqueue');
    } },
  };
  const mod = { exports: {} };
  const code = fs.readFileSync(path.join(__dirname, '../app/api/integrations/meta/whatsapp/route.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module: mod, exports: mod.exports, require: name => {
      if (!(name in mocks)) throw Error('Unexpected dependency: ' + name);
      return mocks[name];
    }, Buffer, console: { error() {}, warn() {}, info() {} } });
  const request = () => new Request('https://fixture.invalid/webhook', { method: 'POST', body: '{}' });
  outage = true;
  assert.equal((await mod.exports.POST(request())).status, 500);
  assert.equal(persisted, false);
  assert.equal(jobs.length, 0);
  console.log('PASS database failure before save returns 500, never acknowledges successful import');
  outage = false;
  assert.equal((await mod.exports.POST(request())).status, 200);
  assert.equal(jobs.length, 1);
  await jobs.shift()();
  assert.equal(replies, 1);
  assert.equal((await mod.exports.POST(request())).status, 200);
  assert.equal(jobs.length, 0);
  assert.equal(replies, 1);
  assert.equal(echoSaves, 0, 'inbound-only fixture must not create a Business app echo');
  console.log('PASS duplicate webhook does not queue a second immediate reply; durable inbound recovery is covered separately');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
