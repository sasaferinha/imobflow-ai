const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');

const dashboardRoot = path.join(__dirname, '..');
const configModule = { exports: {} };
const source = fs.readFileSync(path.join(dashboardRoot, 'next.config.ts'), 'utf8');
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  module: configModule,
  exports: configModule.exports,
  process: { env: { VERCEL_DEPLOYMENT_ID: 'presentation-headers-test' } },
  require: name => {
    assert.equal(name, 'node:child_process');
    return { execSync() { throw new Error('The header test must not invoke Git.'); } };
  },
});

// Next applies matching rules in order; the last value for a header wins.
function effectiveHeaders(rules, pathname) {
  const headers = new Map();
  for (const rule of rules) {
    assert.ok(!rule.has && !rule.missing, 'Review conditional header rules before extending this fixture.');
    if (!pathToRegexp(rule.source).test(pathname)) continue;
    for (const { key, value } of rule.headers) headers.set(key.toLowerCase(), value);
  }
  return headers;
}

async function run() {
  const rules = await configModule.exports.default.headers();
  const vercel = JSON.parse(fs.readFileSync(path.join(dashboardRoot, 'vercel.json'), 'utf8'));
  const vercelRules = vercel.headers || [];
  for (const rule of vercelRules) {
    assert.ok(rule.headers.every(header => header.key.toLowerCase() !== 'x-frame-options'),
      'Next must be the only source of X-Frame-Options; Vercel must not override the demo exception.');
  }

  const exceptions = rules.filter(rule => rule.headers.some(header =>
    header.key.toLowerCase() === 'x-frame-options' && header.value !== 'DENY'));
  assert.equal(exceptions.length, 1, 'Only the isolated demonstration may be embedded.');
  assert.equal(exceptions[0].source, '/demonstracao');

  const demoPolicy = "connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
  for (const pathname of ['/demonstracao', '/demonstracao/']) {
    const headers = effectiveHeaders(rules, pathname);
    assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN', pathname);
    assert.equal(headers.get('content-security-policy'), demoPolicy,
      'Embedding must preserve the demo network, forms, child-frame and same-origin ancestor restrictions.');
    assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow');
  }

  for (const pathname of ['/', '/apresentacao', '/painel', '/api/leads', '/demonstracao/nested', '/demonstracao-extra']) {
    const headers = effectiveHeaders(rules, pathname);
    assert.equal(headers.get('x-frame-options'), 'DENY', `${pathname} must retain frame protection`);
    assert.equal(headers.get('content-security-policy'), undefined,
      `${pathname} must not inherit the demo-only connection policy`);
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  }
  assert.equal(effectiveHeaders(vercelRules, '/demonstracao').get('permissions-policy'),
    'camera=(), microphone=(), geolocation=()', 'Keep the existing device permission restrictions.');

  console.log('PASS presentation headers: same-origin embedding only for the isolated demo; no Vercel conflict; CSP and other route protections preserved');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
