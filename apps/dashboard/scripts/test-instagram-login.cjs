// Native Instagram OAuth contract. Real modules/crypto; synthetic HTTP and DB only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const company = '11111111-1111-4111-a111-111111111111';
const foreign = '22222222-2222-4222-a222-222222222222';
const broker = '33333333-3333-4333-a333-333333333333';
const scopedId = '11001100', professionalId = '22002200';
const shortToken = 'synthetic-instagram-short-token';
const longToken = 'synthetic-instagram-long-token';
const appSecret = 'synthetic-instagram-app-secret';
const oauthCode = 'synthetic-instagram-code';
const redirectUri = 'https://app.example.test/api/integrations/meta/instagram/callback';
const scopes = ['instagram_business_basic', 'instagram_business_manage_messages'];
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const compiled = new Map();
function compiledSource(file) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  return compiled.get(file);
}

function harness(options = {}) {
  const env = { META_INSTAGRAM_APP_ID: '987654', META_INSTAGRAM_APP_SECRET: appSecret, META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: 'synthetic-instagram-webhook', META_SOCIAL_TOKEN_ENCRYPTION_KEY: 'c'.repeat(64), ...options.env };
  const requests = new Map(), network = [], database = [], events = [], binds = [];
  let ownerChecks = 0;
  const outputs = {
    short: { access_token: shortToken, user_id: Number(scopedId), permissions: scopes },
    long: { access_token: longToken, expires_in: 3600, token_type: 'bearer' },
    profile: { id: scopedId, user_id: professionalId, username: 'synthetic.imobiliaria', account_type: 'BUSINESS' },
    subscription: { success: true }, ...options.outputs,
  };
  async function db(resource, init = {}) {
    const body = init.body; database.push({ resource, init }); events.push(`db:${resource.split('?')[0]}`);
    if (resource.startsWith('broker_accounts?')) {
      ownerChecks++;
      assert(resource.includes(`company_id=eq.${company}`)); assert(resource.includes(`id=eq.${broker}`));
      assert(resource.includes('role=eq.owner') && resource.includes('active=eq.true'));
      return options.owner === false || options.revokeAfterOwnerCheck && ownerChecks > options.revokeAfterOwnerCheck ? [] : [{ id: broker }];
    }
    if (resource === 'social_oauth_requests' && init.method === 'POST') { requests.set(body.state_hash, { ...body }); return; }
    if (resource.startsWith('social_oauth_requests?') && init.method === 'DELETE') {
      const query = new URLSearchParams(resource.split('?')[1]);
      const key = query.get('state_hash')?.slice(3), row = requests.get(key);
      if (!row) return [];
      for (const field of ['login_provider', 'channel']) { const filter = query.get(field); if (filter && filter !== `eq.${row[field]}`) return []; }
      const expiry = query.get('expires_at');
      if (expiry?.startsWith('gt.') && Date.parse(row.expires_at) <= Date.parse(expiry.slice(3))) return [];
      requests.delete(key); return [{ ...row }];
    }
    if (resource.startsWith('social_accounts?')) {
      assert(resource.includes('channel=eq.instagram'), 'Preflight is scoped to the Instagram channel');
      if (resource.includes(`account_id=eq.${professionalId}`)) return options.foreignOwner ? [{ company_id: foreign }] : [];
      assert(resource.includes(`company_id=eq.${company}`) && resource.includes('enabled=eq.true'));
      return options.activeAccounts || [];
    }
    assert(!resource.startsWith('social_authorizations'), 'Instagram Login must never replace the Facebook authorization');
    if (resource === 'rpc/bind_instagram_account') { assert.equal(init.method, 'POST'); binds.push(body); return; }
    assert.fail(`Unexpected DB resource: ${resource}`);
  }
  async function fetchProvider(input, init = {}) {
    const url = new URL(input); network.push({ url, init }); events.push(`http:${url.pathname}`);
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert(init.signal instanceof AbortSignal);
    if (options.networkFailure) throw new Error(`raw ${appSecret} ${longToken}`);
    if (options.providerError) return Response.json({ error: { message: `raw ${appSecret} ${longToken}` } }, { status: options.providerError });
    let output;
    if (url.origin === 'https://api.instagram.com' && url.pathname === '/oauth/access_token') {
      assert.equal(init.method, 'POST'); assert(init.body instanceof FormData);
      assert.equal(init.body.get('client_id'), env.META_INSTAGRAM_APP_ID); assert.equal(init.body.get('client_secret'), env.META_INSTAGRAM_APP_SECRET);
      assert.equal(init.body.get('grant_type'), 'authorization_code'); assert.equal(init.body.get('redirect_uri'), redirectUri); assert.equal(init.body.get('code'), oauthCode);
      assert.equal(url.search, ''); output = outputs.short;
    } else if (url.origin === 'https://graph.instagram.com' && url.pathname === '/access_token') {
      assert(!init.method || init.method === 'GET'); assert.equal(url.searchParams.get('grant_type'), 'ig_exchange_token');
      assert.equal(url.searchParams.get('client_secret'), appSecret); assert.equal(url.searchParams.get('access_token'), shortToken); output = outputs.long;
    } else if (url.origin === 'https://graph.instagram.com' && url.pathname === '/v26.0/me') {
      assert(!init.method || init.method === 'GET'); assert.equal(init.headers.Authorization, `Bearer ${longToken}`);
      assert.equal(url.searchParams.get('fields'), 'id,user_id,username,account_type'); assert(!url.searchParams.has('access_token')); output = outputs.profile;
    } else if (url.origin === 'https://graph.instagram.com' && url.pathname === `/v26.0/${professionalId}/subscribed_apps`) {
      assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, `Bearer ${longToken}`);
      assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded'); assert.equal(url.search, '');
      assert.deepEqual(new URLSearchParams(init.body).get('subscribed_fields').split(',').sort(), ['messages', 'messaging_postbacks']); output = outputs.subscription;
    } else assert.fail(`Unexpected provider origin/path: ${url.origin}${url.pathname}`);
    return Response.json(output);
  }
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} }; cache.set(file, mod.exports);
    const requireLocal = name => {
      if (name === './supabase') return { supabaseServiceRequest: db };
      if (name === './meta-social') return { socialConnections: () => [] };
      if (name === 'server-only') return {};
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
      return require(name);
    };
    vm.runInNewContext(compiledSource(file), { module: mod, exports: mod.exports, require: requireLocal, Buffer, Date, URL, URLSearchParams, FormData, Response, Request, Headers, AbortSignal, process: { env }, fetch: fetchProvider }, { filename: file });
    return mod.exports;
  }
  return { api: load('lib/instagram-api.ts'), login: load('lib/instagram-login.ts'), social: load('lib/social-connections.ts'), env, outputs, requests, network, database, events, binds, ownerChecks: () => ownerChecks };
}
const noSecret = error => { for (const value of [shortToken, longToken, appSecret]) assert(!String(error).includes(value), 'Provider details/tokens must not leak through errors'); return true; };
async function begin(h) { return h.login.beginInstagramOAuth(company, broker, redirectUri); }
async function finish(h, pending) { return h.login.finishInstagramOAuth(pending.state, pending.state, oauthCode); }

