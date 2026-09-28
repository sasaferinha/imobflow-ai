// Isolated Meta onboarding contracts: never calls a provider or database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, deps = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require: name => name in deps ? deps[name] : require(name), URL, URLSearchParams, AbortSignal, Date, console: { error() {} }, ...globals });
  return mod.exports;
}

const phone = '123456789012345';
const waba = '987654321098765';
const secret = 'do-not-leak-this-app-secret';
const token = 'do-not-leak-this-access-token';
const pin = '827401';
const env = { META_APP_ID: '123456', META_WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '654321', META_APP_SECRET: secret, META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'do-not-leak-webhook-secret' };
let actor = { role: 'owner', companyId: 'tenant-a' };
let saved = [], requests = [], conflicts = false, queue = [], availabilityChecks = [];
let connections = [];
const fetchStub = async (url, options = {}) => {
  requests.push({ url: new URL(url), options });
  const next = queue.shift();
  assert.ok(next, 'unexpected Graph request');
  if (next instanceof Error) throw next;
  return { ok: next.ok !== false, status: next.status || 200, json: async () => next.payload };
};
const helper = load('lib/meta-whatsapp-onboarding.ts', {}, { fetch: fetchStub });
const store = {
  disconnectMetaWhatsAppConnection: async (companyId, phoneNumberId) => { assert.equal(companyId, 'tenant-a'); assert.equal(phoneNumberId, phone); saved.push({ disconnected: true }); },
  loadMetaWhatsAppConnectionForCompany: async companyId => { assert.equal(companyId, 'tenant-a'); return connections; },
  assertMetaWhatsAppPhoneAvailable: async (companyId, phoneNumberId) => { assert.equal(companyId, 'tenant-a'); availabilityChecks.push(phoneNumberId); if (conflicts) throw new Error('phone conflict ' + token); },
  saveMetaWhatsAppConnection: async (companyId, value) => { saved.push({ companyId, value }); },
};
const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200, headers: options.headers || {} }) } };
const dependencies = {
  'next/server': next, '@/lib/accounts': { protectedRoute: handler => handler },
  '@/lib/tenant-context': { currentAccount: () => actor, requireCompanyId: () => actor.companyId },
  '@/lib/request-security': { hasSameOrigin: request => request.safe !== false },
  '@/lib/meta-whatsapp-connections': store, '@/lib/meta-whatsapp-onboarding': helper,
};
const embedded = load('app/api/integrations/meta/embedded-signup/route.ts', dependencies, { process: { env } });
const manual = load('app/api/conversations/whatsapp/route.ts', dependencies);
const req = (body, extra = {}) => ({ json: async () => body, nextUrl: new URL('https://app.example/api/conversations/whatsapp'), ...extra });
const signup = { phoneNumberId: phone, wabaId: waba, code: 'signup-code-with-more-than-20-characters', pin };
const reset = (...responses) => { saved = []; requests = []; queue = responses; conflicts = false; availabilityChecks = []; };
const phoneResponse = { payload: { id: phone, display_phone_number: '+55 35 99999-1111', verified_name: 'Test office' } };
const success = { payload: { success: true } };
const noSecrets = object => {
  const text = JSON.stringify(object);
  for (const value of [secret, token, pin, env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN]) assert.ok(!text.includes(value), 'secret in public response');
};

