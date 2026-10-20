const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const cache = new Map();
let networkCalls = 0;
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = name => {
    if (name.startsWith('.')) return load(`${path.posix.normalize(path.posix.join(path.posix.dirname(file), name))}.ts`);
    throw Error(`Unexpected dependency: ${name}`);
  };
  vm.runInNewContext(output, { module: mod, exports: mod.exports, require: localRequire, Date, URL, structuredClone,
    crypto: crypto.webcrypto, fetch: () => { networkCalls++; throw Error('Network is forbidden'); } });
  cache.set(file, mod.exports); return mod.exports;
}
const config = load('lib/evolution/website-settings.ts');
const model = load('lib/evolution/model.ts');
const ai = load('lib/ai/tenant-settings.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { companyId: id(1), brokerId: id(11), name: 'Gestor sintético', role: 'owner' };
const broker = { companyId: id(1), brokerId: id(12), name: 'Corretor sintético', role: 'broker' };
const now = '2026-10-20T15:00:00.000Z';
const website = { url: 'https://www.example.com/imoveis', provider: 'Fornecedor sintético', syncScope: 'full' };
const command = value => ({ type: 'settings', settings: { website: value } });
const initial = model.emptyState(id(1));
initial.members = [owner, broker].map(actor => ({ id: actor.brokerId, name: actor.name, role: actor.role, specialization: 'Ambos' }));
initial.settings.ai = { ...ai.getTenantAISettings(), updatedAt: now, updatedBy: owner.brokerId };
initial.settings.operations = { captureRemindersEnabled: true };

assert.deepEqual(plain(config.getWebsiteSettings()), { url: '', provider: '', syncScope: 'full' });
const cloned = config.getWebsiteSettings(); cloned.provider = 'Changed';
assert.equal(config.getWebsiteSettings().provider, '');
assert.ok(Object.isFrozen(config.DEFAULT_WEBSITE_SETTINGS));
assert.deepEqual(plain(config.validateWebsiteSettings(website)), website);
assert.equal(config.validateWebsiteSettings({ ...website, url: '  HTTPS://WWW.EXAMPLE.COM:443/imoveis  ', provider: '  Fornecedor  ' }).url, website.url);
assert.equal(config.validateWebsiteSettings({ ...website, url: 'https://example.com' }).url, 'https://example.com/');
assert.equal(config.validateWebsiteSettings({ ...website, url: 'https://imóveis.com.br/lista', provider: '' }).url, 'https://xn--imveis-cxa.com.br/lista');
assert.equal(config.validateWebsiteSettings({ ...website, url: 'https://example.com/cat%C3%A1logo' }).url, 'https://example.com/cat%C3%A1logo');
assert.equal(config.validateWebsiteSettings({ ...website, provider: 'x'.repeat(100) }).provider.length, 100);
const maximumUrl = `https://example.com/${'a'.repeat(1024 - 'https://example.com/'.length)}`;
assert.equal(config.validateWebsiteSettings({ ...website, url: maximumUrl }).url.length, 1024);
assert.deepEqual(plain(config.validateWebsiteSettings({ url: '  ', provider: ' ', syncScope: 'full' })), plain(config.DEFAULT_WEBSITE_SETTINGS));

const invalidUrls = [
  'http://example.com', '//example.com', 'https:example.com', 'https:////example.com', 'javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd',
  'https://user:secret@example.com', 'https://user@example.com', 'https://@example.com', 'https://example.com@localhost',
  'https://example.com?token=secret', 'https://example.com?', 'https://example.com#fragment', 'https://example.com#',
  'https://example.com:80', 'https://example.com:444', 'https://example.com:0443', 'https://example.com:',
  'https://localhost', 'https://LOCALHOST', 'https://sub.localhost', 'https://localhost.', 'https://intranet', 'https://company.internal',
  'https://router.local', 'https://intranet.lan', 'https://company.localdomain', 'https://service.home.arpa', 'https://company.intranet',
  'https://company.test', 'https://company.invalid', 'https://company.onion', 'https://company.corp',
  'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1', 'https://127.0x0.0.1',
  'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fe80::1]', 'https://[2606:4700:4700::1111]',
  'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.1.1', 'https://169.254.169.254', 'https://100.64.0.1', 'https://8.8.8.8',
  'https://%6cocalhost', 'https://%31%32%37.0.0.1', 'https://１２７.０.０.１',
  'https://metadata.google.internal', 'https://example.com\\@127.0.0.1', 'https://example.com/\r\nheader', 'https://example.com/\n',
  'https://example.com/white space', 'https://example.com/%0d%0aheader', 'https://example.com/%00', 'https://example.com/%5cpath',
  'https://example..com', 'https://example.com.', 'https://-invalid.com', 'https://invalid-.com', 'https://under_score.com',
  `https://${'x'.repeat(64)}.com`, maximumUrl + 'a',
];
for (const url of invalidUrls) assert.throws(() => config.validateWebsiteSettings({ ...website, url }), config.WebsiteSettingsValidationError, url);
for (const raw of [null, undefined, [], {}, 'string', false, { url: website.url, syncScope: 'full' },
  { ...website, provider: null }, { ...website, provider: 'x'.repeat(101) }, { ...website, provider: 'a\nb' }, { ...website, url: null },
  { ...website, url: '', provider: 'Fornecedor' }, { ...website, syncScope: 'publish' },
  ...['status', 'connected', 'apiKey', 'key', 'token', 'password', 'companyId', 'updatedAt', 'updatedBy', '__proto__'].map(key => ({ ...website, [key]: 'forged' })),
]) assert.throws(() => config.validateWebsiteSettings(raw), config.WebsiteSettingsValidationError);

const audited = { ...website, updatedAt: now, updatedBy: owner.brokerId };
assert.deepEqual(plain(config.getWebsiteSettings(audited)), website);
for (const raw of [null, {}, { ...audited, updatedBy: 'forged' }, { ...audited, updatedAt: 'infinity' },
  { ...website, updatedAt: now }, { ...website, updatedBy: owner.brokerId }, { ...audited, connected: true }]) {
  assert.throws(() => config.getWebsiteSettings(raw), config.WebsiteSettingsValidationError);
}
const before = structuredClone(initial);
const saved = model.applyCommand(initial, owner, command(website), now);
assert.deepEqual(plain(initial), plain(before), 'source state is never mutated');
assert.equal(saved.version, initial.version + 1);
assert.deepEqual(plain(saved.settings.website), audited);
assert.deepEqual(plain(saved.settings.ai), plain(initial.settings.ai), 'AI settings and audit untouched');
assert.deepEqual(plain(saved.settings.operations), plain(initial.settings.operations));
for (const field of ['inactivityDays', 'sources', 'categories', 'lossReasons', 'distributionEnabled']) assert.deepEqual(plain(saved.settings[field]), plain(initial.settings[field]));
assert.deepEqual(plain(saved.records), plain(initial.records)); assert.deepEqual(plain(saved.events), plain(initial.events));
assert.ok(!('website' in model.visibleState(saved, broker).settings));
assert.ok(!('ai' in model.visibleState(saved, broker).settings));
assert.deepEqual(plain(model.visibleState(saved, owner).settings.website), audited);
assert.deepEqual(plain(saved.settings.website), audited, 'redaction does not delete stored data');
assert.ok(!('website' in model.visibleState(initial, owner).settings), 'legacy state remains absent');

for (const actor of [broker, { ...broker, role: 'owner' }, { ...owner, companyId: id(2) }, { ...owner, brokerId: id(99) }]) {
  assert.throws(() => model.applyCommand(saved, actor, command(website), now), error => error instanceof model.CrmError && error.status === 403);
}
const otherState = model.emptyState(id(2));
otherState.members = [{ id: id(21), name: 'Outro gestor', role: 'owner', specialization: 'Ambos' }];
assert.throws(() => model.applyCommand(otherState, owner, command(website), now), error => error.status === 403);
assert.ok(!otherState.settings.website);
for (const value of [null, undefined, { ...website, updatedAt: now, updatedBy: id(21) }, { ...website, connected: true }]) {
  assert.throws(() => model.applyCommand(saved, owner, command(value), now), error => error instanceof model.CrmError && error.status === 400);
}
assert.deepEqual(plain(saved.settings.website), audited, 'invalid edits preserve saved configuration');
const unrelated = model.applyCommand(saved, owner, { type: 'settings', settings: { sources: ['Site', 'WhatsApp'] } }, now);
assert.deepEqual(plain(unrelated.settings.website), audited, 'unrelated changes retain website and audit');
const cleared = model.applyCommand(saved, owner, command(config.getWebsiteSettings()), '2026-10-20T16:00:00.000Z');
assert.deepEqual(plain(cleared.settings.website), { url: '', provider: '', syncScope: 'full', updatedAt: '2026-10-20T16:00:00.000Z', updatedBy: owner.brokerId });
assert.deepEqual(plain(cleared.settings.ai), plain(initial.settings.ai));
assert.equal(networkCalls, 0, 'preparation performs no HTTP or provider request');
console.log('PASS website preparation: strict HTTPS/domain syntax and URL limits, SSRF-like strings rejected, no credentials/status injection, owner/tenant guards, broker redaction, server audit, legacy/AI preservation, clear flow and no network calls.');
console.log('Syntax validation does not prove public DNS, site ownership or an active integration; future network adapters must validate those independently.');
