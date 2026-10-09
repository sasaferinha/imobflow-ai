const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const postcss = createRequire(require.resolve('next'))('postcss');

// Visual source contracts only. Browser geometry and real account flows are
// validated separately; this test does not perform network requests.
const app = path.join(__dirname, '..', 'app');
const files = [
  'crm-access.css', 'apresentacao/presentation.module.css',
  'product-preview.module.css', 'business-landing.module.css',
  'simulador-financiamento/calculator.module.css', 'landing-refinement.css',
  'landing-editorial.css', 'demonstracao/product-demo.css',
];
const sheets = new Map(files.map(file => {
  const text = fs.readFileSync(path.join(app, file), 'utf8');
  assert.doesNotMatch(text, /Nunito|Roboto/, `${file}: use the shared ImobFlow type family`);
  return [file, postcss.parse(text, { from: file })];
}));

function declaration(file, selector, property, expected) {
  const matches = [];
  sheets.get(file).walkRules(selector, rule => {
    if (rule.parent.type === 'root') rule.walkDecls(property, item => matches.push(item.value));
  });
  assert.equal(matches.at(-1), expected, `${file} ${selector} ${property}`);
}

const access = sheets.get('crm-access.css');
access.walkRules(rule => {
  for (const selector of rule.selectors) assert(selector.includes('.crm-access-surface'), `unscoped access style: ${selector}`);
});
declaration('crm-access.css', '.crm-access-surface.access-page', 'background', '#f3f8ff');
declaration('crm-access.css', '.crm-access-surface .access-card', 'border-radius', '12px');
declaration('crm-access.css', '.crm-access-surface .access-form :is(input, select)', 'border-radius', '8px');
declaration('crm-access.css', '.crm-access-surface .access-form :is(input, select)', 'height', '44px');
declaration('apresentacao/presentation.module.css', '.product', 'border-radius', '12px');
declaration('apresentacao/presentation.module.css', '.explanation', 'border-radius', '12px');
declaration('simulador-financiamento/calculator.module.css', '.surface', 'border-radius', '12px');
declaration('product-preview.module.css', '.screen', 'background', '#fff');
declaration('product-preview.module.css', '.caption .explorePanel', 'border-radius', '8px');

const demo = sheets.get('demonstracao/product-demo.css');
demo.walkRules(rule => {
  assert(!rule.selector.includes('.sidebar'), 'demo must inherit the real CRM sidebar geometry');
  rule.walkDecls(decl => {
    assert(!['mask-image', 'background-image'].includes(decl.prop), 'demo must not erase live charts or icon rendering');
  });
});
const notice = [];
demo.walkRules('.embedded-admin-demo .public-demo-notice', rule => rule.walkDecls('clip-path', value => notice.push(value.value)));
assert(notice.includes('inset(50%)'), 'embedded demo still keeps its accessible fictional-data notice');

const noticeOffsets = [];
demo.walkRules('.public-product-demo:not(.embedded-admin-demo) .public-demo-notice', rule => {
  rule.walkDecls('padding-left', value => noticeOffsets.push({ media: rule.parent.params, value: value.value }));
});
assert.deepEqual(noticeOffsets, [{ media: '(min-width: 901px)', value: 'calc(var(--crm-sidebar-width, 208px) + 24px)' }], 'standalone desktop notice must clear the fixed sidebar without changing embedded notices');
const shell = postcss.parse(fs.readFileSync(path.join(app, 'crm-shell.css'), 'utf8'));
let mobileSidebarInFlow = false;
shell.walkAtRules('media', media => {
  if (media.params !== '(max-width: 900px)') return;
  media.walkRules('.app-shell.crm-workspace > .sidebar', rule => {
    rule.walkDecls('position', value => { if (value.value === 'relative') mobileSidebarInFlow = true; });
  });
});
assert(mobileSidebarInFlow, 'demo notice offset breakpoint must remain aligned with the actual responsive sidebar');

console.log('PASS public identity: 8 stylesheets parsed, scoped access tokens and controls, presentation/calculator cards, white preview frame, unchanged real demo shell/chart styling and accessible demo notice. No browser layout or production requests tested.');
