const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

const company = '11111111-1111-4111-a111-111111111111';
const foreign = '22222222-2222-4222-a222-222222222222';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const message = (number, extra = {}) => ({
  id: `message-${number}`, text: `Synthetic text ${number}`,
  at: new Date(Date.UTC(2026, 9, 20, 12, 0, number)).toISOString(), ...extra,
});
const lead = (number, extra = {}) => ({
  id: id(number), company_id: company, name: `Synthetic contact ${number}`,
  source: 'Instagram Direct', assigned_to: null, social_messages: [message(number)], ...extra,
});
const tokens = { owner: 'a'.repeat(64), broker: 'b'.repeat(64), foreign: 'c'.repeat(64), badRole: 'd'.repeat(64), badTenant: 'e'.repeat(64) };
const sessions = new Map(Object.entries(tokens).map(([kind, token]) => [
  crypto.createHash('sha256').update(token).digest('hex'),
  {
    broker_id: id(900 + Object.keys(tokens).indexOf(kind)),
    company_id: kind === 'foreign' ? foreign : kind === 'badTenant' ? `${company}&company_id=not.is.null` : company,
    name: `Synthetic ${kind}`, company: 'Synthetic company',
    role: kind === 'badRole' ? 'guest' : kind === 'owner' ? 'owner' : 'broker',
  },
]));
const calls = [];
let rows = [];
let failure = null;
let failSession = false;
let abortAfterRead = null;
let externalCalls = 0;
async function db(resource, options = {}) {
  calls.push({ resource, options });
  if (resource === 'rpc/account_session') {
    assert.equal(options.method, 'POST');
    if (failSession) throw new Error('private-auth-credential');
    return sessions.has(options.body.p_hash) ? [sessions.get(options.body.p_hash)] : [];
  }
  assert.ok(resource.startsWith('leads?'), 'only the read-only leads query is allowed');
  assert.ok(options.method === undefined || options.method === 'GET');
  assert.equal(options.body, undefined);
  assert.equal(options.allRows, undefined, 'must not paginate beyond the explicit contact limit');
  assert.equal(options.timeoutMs, 5000);
  const query = new URL(`https://database.example.invalid/${resource}`).searchParams;
  assert.ok([`eq.${company}`, `eq.${foreign}`].includes(query.get('company_id')));
  assert.equal(query.get('source'), 'eq.Instagram Direct');
  assert.equal(query.get('select'), 'id,company_id,name,assigned_to,source,social_messages:interest_profile->socialMessages');
  assert.equal(query.get('order'), 'created_at.desc,id.asc');
  assert.equal(query.get('limit'), '100');
  assert.deepEqual([...query.keys()].sort(), ['company_id', 'limit', 'order', 'select', 'source']);
  if (failure) throw failure;
  abortAfterRead?.abort();
  return rows;
}

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const requireLocal = specifier => {
    if (specifier === 'next/server') return { NextResponse: Response, NextRequest: Request };
    if (specifier === './supabase') return {
      supabaseRequest: db,
      supabaseServiceRequest: () => { throw new Error('direct service transport is outside this module contract'); },
    };
    if (specifier.startsWith('@/')) return load(`${specifier.slice(2)}.ts`);
    if (specifier.startsWith('.')) return load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))}.ts`);
    return require(specifier);
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, require: requireLocal,
    Date, Buffer, URL, URLSearchParams, Request, Response, Headers, AbortSignal,
    process: { env: { NODE_ENV: 'test' } },
    console: { error: () => { throw new Error('private data must not be logged'); } },
    fetch: () => { externalCalls++; throw new Error('No external network in this synthetic test'); },
  }, { filename: file });
  return mod.exports;
}
function request({ token, query = '', signal } = {}) {
  const result = new Request(`https://app.example.invalid/api/conversations/instagram${query ? `?${query}` : ''}`, { signal });
  result.nextUrl = new URL(result.url);
  result.cookies = { get: name => name === 'imobflow_session' && token ? { value: token } : undefined };
  return result;
}
const leadCalls = () => calls.filter(call => call.resource.startsWith('leads?'));

