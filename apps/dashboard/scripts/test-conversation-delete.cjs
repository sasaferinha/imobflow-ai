const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, Buffer, Date, URL, URLSearchParams, process: { env: {} }, console: { error() {} },
    require: name => name in dependencies ? dependencies[name] : require(name),
  });
  return module.exports;
}

const companyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherCompanyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const messageId = '11111111-1111-4111-8111-111111111111';
const externalId = '22222222-2222-4222-8222-222222222222';
const incomingId = '33333333-3333-4333-8333-333333333333';
const otherCompanyMessageId = '44444444-4444-4444-8444-444444444444';
const automatedId = '55555555-5555-4555-8555-555555555555';
const legacyId = '66666666-6666-4666-8666-666666666666';
const sessionToken = 'a'.repeat(64);
const actor = { broker_id: '77777777-7777-4777-8777-777777777777', company_id: companyId, name: 'Corretor teste', company: 'Empresa teste', role: 'broker' };
const rows = [
  { id: messageId, company_id: companyId, direction: 'outgoing', sender_type: 'human', external_message_id: null },
  { id: externalId, company_id: companyId, direction: 'outgoing', sender_type: 'human', external_message_id: 'wamid.keep-for-deduplication' },
  { id: incomingId, company_id: companyId, direction: 'incoming', sender_type: 'lead', external_message_id: 'wamid.incoming' },
  { id: otherCompanyMessageId, company_id: otherCompanyId, direction: 'outgoing', sender_type: 'human', external_message_id: null },
  { id: automatedId, company_id: companyId, direction: 'outgoing', sender_type: 'ai', external_message_id: null },
  { id: legacyId, company_id: companyId, direction: 'Saída', sender_type: 'Corretor', external_message_id: null },
].map(row => ({ ...row, conversation_id: 'conversation-test', content: 'Conteúdo de teste', created_at: '2026-09-10T12:00:00Z', media_urls: [] }));
const deleteCalls = [];
const tenant = load('lib/tenant-context.ts');
const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: new Headers(options.headers) }) } };
const database = {
  supabaseCompanyId: tenant.requireCompanyId,
  supabaseRequest: async (route, options = {}) => {
    if (route === 'rpc/account_session') return options.body.p_hash === accounts.tokenHash(sessionToken) ? [actor] : [];
    const [table, query] = route.split('?');
    const params = new URLSearchParams(query);
    if (options.method === 'DELETE') {
      deleteCalls.push({ route, options });
      assert.equal(table, 'messages');
      assert.equal(params.get('company_id'), `eq.${companyId}`);
      assert.equal(params.get('direction'), 'in.(outgoing,Saída)');
      assert.equal(params.get('sender_type'), 'in.(human,Corretor)');
      assert.equal(params.get('external_message_id'), 'is.null');
      assert.equal(options.prefer, 'return=representation');
      const index = rows.findIndex(row => `eq.${row.id}` === params.get('id') && row.company_id === companyId
        && ['outgoing', 'Saída'].includes(row.direction) && ['human', 'Corretor'].includes(row.sender_type) && row.external_message_id === null);
      return index < 0 ? [] : rows.splice(index, 1).map(row => ({ id: row.id }));
    }
    assert.equal(options.method || 'GET', 'GET');
    assert.equal(params.get('company_id'), `eq.${companyId}`);
    if (table === 'conversations') return [{ id: 'conversation-test', lead_id: 'lead-test' }];
    if (table === 'messages') return rows.filter(row => row.company_id === companyId);
    throw new Error(`Unexpected query: ${route}`);
  },
};
const accounts = load('lib/accounts.ts', { 'next/server': next, './supabase': database, './tenant-context': tenant });
const conversations = load('lib/conversations.ts', { './supabase': database, './tenant-context': tenant, './whatsapp-media': { isWhatsAppMediaPath: () => false } });
const security = load('lib/request-security.ts', { './supabase': database });
const routes = load('app/api/conversations/route.ts', {
  'next/server': next, '@/lib/accounts': accounts, '@/lib/admin-auth': load('lib/admin-auth.ts'),
  '@/lib/conversations': conversations, '@/lib/request-security': security,
});
const request = (body, token = sessionToken, origin = 'https://imobflow.test') => ({
  cookies: { get: () => token ? { value: token } : undefined },
  headers: new Headers({ origin }), nextUrl: { origin: 'https://imobflow.test' },
  json: async () => body,
});

async function run() {
  assert.equal((await routes.DELETE(request({ messageId }, ''))).status, 401);
  assert.equal((await routes.DELETE(request({ messageId }, 'b'.repeat(64)))).status, 401);
  assert.equal((await routes.DELETE(request({ messageId }, sessionToken, 'https://untrusted.test'))).status, 403);
  assert.equal(deleteCalls.length, 0);
  await assert.rejects(() => conversations.deleteConversationMessage(messageId), /Contexto da empresa ausente/);
  console.log('PASS session validation, tenant context and cross-origin protection');

  for (const invalid of [null, [], {}, { messageId: '-'.repeat(36) }, { messageId: 123 }, { messageId: `${messageId}&company_id=eq.other` }]) {
    assert.equal((await routes.DELETE(request(invalid))).status, 400);
  }
  assert.equal((await routes.DELETE({ ...request({}), json: async () => { throw new SyntaxError('Invalid JSON'); } })).status, 400);
  assert.equal(deleteCalls.length, 0);
  console.log('PASS malformed bodies and invalid identifiers rejected before mutation');

  for (const target of [otherCompanyMessageId, externalId, incomingId, automatedId]) {
    assert.equal((await routes.DELETE(request({ messageId: target, companyId: otherCompanyId }))).status, 409);
    assert.ok(rows.some(row => row.id === target));
  }
  assert.equal(rows.find(row => row.id === externalId).external_message_id, 'wamid.keep-for-deduplication');
  console.log('PASS company isolation and retention of WhatsApp identifiers, incoming and automated messages');

  const listing = await routes.GET(request({}));
  assert.equal(listing.status, 200);
  assert.equal(listing.body.data.find(row => row.id === messageId).deletable, true);
  assert.equal(listing.body.data.find(row => row.id === legacyId).deletable, true);
  assert.equal(listing.body.data.find(row => row.id === externalId).deletable, false);
  assert.equal(listing.body.data.find(row => row.id === automatedId).deletable, false);
  assert.equal(listing.body.data.some(row => row.id === otherCompanyMessageId), false);

  const deletion = await routes.DELETE(request({ messageId }));
  assert.equal(deletion.status, 200);
  assert.equal(deletion.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(rows.some(row => row.id === messageId), false);
  assert.equal((await routes.DELETE(request({ messageId }))).status, 409);
  assert.equal((await routes.DELETE(request({ messageId: legacyId }))).status, 200);
  assert.equal((await routes.GET(request({}))).body.data.some(row => row.id === messageId), false);
  console.log('PASS persisted deletion, legacy panel messages, fresh listings and cache protection');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