async function run() {
  reset();
  assert.equal((await manual.DELETE(req({ confirm: true, phoneNumberId: phone }, { safe: false }))).status,403);
  actor.role='broker';
  assert.equal((await manual.DELETE(req({ confirm: true, phoneNumberId: phone }))).status,403);
  actor.role='owner';
  assert.equal((await manual.DELETE(req({ phoneNumberId: phone }))).status,400);
  assert.equal(saved.length,0);
  const disconnected = await manual.DELETE(req({ confirm: true, phoneNumberId: phone, companyId:'tenant-b' }));
  assert.equal(disconnected.status,200); assert.equal(disconnected.body.data.configured,false); assert.equal(saved.length,1); assert.equal(requests.length,0);
  console.log('PASS disconnect: owner/origin/confirmation required; company derived from session; no Meta mutation');
  reset();
  let response = await embedded.GET();
  assert.equal(response.body.data.available, true); noSecrets(response);
  delete env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  response = await embedded.GET(); assert.equal(response.body.data.available, false);
  assert.equal((await embedded.POST(req(signup))).status, 503); assert.equal(requests.length, 0);
  env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'do-not-leak-webhook-secret';
  actor.role = 'broker';
  for (const route of [embedded, manual]) {
    assert.equal((await route.GET(req())).status, 403);
    assert.equal((await route.POST(req(signup))).status, 403);
  }
  actor.role = 'owner';
  for (const route of [embedded, manual]) assert.equal((await route.POST(req(signup, { safe: false }))).status, 403);
  for (const body of [null, {}, { ...signup, pin: '123' }, { ...signup, phoneNumberId: 'https://elsewhere' }, { ...signup, phoneNumberId: undefined }, { ...signup, phoneNumberId: null, businessAppOnboarding: true }, { ...signup, businessAppOnboarding: 'true' }, { ...signup, wabaId: {} }, { ...signup, code: 'x'.repeat(4097) }]) assert.equal((await embedded.POST(req(body))).status, 400);
  assert.equal((await manual.POST(req(null))).status, 400);
  assert.equal((await embedded.POST(req(null, { json: async () => { throw new Error('bad json'); } }))).status, 400);
  assert.equal(requests.length, 0); assert.equal(saved.length, 0);
  console.log('PASS owner/origin restrictions, metadata-only availability, malformed input and absent prerequisites');

  reset(); conflicts = true;
  response = await embedded.POST(req(signup));
  assert.equal(response.status, 503); noSecrets(response); assert.equal(requests.length, 0); assert.equal(saved.length, 0);
  reset({ payload: { access_token: token } }, { payload: { data: [{ id: 'different-phone' }] } });
  response = await embedded.POST(req(signup));
  assert.equal(response.status, 422); assert.equal(response.body.code, 'phone_business_mismatch'); assert.equal(saved.length, 0);
  assert.ok(!requests.some(item => item.options.method === 'POST')); noSecrets(response);
  console.log('PASS cross-tenant conflict and unshared WABA/phone fail before provider mutations or persistence');

  reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, phoneResponse, success, success);
  response = await embedded.POST(req(signup));
  assert.equal(response.status, 200); assert.equal(response.body.data.verification, 'verified'); assert.equal(response.body.data.messageTestRequired, true);
  assert.equal(saved.length, 1); assert.equal(saved[0].companyId, 'tenant-a'); assert.equal(saved[0].value.accessToken, token);
  assert.deepEqual(requests.map(item => item.url.pathname), ['/v26.0/oauth/access_token', `/v26.0/${waba}/phone_numbers`, `/v26.0/${phone}`, `/v26.0/${phone}/register`, `/v26.0/${waba}/subscribed_apps`]);
  assert.deepEqual(JSON.parse(requests[3].options.body), { messaging_product: 'whatsapp', pin });
  for (const request of requests.slice(1)) { assert.equal(request.options.headers.Authorization, 'Bearer ' + token); assert.ok(!request.url.href.includes(token)); assert.equal(request.options.redirect, 'error'); }
  noSecrets(response); assert.equal(response.headers['Cache-Control'], 'no-store');
  console.log('PASS code exchange, phone ownership/access, registration PIN, subscription, tenant save and token redaction');

  for (const missingPin of [undefined, '']) {
    reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, { payload: { ...phoneResponse.payload, is_on_biz_app: true } }, success);
    response = await embedded.POST(req({ ...signup, pin: missingPin, businessAppOnboarding: true }));
    assert.equal(response.status, 200); assert.equal(saved.length, 1); noSecrets(response);
    assert.ok(!requests.some(item => item.url.pathname.endsWith('/register')));
    assert.equal(requests.at(-1).url.pathname, `/v26.0/${waba}/subscribed_apps`);
  }
  reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, { payload: { ...phoneResponse.payload, is_on_biz_app: false } });
  response = await embedded.POST(req({ ...signup, pin: '', businessAppOnboarding: true }));
  assert.equal(response.body.code, 'coexistence_not_confirmed'); assert.equal(saved.length, 0);
  assert.ok(!requests.some(item => item.options.method === 'POST'));
  console.log('PASS coexistence saves without PIN only when Meta confirms it; forged browser flags rejected');

  const coexistenceSignup = { wabaId: waba, code: signup.code, businessAppOnboarding: true, companyId: 'tenant-b' };
  const coexistencePhone = { payload: { ...phoneResponse.payload, is_on_biz_app: true } };
  reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, coexistencePhone, success);
  response = await embedded.POST(req(coexistenceSignup));
  assert.equal(response.status, 200); assert.equal(response.body.data.phoneNumberId, phone);
  assert.deepEqual(availabilityChecks, [phone]); assert.equal(saved[0].companyId, 'tenant-a');
  assert.equal(saved[0].value.phoneNumberId, phone); assert.equal(saved[0].value.accessToken, token);
  assert.deepEqual(requests.map(item => item.url.pathname), ['/v26.0/oauth/access_token', `/v26.0/${waba}/phone_numbers`, `/v26.0/${phone}`, `/v26.0/${waba}/subscribed_apps`]);
  assert.ok(!requests.some(item => item.url.pathname.endsWith('/register'))); noSecrets(response);
  reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }); conflicts = true;
  response = await embedded.POST(req(coexistenceSignup));
  assert.equal(response.status, 503); assert.equal(saved.length, 0); assert.deepEqual(availabilityChecks, [phone]);
  assert.ok(!requests.some(item => item.options.method === 'POST')); noSecrets(response);
  for (const isOnBizApp of [false, undefined]) {
    reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, { payload: { ...phoneResponse.payload, is_on_biz_app: isOnBizApp } });
    response = await embedded.POST(req({ ...coexistenceSignup, pin }));
    assert.equal(response.body.code, 'coexistence_not_confirmed'); assert.equal(saved.length, 0);
    assert.ok(!requests.some(item => item.options.method === 'POST')); noSecrets(response);
  }
  console.log('PASS WABA-only coexistence discovers authenticated phone, checks tenant ownership and never registers a phone');

  for (const pages of [
    [{ payload: { data: [{ id: phone }, { id: '123456789012346' }] } }],
    [{ payload: { data: [{ id: phone }], paging: { next: 'https://attacker.invalid', cursors: { after: 'next-page' } } } }, { payload: { data: [{ id: '123456789012346' }] } }],
  ]) {
    reset({ payload: { access_token: token } }, ...pages);
    response = await embedded.POST(req(coexistenceSignup));
    assert.equal(response.body.code, 'phone_selection_required'); assert.equal(saved.length, 0);
    assert.ok(!requests.some(item => item.options.method === 'POST')); noSecrets(response);
    assert.ok(requests.every(item => item.url.origin === 'https://graph.facebook.com'));
  }
  for (const pages of [
    [{ payload: { data: [] } }],
    [{ payload: { data: [{ id: 'not-a-phone' }] } }],
    [{ payload: { data: null } }],
    [{ payload: { data: [{ id: phone }], paging: { next: 'https://attacker.invalid' } } }],
    [{ payload: { data: [{ id: phone }], paging: { next: 'https://attacker.invalid', cursors: { after: 'repeated' } } } }, { payload: { data: [], paging: { next: 'https://attacker.invalid', cursors: { after: 'repeated' } } } }],
  ]) {
    reset({ payload: { access_token: token } }, ...pages);
    response = await embedded.POST(req(coexistenceSignup));
    assert.equal(response.body.code, 'phone_discovery_failed'); assert.equal(saved.length, 0);
    assert.ok(!requests.some(item => item.options.method === 'POST')); noSecrets(response);
  }
  reset({ payload: { data: [{ id: phone }], paging: { next: 'https://attacker.invalid', cursors: { after: 'next-page' } } } }, { payload: { data: [{ id: phone }] } });
  assert.equal(await helper.discoverMetaBusinessPhone(waba, token), phone);
  assert.equal(requests[1].url.origin, 'https://graph.facebook.com'); assert.equal(requests[1].url.searchParams.get('after'), 'next-page');
  console.log('PASS multiple phones, missing/malformed phones and incomplete listings fail closed; fixed-origin pagination and duplicate IDs');

  reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, phoneResponse, { ok: false, payload: { error: { code: 100, message: secret + token } } });
  response = await embedded.POST(req(signup));
  assert.equal(response.body.code, 'registration_failed'); assert.equal(saved.length, 0); assert.equal(requests.length, 4); noSecrets(response);
  reset({ payload: { access_token: token } }, { payload: { data: [{ id: phone }] } }, phoneResponse, success, { ok: false, payload: { error: { code: 200, message: secret + token } } });
  response = await embedded.POST(req(signup));
  assert.equal(response.body.code, 'subscription_failed'); assert.equal(saved.length, 0); noSecrets(response);
  reset({ ok: false, payload: { error: { code: 190, message: token } } });
  response = await manual.POST(req({ phoneNumberId: phone, accessToken: token }));
  assert.equal(response.status, 422); assert.equal(response.body.code, 'authorization_expired'); assert.equal(saved.length, 0); noSecrets(response);
  reset(new Error('provider network ' + token));
  response = await manual.POST(req({ phoneNumberId: phone, accessToken: token }));
  assert.equal(response.status, 502); noSecrets(response); assert.equal(saved.length, 0);
  reset({ payload: { id: 'wrong-id', display_phone_number: '+55 35 99999-1111' } });
  response = await manual.POST(req({ phoneNumberId: phone, accessToken: token }));
  assert.equal(response.body.code, 'phone_mismatch'); assert.equal(saved.length, 0);
  console.log('PASS registration/subscription failures, expired credentials, timeouts and wrong phone are actionable and private');

  reset({ payload: { data: [], paging: { next: 'https://attacker.invalid', cursors: { after: 'next-page' } } } }, { payload: { data: [{ id: phone }] } });
  await helper.verifyMetaBusinessPhone(waba, phone, token);
  assert.equal(requests[1].url.origin, 'https://graph.facebook.com'); assert.equal(requests[1].url.searchParams.get('after'), 'next-page');
  reset(phoneResponse);
  response = await manual.POST(req({ phoneNumberId: phone, accessToken: token, enabled: false }));
  assert.equal(response.status, 200); assert.equal(saved[0].value.enabled, false); assert.equal(response.body.data.enabled, false); noSecrets(response);
  connections = [{ companyId: 'tenant-a', phoneNumberId: phone, accessToken: token, apiVersion: 'v26.0', enabled: false }];
  reset();
  response = await manual.GET(req());
  assert.equal(response.body.data.verification, 'unchecked'); assert.equal(response.body.data.enabled, false); assert.equal(requests.length, 0); noSecrets(response);
  reset(phoneResponse);
  response = await manual.GET(req(null, { nextUrl: new URL('https://app.example/api/conversations/whatsapp?verify=1') }));
  assert.equal(response.body.data.verification, 'verified'); assert.equal(response.body.data.enabled, false); noSecrets(response);
  reset({ ok: false, payload: { error: { code: 190 } } });
  response = await manual.GET(req(null, { nextUrl: new URL('https://app.example/api/conversations/whatsapp?verify=1') }));
  assert.equal(response.body.data.verification, 'failed'); assert.equal(response.body.data.configured, true); noSecrets(response);
  console.log('PASS bounded safe pagination, manual verification, paused state, saved versus verified status and no secrets on GET');

  let listener, timer, removed = 0, loginCallback, completed = [], errors = [];
  const client = load('lib/meta-whatsapp-signup-client.ts', {}, {
    window: { addEventListener: (name, handler) => { listener = handler; }, removeEventListener: () => { removed++; listener = undefined; } },
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = undefined; },
  });
  const event = (origin = 'https://www.facebook.com', type = 'FINISH') => ({ origin, data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event: type, data: { phone_number_id: phone, waba_id: waba } }) });
  // Exact documented coexistence payload: Meta does not include phone_number_id.
  const coexistenceEvent = { origin: 'https://www.facebook.com', data: JSON.stringify({ data: { waba_id: waba }, type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', version: 3 }) };
  assert.equal(client.parseMetaSignupEvent(event('https://www.facebook.com.attacker.invalid')), null);
  assert.equal(client.parseMetaSignupEvent(event(undefined, 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING')).assets.businessAppOnboarding, true);
  assert.equal(client.parseMetaSignupEvent(event()).assets.businessAppOnboarding, undefined);
  assert.equal(client.parseMetaSignupEvent({ origin: 'https://www.facebook.com', data: '{broken' }), null);
  const sdk = { login: callback => { loginCallback = callback; } };
  const begin = () => client.beginMetaSignup(sdk, 'config', { complete: data => completed.push(data), error: message => errors.push(message) });
  begin(); listener(event()); loginCallback({ authResponse: { code: 'code-one' } }); loginCallback({ authResponse: { code: 'duplicate' } });
  assert.equal(completed.length, 1); assert.equal(completed[0].code, 'code-one'); assert.equal(timer, undefined); assert.equal(listener, undefined);
  begin(); loginCallback({ authResponse: { code: 'code-two' } }); listener(event()); assert.equal(completed.length, 2);
  begin(); const stale = loginCallback; listener(event(undefined, 'CANCEL')); stale({ authResponse: { code: 'stale-code' } }); assert.equal(completed.length, 2); assert.equal(errors.length, 1);
  begin(); timer(); assert.equal(errors.length, 2); assert.equal(listener, undefined);
  const cleanup = begin(); cleanup(); loginCallback({ authResponse: { code: 'unmounted' } }); assert.equal(completed.length, 2); assert.ok(removed >= 5);
  begin(); loginCallback({}); assert.equal(errors.length, 3); assert.equal(listener, undefined);
  console.log('PASS SDK origin validation, both callback orders, once-only save, cancel, timeout, unmount and popup denial');
  const parsedCoexistence = client.parseMetaSignupEvent(coexistenceEvent);
  assert.equal(parsedCoexistence.event, 'finish'); assert.equal(parsedCoexistence.assets.wabaId, waba);
  assert.equal(parsedCoexistence.assets.businessAppOnboarding, true); assert.equal(parsedCoexistence.assets.phoneNumberId, undefined);
  assert.equal(client.parseMetaSignupEvent({ ...coexistenceEvent, data: JSON.parse(coexistenceEvent.data) }).event, 'finish');
  assert.equal(client.parseMetaSignupEvent({ ...coexistenceEvent, data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: waba } } }).event, 'error');
  for (const badPhone of ['', 'https://attacker.invalid', 123456]) {
    assert.equal(client.parseMetaSignupEvent({ ...coexistenceEvent, data: { ...JSON.parse(coexistenceEvent.data), data: { waba_id: waba, phone_number_id: badPhone } } }).event, 'error');
  }
  for (const assetsFirst of [true, false]) {
    const count = completed.length;
    begin();
    const finishListener = listener;
    const callback = loginCallback;
    if (assetsFirst) { listener(coexistenceEvent); assert.equal(completed.length, count); callback({ authResponse: { code: 'coexistence-code' } }); }
    else { callback({ authResponse: { code: 'coexistence-code' } }); assert.equal(completed.length, count); listener(coexistenceEvent); }
    assert.equal(completed.length, count + 1); assert.equal(completed.at(-1).wabaId, waba);
    assert.equal(completed.at(-1).businessAppOnboarding, true); assert.equal(completed.at(-1).phoneNumberId, undefined);
    finishListener(coexistenceEvent); callback({ authResponse: { code: 'duplicate-code' } });
    assert.equal(completed.length, count + 1); assert.equal(listener, undefined); assert.equal(timer, undefined);
  }
  console.log('PASS official WABA-only payload, object/string events, standard-flow validation and exactly-once callbacks in either order');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
