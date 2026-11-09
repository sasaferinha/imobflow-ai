// Exercise the OAuth completion boundary with the CRM cookie absent, as it is
// on a cross-site return with SameSite=Strict. No provider, browser or DB calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const { pathToRegexp } = createRequire(require.resolve('vercel/package.json'))('path-to-regexp');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const origin = 'https://app.example.test';
const state = 'a'.repeat(64);
const code = 'synthetic-authorization-code';
const finishCalls = [];
let fail = false;

class TestResponse extends Response {
  constructor(body, options) {
    super(body, options);
    this.savedCookies = [];
    this.cookies = { set: (name, value, options) => this.savedCookies.push({ name, value, options }) };
  }
  static redirect(destination) { return new TestResponse(null, { status: 307, headers: { Location: String(destination) } }); }
}

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, process: { env: { NODE_ENV: 'production' } },
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === 'react/jsx-runtime' || name.startsWith('node:')) return require(name);
      throw Error(`Unexpected dependency at the public return boundary: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}

function walk(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach(child => walk(child, found)); return found; }
  found.push(node);
  walk(node.props?.children, found);
  return found;
}

(async () => {
  for (const flow of ['social', 'ads']) {
    const cookieName = flow === 'social' ? 'imobflow_meta_social_state' : 'imobflow_meta_ads_state';
    const callbackPath = `/api/integrations/meta/${flow}/callback`;
    const finish = async (...args) => { finishCalls.push(args); if (fail) throw Error('synthetic-provider-secret-must-not-leak'); };
    const dependency = flow === 'social'
      ? { '@/lib/social-connections': { SOCIAL_COOKIE: cookieName, finishSocialOAuth: finish } }
      : { '@/lib/meta-ads': { ADS_COOKIE: cookieName, finishAdsOAuth: finish } };
    const callback = load(`app${callbackPath}/route.ts`, { 'next/server': { NextResponse: TestResponse }, ...dependency });
    for (const rejected of [false, true]) {
      fail = rejected;
      const request = {
        nextUrl: new URL(`${origin}${callbackPath}?${new URLSearchParams({ state, code, next: 'https://attacker.test', companyId: 'foreign-company' })}`),
        // No imobflow_session cookie. Only the isolated OAuth state is sent.
        cookies: { get(name) { assert.equal(name, cookieName); return { value: state }; } },
      };
      const response = await callback.GET(request);
      const target = new URL(response.headers.get('location'));
      assert.equal(response.status, 307);
      assert.equal(target.origin, origin);
      assert.equal(target.pathname, '/integracoes/retorno');
      assert.equal(target.searchParams.get('fluxo'), flow);
      assert.equal(target.searchParams.get('resultado'), rejected ? 'failed' : 'connected');
      assert.deepEqual([...target.searchParams.keys()].sort(), ['fluxo', 'resultado']);
      assert.equal(target.hash, '');
      assert.equal(JSON.stringify(finishCalls.at(-1)), JSON.stringify([state, state, code]));
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.savedCookies.length, 1, 'Callback never creates or replaces a CRM session');
      const cleared = response.savedCookies[0];
      assert.equal(cleared.name, cookieName);
      assert.equal(cleared.value, '');
      assert.equal(cleared.options.path, callbackPath);
      assert.equal(cleared.options.sameSite, 'lax');
      assert.equal(cleared.options.httpOnly, true);
      assert.equal(cleared.options.secure, true);
      assert.equal(cleared.options.maxAge, 0);
      assert.ok(!JSON.stringify([...response.headers]).includes(code));
    }
  }

  const pageModule = load('app/integracoes/retorno/page.tsx', { './return.module.css': { default: {} } });
  assert.equal(pageModule.dynamic, 'force-dynamic');
  assert.equal(pageModule.metadata.referrer, 'no-referrer');
  assert.equal(pageModule.metadata.robots.index, false);
  const nextConfig = load('next.config.ts', { 'node:child_process': { execSync: () => 'synthetic-release' } }).default;
  const returnHeaders = (await nextConfig.headers()).find(rule => rule.source === '/integracoes/retorno');
  assert.ok(returnHeaders, 'Public return has explicit response privacy headers');
  assert.match(returnHeaders.headers.find(header => header.key === 'Cache-Control').value, /private, no-store/);
  assert.equal(returnHeaders.headers.find(header => header.key === 'Referrer-Policy').value, 'no-referrer');
  // Vercel edge configuration can override Next headers. Compile the actual
  // source patterns with its path matcher and reject conflicting policies.
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const edgeHeaders = vercel.headers.map(rule => ({ ...rule, match: pathToRegexp(rule.source, [], { sensitive: true, strict: true }) }));
  for (const [url, expected] of [
    ...['/integracoes/retorno', '/api/integrations/meta/social/callback', '/api/integrations/meta/ads/callback'].flatMap(pathname => [
      [pathname, 'no-referrer'], [`${pathname}/`, 'no-referrer'],
      [`${pathname}?state=synthetic&code=synthetic`, 'no-referrer'], [`${pathname}/?resultado=connected`, 'no-referrer'],
    ]),
    ['/integracoes/retorno?fluxo=social&resultado=connected', 'no-referrer'],
    ['/integracoes/retorno?fluxo=ads&resultado=failed', 'no-referrer'],
    ...['/', '/painel', '/painel/site', '/demonstracao', '/integracoes/retorno-extra', '/integracoes/retorno/child', '/Integracoes/Retorno', '/api/integrations/meta/social/callback-extra', '/api/integrations/meta/ads/callback/child', '/api/integrations/meta/instagram/callback', '/api/integrations/meta/Social/callback', '/_next/static/chunk.js'].map(url => [url, 'strict-origin-when-cross-origin']),
  ]) {
    const pathname = new URL(url, origin).pathname;
    const headers = edgeHeaders.filter(rule => rule.match.test(pathname)).flatMap(rule => rule.headers);
    assert.deepEqual(headers.filter(header => header.key.toLowerCase() === 'referrer-policy').map(header => header.value), [expected], `${pathname}: exactly one effective Vercel policy`);
    assert.equal(headers.find(header => header.key === 'X-Content-Type-Options')?.value, 'nosniff');
    assert.equal(headers.find(header => header.key === 'Permissions-Policy')?.value, 'camera=(), microphone=(), geolocation=()');
  }
  for (const [query, destination, label] of [
    [{ fluxo: 'social', resultado: 'connected' }, '/painel?area=integrations#integrations', 'Voltar às integrações'],
    [{ fluxo: 'ads', resultado: 'connected' }, '/painel?area=campaigns#campaigns', 'Voltar às campanhas'],
    [{ fluxo: 'social', resultado: 'failed' }, '/painel?area=integrations#integrations', 'Voltar às integrações'],
    [{ fluxo: 'ads', resultado: 'failed' }, '/painel?area=campaigns#campaigns', 'Voltar às campanhas'],
    [{}, '/painel?area=integrations#integrations', 'Voltar às integrações'],
    [{ fluxo: ['ads', 'social'], resultado: ['connected', 'failed'], next: 'https://attacker.test' }, '/painel?area=integrations#integrations', 'Voltar às integrações'],
    [{ fluxo: 'https://attacker.test', resultado: '<script>bad</script>', code, state, next: 'https://attacker.test' }, '/painel?area=integrations#integrations', 'Voltar às integrações'],
  ]) {
    const tree = await pageModule.default({ searchParams: Promise.resolve(query) });
    const nodes = walk(tree), links = nodes.filter(node => node.type === 'a');
    assert.equal(links.length, 1);
    assert.equal(links[0].props.href, destination, 'Only fixed same-origin destinations are accepted');
    assert.equal(links[0].props.onClick, undefined, 'Native navigation must work without hydration');
    assert.equal(links[0].props.target, undefined, 'Return stays in the current browser context');
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes(label));
    assert.ok(!html.includes(code) && !html.includes(state) && !html.includes('attacker.test'));
    assert.ok(!nodes.some(node => typeof node.type !== 'string'), 'Public boundary does not depend on a client router');
    assert.ok(!nodes.some(node => ['script', 'form', 'input', 'meta'].includes(node.type)), 'No auto-redirect, authentication form or token transfer');
    if (query.resultado === 'failed') assert.ok(html.includes('A conexão não foi concluída'));
    if (!['connected', 'failed'].includes(query.resultado)) assert.ok(!html.includes('A autorização foi recebida'));
  }

  const accounts = load('lib/accounts.ts', {
    'next/server': {}, './supabase': { supabaseRequest() { assert.fail('No session/DB operation belongs to the return page'); } }, './tenant-context': {},
  });
  assert.equal(accounts.cookieOptions.sameSite, 'strict');
  assert.equal(accounts.cookieOptions.httpOnly, true);
  assert.equal(accounts.cookieOptions.secure, true);

  const Dashboard = () => null, Login = () => null, Integrated = () => null;
  let actor = { role: 'owner', companyId: 'synthetic-company', brokerId: 'synthetic-owner' }, rollout = true;
  const panel = load('app/painel/page.tsx', {
    '../dashboard-client': { default: Dashboard }, './login-client': { default: Login },
    '../evolution/live-entry': { default: Integrated },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'synthetic-session' }) }) },
    '@/lib/accounts': { ACCOUNT_COOKIE: 'imobflow_session', readAccount: async token => { assert.equal(token, 'synthetic-session'); return actor; } },
    '@/lib/evolution/feature': { evolutionEnabled: () => rollout },
    '@/lib/evolution/server': { evolutionIntegrated: () => true },
  }).default;
  for (const area of ['integrations', 'settings', 'campaigns']) {
    const tree = await panel({ searchParams: Promise.resolve({ area }) });
    assert.equal(tree.type, Integrated);
    assert.equal(tree.props.initialPage, area, 'SSR selects the requested owner area before hash hydration');
  }
  for (const area of ['accounts', 'leads', 'https://attacker.test', ['settings', 'integrations']]) {
    assert.equal((await panel({ searchParams: Promise.resolve({ area }) })).props.initialPage, undefined);
  }
  actor = { ...actor, role: 'broker' };
  assert.equal((await panel({ searchParams: Promise.resolve({ area: 'settings' }) })).props.initialPage, undefined);
  assert.equal((await panel({ searchParams: Promise.resolve({ area: 'integrations' }) })).props.initialPage, undefined);
  assert.equal((await panel({ searchParams: Promise.resolve({ area: 'campaigns' }) })).props.initialPage, undefined, 'Broker cannot select campaigns through the query');
  actor = null;
  assert.equal((await panel({ searchParams: Promise.resolve({ area: 'campaigns', social: 'connected' }) })).type, Login, 'Query does not authenticate');
  actor = { role: 'owner', companyId: 'synthetic-company', brokerId: 'synthetic-owner' };
  const classic = await panel({ searchParams: Promise.resolve({ area: 'integrations', experiencia: 'classica' }) });
  assert.equal(classic.type, Dashboard);
  assert.equal(classic.props.initialView, 'integrations');
  const classicSettings = await panel({ searchParams: Promise.resolve({ area: 'settings', experiencia: 'classica' }) });
  assert.equal(classicSettings.type, Dashboard, 'Settings no longer masquerades as the campaigns fallback');
  const classicAds = await panel({ searchParams: Promise.resolve({ area: 'campaigns', experiencia: 'classica' }) });
  assert.equal(walk(classicAds).find(node => node.type === 'a').props.href, '/painel?area=campaigns#campaigns');
  rollout = false;
  const unavailableAds = await panel({ searchParams: Promise.resolve({ area: 'campaigns' }) });
  assert.ok(renderToStaticMarkup(unavailableAds).includes('ainda não está disponível'));
  assert.equal(walk(unavailableAds).find(node => node.type === 'a').props.href, '/painel?area=integrations#integrations');
  const legacySocial = await panel({ searchParams: Promise.resolve({ area: 'integrations' }) });
  assert.equal(legacySocial.type, Dashboard);
  assert.equal(legacySocial.props.initialView, 'integrations');
  console.log('PASS Meta OAuth public return: absent Strict session, both callbacks, failure, fixed native links, no credentials/session mutation, hostile queries and disjoint Vercel referrer policies');
})().catch(error => { console.error(error); process.exitCode = 1; });