(async () => {
  const helper = load('lib/instagram-inbox.ts');
  const api = load('app/api/conversations/instagram/route.ts');
  assert.equal(api.runtime, 'nodejs');
  assert.equal(api.dynamic, 'force-dynamic');
  for (const verb of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(api[verb], undefined);

  const maliciousText = '<script>alert("synthetic")</script> & <img src=x onerror=alert(1)>\nOlá 😀';
  const dirtyHistory = [
    null, [], {}, message(1, { id: '' }), message(1, { id: '\nunsafe' }),
    message(1, { id: 'x'.repeat(256) }), message(1, { text: '' }),
    message(1, { text: ' '.repeat(5) }), message(1, { text: 'x'.repeat(2001) }),
    message(1, { text: {} }), message(1, { at: null }), message(1, { at: 'Infinity' }),
    message(1, { at: 'yesterday' }), message(1, { at: '2026-02-30T12:00:00Z' }),
    message(1, { at: '2026-10-20T24:00:00Z' }), message(1, { at: '2026-10-20T12:00:00+24:00' }),
    message(1, { at: '2026-10-20T12:00:00Z', text: maliciousText, socialSenderId: 'private-sender', accessToken: 'private-token' }),
    message(2, { at: '2026-10-20T09:00:01-03:00' }),
  ];
  const cleaned = plain(helper.instagramMessages(dirtyHistory));
  assert.deepEqual(cleaned, [
    { id: 'message-1', text: maliciousText, at: '2026-10-20T12:00:00Z' },
    { id: 'message-2', text: 'Synthetic text 2', at: '2026-10-20T09:00:01-03:00' },
  ]);
  assert.deepEqual(plain(helper.instagramMessages({ socialMessages: [message(1)] })), []);
  const history = Array.from({ length: 85 }, (_, index) => message(index)).reverse();
  history.push(message(84, { accessToken: 'private-token', text: 'Duplicate must not inflate the count' }));
  const bounded = plain(helper.instagramMessages(history));
  assert.equal(bounded.length, 40);
  assert.equal(new Set(bounded.map(item => item.id)).size, 40);
  assert.equal(bounded[0].id, 'message-45');
  assert.equal(bounded.at(-1).id, 'message-84');
  assert.ok(bounded.every((item, index) => index === 0 || Date.parse(item.at) >= Date.parse(bounded[index - 1].at)));
  assert.deepEqual(plain(helper.instagramInboxContacts([
    null, [], lead(1, { company_id: foreign }), lead(2, { source: 'WhatsApp' }),
    lead(3, { id: 'invalid' }), lead(4, { name: {} }), lead(5, { assigned_to: {} }),
    lead(6, { name: 'x'.repeat(201) }), lead(7, { assigned_to: 'x'.repeat(161) }),
  ], company)), []);
  assert.throws(() => helper.instagramInboxContacts({}, company), /instagram_inbox_unavailable/);
  assert.throws(() => helper.instagramInboxContacts([], 'invalid-tenant'), /instagram_inbox_unavailable/);
  await assert.rejects(helper.readInstagramInbox(), /instagram_inbox_unavailable/, 'helper itself requires session context');

  for (const token of [undefined, 'invalid-token', 'f'.repeat(64)]) {
    const response = await api.GET(request({ token }));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(leadCalls().length, 0, 'unauthenticated callers do not read the transcript');

  rows = [
    lead(1, { name: maliciousText, assigned_to: 'Synthetic responsible', social_messages: dirtyHistory, access_token: 'private-token', socialSenderId: 'private-sender' }),
    lead(2, { social_messages: [message(40)] }),
    lead(3, { social_messages: null, created_at: '2026-10-20T14:00:00Z', details: 'Never invent transcript from details' }),
    lead(4, { company_id: foreign }), lead(5, { source: 'Facebook Lead Ads' }), lead(1),
  ];
  for (const role of ['owner', 'broker']) {
    const response = await api.GET(request({ token: tokens[role] }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const body = await response.json();
    assert.deepEqual(Object.keys(body), ['data']);
    assert.deepEqual(Object.keys(body.data).sort(), ['connectionStatus', 'contacts', 'limit', 'readOnly']);
    assert.equal(body.data.limit, 100);
    assert.equal(body.data.readOnly, true);
    assert.equal(body.data.connectionStatus, 'not_verified', 'stored messages cannot prove a live connection');
    assert.deepEqual(body.data.contacts.map(contact => contact.id), [id(2), id(1), id(3)]);
    assert.equal(body.data.contacts[1].name, maliciousText);
    assert.equal(body.data.contacts[1].messages[0].text, maliciousText, 'JSON text is preserved, not interpreted as markup');
    assert.deepEqual(Object.keys(body.data.contacts[1]).sort(), ['assignedTo', 'id', 'lastMessageAt', 'messages', 'name']);
    assert.deepEqual(Object.keys(body.data.contacts[1].messages[0]).sort(), ['at', 'id', 'text']);
    assert.equal(body.data.contacts[2].lastMessageAt, null);
    assert.deepEqual(body.data.contacts[2].messages, []);
    assert.doesNotMatch(JSON.stringify(body), /private-token|private-sender|socialSenderId|access_token|interest_profile|company_id|Never invent/);
  }

  rows = [lead(8, { company_id: foreign }), lead(9)];
  const foreignResponse = await api.GET(request({ token: tokens.foreign }));
  assert.deepEqual((await foreignResponse.json()).data.contacts.map(contact => contact.id), [id(8)]);
  assert.equal(new URL(`https://db.invalid/${leadCalls().at(-1).resource}`).searchParams.get('company_id'), `eq.${foreign}`);

  const beforeParameters = leadCalls().length;
  for (const query of [
    `company_id=${foreign}`, `companyId=${foreign}`, 'limit=10000', 'source=WhatsApp',
    'assigned_to=not.is.null', 'select=*', 'leadId=unknown', 'foo=bar', 'company_id=one&company_id=two',
  ]) {
    const response = await api.GET(request({ token: tokens.owner, query }));
    assert.equal(response.status, 400);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(leadCalls().length, beforeParameters, 'client query parameters cannot redirect or expand the read');
  for (const kind of ['badRole', 'badTenant']) {
    assert.equal((await api.GET(request({ token: tokens[kind] }))).status, 503);
  }
  assert.equal(leadCalls().length, beforeParameters);

  rows = Array.from({ length: 101 }, (_, index) => lead(index + 1000));
  const limited = await (await api.GET(request({ token: tokens.owner }))).json();
  assert.equal(limited.data.contacts.length, 100, 'defense in depth if transport disregards limit');
  rows = [];
  const empty = await (await api.GET(request({ token: tokens.broker }))).json();
  assert.deepEqual(empty.data, { contacts: [], limit: 100, readOnly: true, connectionStatus: 'not_verified' });

  for (const injectedFailure of [new Error('private-token raw database details'), new DOMException('private-timeout details', 'TimeoutError')]) {
    failure = injectedFailure;
    const response = await api.GET(request({ token: tokens.owner }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.doesNotMatch(await response.text(), /private|database|TimeoutError/);
  }
  failure = null;
  rows = { unexpected: 'private-token' };
  assert.equal((await api.GET(request({ token: tokens.owner }))).status, 503);
  failSession = true;
  const failedAuth = await api.GET(request({ token: tokens.owner }));
  assert.equal(failedAuth.status, 503);
  assert.match(failedAuth.headers.get('cache-control'), /no-store/);
  assert.doesNotMatch(await failedAuth.text(), /private-auth/);
  failSession = false;

  rows = [lead(1)];
  const controller = new AbortController();
  controller.abort();
  const beforeAbort = leadCalls().length;
  const aborted = await api.GET(request({ token: tokens.owner, signal: controller.signal }));
  assert.equal(aborted.status, 503);
  assert.equal(leadCalls().length, beforeAbort);
  abortAfterRead = new AbortController();
  const lateAbort = await api.GET(request({ token: tokens.owner, signal: abortAfterRead.signal }));
  assert.equal(lateAbort.status, 503, 'completed reads are not returned after client cancellation');
  assert.match(lateAbort.headers.get('cache-control'), /no-store/);
  abortAfterRead = null;
  assert.equal(externalCalls, 0);

  // Authentication/tenant filtering above uses the real custom-session wrapper.
  // It does not assert JWT RLS: the current supabaseRequest implementation
  // internally uses the service transport, and browser roles have no CRM grant.
  console.log('PASS Instagram inbox: real session/ALS owner+broker tenant scope, query rejection, 100 contacts/40 valid text messages, exact projection, malformed data, no synthetic dates, JSON text safety, no-store for auth/errors, bounded reads, abort handling; no network or sends. This does not prove Meta connectivity or JWT RLS.');
})().catch(error => { console.error(error); process.exitCode = 1; });
