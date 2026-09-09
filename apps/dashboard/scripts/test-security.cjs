const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');

function compile(file, context = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require, Buffer, Date, URL, console, ...context });
  return module.exports;
}

async function run() {
const authEnvironment = { env: { ADMIN_PANEL_SECRET: 'a-strong-test-only-secret' } };
const auth = compile('lib/admin-auth.ts', { process: authEnvironment });
assert.equal(auth.isValidAdminPassword('a-strong-test-only-secret'), true);
assert.equal(auth.isValidAdminPassword('wrong'), false);
const token = auth.adminSessionToken();
assert.equal(auth.isAdminCookie(token), true);
assert.equal(auth.isAdminCookie(`${token}tampered`), false);
const expiredAt = Math.floor(Date.now() / 1000) - 13 * 60 * 60;
const expiredSignature = crypto.createHmac('sha256', authEnvironment.env.ADMIN_PANEL_SECRET).update(`imobflow-admin:${expiredAt}`).digest('hex');
assert.equal(auth.isAdminCookie(`${expiredAt}.${expiredSignature}`), false);

let rateLimitCall;
const security = compile('lib/request-security.ts', {
  process: authEnvironment,
  require(name) {
    if (name === 'node:crypto') return crypto;
    if (name === './supabase') return { supabaseRequest: async (route, options) => { rateLimitCall = { route, options }; return true; } };
    return require(name);
  },
});
const request = {
  headers: { get(name) { return { origin:'https://imobflow.test', 'content-length':'512', 'x-forwarded-for':'192.0.2.1, 10.0.0.1' }[name] || null; } },
  nextUrl: { origin:'https://imobflow.test' },
};
assert.equal(security.hasSameOrigin(request), true);
assert.equal(security.hasSafeRequestSize(request, 1024), true);
assert.equal(security.hasSameOrigin({ ...request, headers:{ get(name){ return name === 'origin' ? 'https://evil.test' : null; } } }), false);
assert.equal(await security.consumeRateLimit(request, 'login', 5, 900), true);
assert.equal(rateLimitCall.route, 'rpc/consume_rate_limit');
assert.equal(rateLimitCall.options.body.p_limit, 5);
assert.equal(rateLimitCall.options.body.p_identifier_hash.length, 64);

const uploaded = [];
const imageEnvironment = { env: { SUPABASE_URL:'https://project.supabase.co', SUPABASE_SECRET_KEY:'test-server-key' } };
const images = compile('lib/property-images.ts', {
  process: imageEnvironment,
  fetch: async (url, options) => { uploaded.push({ url, options }); return { ok:true, status:200 }; },
  require(name) {
    if (name === 'node:crypto') return crypto;
    if (name === './supabase') return { supabaseCompanyId: () => '00000000-0000-4000-8000-000000000001' };
    return require(name);
  },
});
const managed = 'https://project.supabase.co/storage/v1/object/public/property-images/company/existing.webp';
const stored = await images.persistPropertyImages([managed, 'https://evil.test/photo.jpg', `data:image/webp;base64,${Buffer.from('image').toString('base64')}`]);
assert.equal(stored[0], managed);
assert.equal(stored.length, 2);
assert.equal(uploaded.length, 1);
assert.match(stored[1], /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/public\/property-images\//);
assert.equal(uploaded[0].options.headers.Authorization, 'Bearer test-server-key');

console.log('PASS signed sessions, CSRF checks, persistent rate limits and trusted image storage');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
