// Stylesheet/component contracts; rendered geometry is verified separately in the browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const postcss = createRequire(require.resolve('next'))('postcss');
const root = path.resolve(__dirname, '../app');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('conversation-viewport.css');
const tree = postcss.parse(css);
let count = 0;
tree.walkRules(rule => {
  for (const selector of rule.selectors) {
    assert.ok(selector.includes('[data-panel-view="conversations"]'), `Conversation-only scope: ${selector}`);
    assert.doesNotMatch(selector, /(^|[\s,])(body|html)([\s,.#:]|$)/);
  }
  count++;
});
assert.ok(count > 10);
assert.equal([...read('layout.tsx').matchAll(/import\s+['"]\.\/(.+\.css)['"]/g)].at(-1)[1], 'conversation-viewport.css');
assert.match(css, /overflow-y:\s*auto/);
assert.doesNotMatch(css, /scrollbar-width:\s*none|::-webkit-scrollbar|overflow(?:-y)?:\s*hidden/);
assert.match(css, /conversation-settings\[open\]/);
assert.match(css, /conversation-sync-notice/);
assert.match(css, /flex:\s*1 0 500px;\s*min-height:\s*500px/);
assert.match(css, /flex:\s*1 0 420px;\s*min-height:\s*420px/);
assert.match(css, /max-height:\s*599px/);
assert.match(read('dashboard-client.tsx'), /data-panel-view=\{view\}/);
assert.match(read('evolution/evolution-client.tsx'), /data-operational-page=\{operationalPage \|\| undefined\}/);
const center = read('conversation-center.tsx');
assert.match(center, /\[profileOpen, setProfileOpen\] = useState\(false\)/);
assert.match(center, /profileWasOpen\.current = false; profileToggleRef\.current\?\.focus\(\)/);
assert.match(center, /body\.getClientRects\(\)\.length === 0/);
assert.match(center, /historyPage,profileOpen\]/);
assert.match(center, /removeEventListener\('resize',onVisible\)/);
assert.match(center, /aria-controls="conversation-client-profile"/);
console.log('PASS conversation viewport: parsed scoped CSS, import order, internal scroll, short-screen/settings fallback, explicit profile/focus/read guards. No production or rendered geometry tested.');