async function testApi() {
  const direct = harness(); assert.equal(direct.api.instagramAvailable(), true, 'Instagram is available without Facebook app credentials');
  const before = Date.now(), account = await direct.api.instagramExchange(oauthCode, redirectUri);
  assert.equal(account.accountId, professionalId); assert.notEqual(account.accountId, scopedId, 'App-scoped login user_id is not the professional webhook account ID');
  assert.equal(account.username, 'synthetic.imobiliaria'); assert.equal(account.token, longToken);
  assert(Math.abs(Date.parse(account.expiresAt) - before - 3600_000) < 3000);
  assert.equal(direct.network.length, 3); assert(direct.network.every(call => call.url.hostname.endsWith('instagram.com')));
  await direct.api.instagramSubscribe(account.accountId, account.token); assert.equal(direct.network.length, 4);

  const wrapped = harness();
  for (const field of ['short', 'long', 'profile']) wrapped.outputs[field] = { data: [wrapped.outputs[field]] };
  assert.equal((await wrapped.api.instagramExchange(oauthCode, redirectUri)).accountId, professionalId, 'Single-item data wrappers are accepted');
  const stringScopes = harness(); stringScopes.outputs.short.permissions = scopes.join(', '); stringScopes.outputs.profile.account_type = 'MEDIA_CREATOR';
  assert.equal((await stringScopes.api.instagramExchange(oauthCode, redirectUri)).accountId, professionalId);
  const omittedOptional = harness(); delete omittedOptional.outputs.short.permissions; delete omittedOptional.outputs.short.user_id; delete omittedOptional.outputs.profile.id;
  assert.equal((await omittedOptional.api.instagramExchange(oauthCode, redirectUri)).accountId, professionalId, 'Optional short-token scope/scoped-ID fields do not replace the authenticated professional profile');
  for (const permissions of [[], [scopes[0]], 'instagram_basic,instagram_manage_messages', null, 7]) {
    const h = harness(); h.outputs.short.permissions = permissions;
    await assert.rejects(h.api.instagramExchange(oauthCode, redirectUri), error => error.code === 'permissions_missing' && noSecret(error));
    assert.equal(h.network.length, 1, 'Explicitly incomplete permissions stop before long-token exchange');
  }
  for (const patch of [{ user_id: undefined }, { user_id: 22002200 }, { id: '999999' }, { account_type: 'PERSONAL' }, { username: 'unsafe/name' }, { username: '' }]) {
    const h = harness(); Object.assign(h.outputs.profile, patch);
    await assert.rejects(h.api.instagramExchange(oauthCode, redirectUri), noSecret); assert.equal(h.network.length, 3);
  }
  for (const expires of [0, -1, 'NaN', null, 62 * 86400]) {
    const h = harness(); h.outputs.long.expires_in = expires;
    await assert.rejects(h.api.instagramExchange(oauthCode, redirectUri), noSecret); assert.equal(h.network.length, 2);
  }
  for (const field of ['short', 'long', 'profile']) for (const data of [[], [{}, {}]]) {
    const h = harness(); h.outputs[field] = { data }; await assert.rejects(h.api.instagramExchange(oauthCode, redirectUri), noSecret);
  }
  for (const value of ['', 'short', 'has invalid whitespace', 'x'.repeat(8193)]) {
    const h = harness(); h.outputs.short.access_token = value; await assert.rejects(h.api.instagramExchange(oauthCode, redirectUri), noSecret); assert.equal(h.network.length, 1);
  }
  const unconfigured = harness({ env: { META_INSTAGRAM_APP_ID: '', META_INSTAGRAM_APP_SECRET: '', META_APP_ID: '123', META_APP_SECRET: 'facebook-secret' } });
  assert.equal(unconfigured.api.instagramAvailable(), false, 'Facebook credentials never silently substitute for Instagram credentials');
  await assert.rejects(unconfigured.api.instagramExchange(oauthCode, redirectUri), error => error.status === 503); assert.equal(unconfigured.network.length, 0);
  for (const options of [{ networkFailure: true }, { providerError: 400 }, { providerError: 429 }, { providerError: 500 }]) {
    const h = harness(options); await assert.rejects(h.api.instagramExchange(oauthCode, redirectUri), noSecret); assert.equal(h.network.length, 1);
  }
  const subscribe = harness({ outputs: { subscription: { success: false } } });
  await assert.rejects(subscribe.api.instagramSubscribe(professionalId, longToken), noSecret);
  const invalidAccount = harness(); await assert.rejects(invalidAccount.api.instagramSubscribe('../foreign', longToken)); assert.equal(invalidAccount.network.length, 0);
}

async function testLogin() {
  const h = harness(), time = Date.now(), pending = await begin(h);
  assert.equal(h.login.INSTAGRAM_COOKIE, 'imobflow_instagram_state'); assert.equal(h.login.INSTAGRAM_CALLBACK, '/api/integrations/meta/instagram/callback');
  assert.match(pending.state, /^[a-f0-9]{64}$/);
  const url = new URL(pending.url);
  assert.equal(url.origin, 'https://www.instagram.com'); assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), h.env.META_INSTAGRAM_APP_ID); assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('enable_fb_login'), 'false'); assert.equal(url.searchParams.get('force_reauth'), 'true'); assert.equal(url.searchParams.get('response_type'), 'code');
  assert.deepEqual(url.searchParams.get('scope').split(',').sort(), [...scopes].sort());
  assert(!url.href.includes(appSecret));
  const stored = h.requests.get(digest(pending.state));
  assert.equal(stored.company_id, company); assert.equal(stored.broker_id, broker); assert.equal(stored.channel, 'instagram'); assert.equal(stored.login_provider, 'instagram'); assert.equal(stored.redirect_uri, redirectUri);
  assert(Math.abs(Date.parse(stored.expires_at) - time - 600_000) < 3000); assert(!JSON.stringify(stored).includes(pending.state), 'Persist only the nonce hash');
  assert.equal(h.network.length, 0);
  await assert.rejects(h.login.finishInstagramOAuth(pending.state, '0'.repeat(64), oauthCode)); assert(h.requests.has(digest(pending.state))); assert.equal(h.network.length, 0);
  for (const code of ['', 'short', 'x'.repeat(4097)]) await assert.rejects(h.login.finishInstagramOAuth(pending.state, pending.state, code));
  await finish(h, pending);
  assert.equal(h.binds.length, 1); assert.equal(h.requests.size, 0); assert.equal(h.ownerChecks(), 3, 'Owner checked at begin, before exchange and again before subscription/binding');
  const consume = h.database.find(call => call.init.method === 'DELETE');
  assert(consume.resource.includes('&login_provider=eq.instagram&channel=eq.instagram&expires_at=gt.'));
  assert.equal(consume.init.prefer, 'return=representation');
  const bound = h.binds[0];
  assert.equal(bound.p_company_id, company); assert.equal(bound.p_actor_id, broker); assert.equal(bound.p_account_id, professionalId); assert.equal(bound.p_name, 'synthetic.imobiliaria'); assert.equal(bound.p_api_version, 'v26.0');
  assert.match(bound.p_token, /^v1\./); assert(!bound.p_token.includes(longToken)); assert.equal(h.social.decryptSocialToken(bound.p_token, company), longToken); assert.throws(() => h.social.decryptSocialToken(bound.p_token, foreign), 'Token is authenticated to its company');
  assert(Date.parse(bound.p_expires_at) > Date.now()); assert(h.database.every(call => !call.resource.startsWith('social_authorizations')));
  const subscriptionIndex = h.events.findIndex(event => event.endsWith('/subscribed_apps'));
  const ownershipIndexes = h.events.flatMap((event, index) => event === 'db:social_accounts' ? [index] : []);
  assert.equal(ownershipIndexes.length, 2); assert(ownershipIndexes.every(index => index < subscriptionIndex), 'Global account and active-company ownership preflight precede subscription');
  assert(subscriptionIndex < h.events.indexOf('db:rpc/bind_instagram_account'));
  const count = h.network.length; await assert.rejects(finish(h, pending)); assert.equal(h.network.length, count, 'A consumed state can never exchange another token');

  for (const patch of [{ login_provider: 'facebook' }, { channel: 'facebook' }, { expires_at: new Date(Date.now() - 1000).toISOString() }]) {
    const other = harness(), state = await begin(other); Object.assign(other.requests.get(digest(state.state)), patch);
    await assert.rejects(finish(other, state)); assert.equal(other.network.length, 0); assert.equal(other.binds.length, 0);
    assert(other.requests.has(digest(state.state)), 'Wrong-provider/channel or expired rows are not consumed by an Instagram callback');
  }
  // The harness checks active ownership dynamically on every real requireSocialOwner call.
  const revokedAtStart = harness({ owner: false }); await assert.rejects(begin(revokedAtStart), error => error.status === 403); assert.equal(revokedAtStart.requests.size, 0);
  const lostBefore = harness({ revokeAfterOwnerCheck: 1 }), lostPending = await begin(lostBefore); await assert.rejects(finish(lostBefore, lostPending), error => error.status === 403); assert.equal(lostBefore.network.length, 0); assert.equal(lostBefore.requests.size, 0);
  const lostAfter = harness({ revokeAfterOwnerCheck: 2 }), latePending = await begin(lostAfter); await assert.rejects(finish(lostAfter, latePending), error => error.status === 403); assert.equal(lostAfter.network.length, 3); assert.equal(lostAfter.binds.length, 0);
  assert(!lostAfter.network.some(call => call.url.pathname.endsWith('/subscribed_apps')));
  for (const options of [{ foreignOwner: true }, { activeAccounts: [{ account_id: '999999', login_provider: 'instagram' }] }, { activeAccounts: [{ account_id: professionalId, login_provider: 'facebook' }] }]) {
    const conflict = harness(options), state = await begin(conflict); await assert.rejects(finish(conflict, state), error => error.status === 409);
    assert.equal(conflict.binds.length, 0); assert(!conflict.network.some(call => call.url.pathname.endsWith('/subscribed_apps')), 'Conflicts cannot mutate a provider subscription');
  }
  const existing = harness({ activeAccounts: [{ account_id: professionalId, login_provider: 'instagram' }] }), existingPending = await begin(existing); await finish(existing, existingPending); assert.equal(existing.binds.length, 1, 'An identical native account can renew its token');
  const failedSubscription = harness({ outputs: { subscription: { success: false } } }), subscriptionPending = await begin(failedSubscription); await assert.rejects(finish(failedSubscription, subscriptionPending)); assert.equal(failedSubscription.binds.length, 0);
  for (const env of [{ META_INSTAGRAM_APP_ID: '' }, { META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: '', META_SOCIAL_WEBHOOK_VERIFY_TOKEN: '' }, { META_SOCIAL_TOKEN_ENCRYPTION_KEY: '', META_APP_SECRET: '' }, { META_SOCIAL_TOKEN_ENCRYPTION_KEY: 'malformed' }]) {
    const disabled = harness({ env }); await assert.rejects(begin(disabled), error => error.status === 503); assert.equal(disabled.requests.size, 0); assert.equal(disabled.network.length, 0);
  }
  const fallbackWebhook = harness({ env: { META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN: '', META_SOCIAL_WEBHOOK_VERIFY_TOKEN: 'synthetic-shared-webhook' } }); assert((await begin(fallbackWebhook)).state);
}

(async () => { await testApi(); await testLogin(); console.log('PASS native Instagram OAuth: independent credentials/scopes/hosts; app-scoped versus professional IDs; flat/wrapped profiles, account type/permissions/expiry; one-use provider-bound state; owner rechecks and ownership preflight; encrypted company-bound token; no Facebook authorization overwrite. Synthetic HTTP/DB only.'); })().catch(error => { console.error(error); process.exitCode = 1; });
