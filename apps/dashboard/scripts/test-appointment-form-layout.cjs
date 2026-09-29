const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const postcss = createRequire(require.resolve('next'))('postcss');
const appDirectory = path.join(__dirname, '../app');
const layout = fs.readFileSync(path.join(appDirectory, 'layout.tsx'), 'utf8');
const imports = [...layout.matchAll(/import\s+['"](.+\.css)['"]/g)].map((match) => match[1]);
assert.ok(imports.includes('./globals.css'), 'include legacy styles in the regression');
assert.ok(imports.includes('./appointment-form.css'), 'appointment stylesheet is imported');

// Follow the actual root-layout import order. These are stylesheet contracts for
// the known colliding selectors, not a browser engine or rendered-geometry test.
const rules = [];
for (const file of imports) {
  const source = fs.readFileSync(path.join(appDirectory, file), 'utf8');
  postcss.parse(source, { from: file }).walkRules((rule) => {
    if (rule.parent.type !== 'root') return;
    for (const selector of rule.selectors) {
      const declarations = rule.nodes.filter((node) => node.type === 'decl');
      rules.push({ selector: normalize(selector), declarations });
    }
  });
}

function normalize(selector) {
  return selector.trim().replace(/\s*>\s*/g, '>').replace(/\s+/g, ' ');
}

function specificity(selector) {
  // The explicit contract selectors below contain only classes, types and
  // child/descendant combinators. Reject additions outside that supported set.
  assert.match(selector, /^[.\w\s>\-]+$/, `unsupported contract selector: ${selector}`);
  return [
    (selector.match(/\.[\w-]+/g) || []).length,
    (selector.replace(/\.[\w-]+/g, '').match(/[a-zA-Z][\w-]*/g) || []).length,
  ];
}

function winner(selectors, property, sourceRules = rules) {
  const candidates = new Set(selectors.map(normalize));
  let selected;
  for (const rule of sourceRules) {
    if (!candidates.has(rule.selector)) continue;
    for (const declaration of rule.declarations) {
      if (declaration.prop !== property) continue;
      const priority = [declaration.important ? 1 : 0, ...specificity(rule.selector)];
      const comparison = selected
        ? priority.reduce((result, value, index) => result || value - selected.priority[index], 0)
        : 1;
      if (comparison >= 0) selected = { value: declaration.value, selector: rule.selector, priority };
    }
  }
  assert.ok(selected, `missing ${property} for ${selectors.join(', ')}`);
  return selected;
}

function expect(selectors, property, expected) {
  assert.equal(winner(selectors, property).value, expected, `${property}: ${selectors.join(', ')}`);
}

const fieldSelector = '.app-shell.app-shell .appointment-form > .visit-record-field';
const fieldCandidates = ['.inline-form > div', '.visit-record-field', fieldSelector];
expect(fieldCandidates, 'display', 'grid');
expect(fieldCandidates, 'grid-template-columns', 'minmax(0, 1fr)');
expect(fieldCandidates, 'align-items', 'start');
expect(fieldCandidates, 'width', '100%');
expect(fieldCandidates, 'min-width', '0');
assert.equal(winner(fieldCandidates, 'display').selector, normalize(fieldSelector));

// Recreate the original single-class selector without changing any files. The
// legacy child rule must win again, proving this test sees the actual collision.
const originalRules = rules.map((rule) => rule.selector === normalize(fieldSelector)
  ? { ...rule, selector: '.visit-record-field' }
  : rule);
const originalWinner = winner(fieldCandidates, 'display', originalRules);
assert.equal(originalWinner.value, 'flex');
assert.equal(originalWinner.selector, '.inline-form>div');

const genericButtons = [
  '.inline-form button',
  '.app-shell .inline-form button',
  '.app-shell.app-shell .native-agenda .inline-form button',
  '.app-shell.app-shell .appointment-form button',
];
const triggerCandidates = [...genericButtons, '.app-shell.app-shell .appointment-form button.visit-record-trigger'];
expect(triggerCandidates, 'flex', 'none');
expect(triggerCandidates, 'width', '100%');
expect(triggerCandidates, 'min-width', '0');
expect(triggerCandidates, 'height', 'auto');
expect(triggerCandidates, 'min-height', '46px');
expect(triggerCandidates, 'line-height', '1.45');
expect(['.visit-record-trigger > span'], 'white-space', 'normal');
expect(['.visit-record-trigger > span'], 'overflow-wrap', 'anywhere');
expect(['.visit-record-trigger > span'], 'min-width', '0');
expect(['.visit-record-trigger svg'], 'flex-shrink', '0');
expect(['.visit-record-selected-detail'], 'display', 'block');
expect(['.visit-record-selected-detail'], 'min-width', '0');
expect(['.visit-record-selected-detail'], 'line-height', '1.5');
expect(['.visit-record-selected-detail'], 'overflow-wrap', 'anywhere');

const closeCandidates = [...genericButtons, '.app-shell.app-shell .appointment-form .visit-record-heading button'];
expect(closeCandidates, 'flex', '0 0 36px');
expect(['.visit-record-footer'], 'flex-wrap', 'wrap');
expect(['.visit-record-footer > div'], 'flex-wrap', 'wrap');
expect(['.visit-record-footer > div'], 'min-width', '0');
expect(['.app-shell.app-shell .visit-time-picker'], 'display', 'grid');
expect(['.app-shell.app-shell .visit-time-picker'], 'grid-template-columns', '18px minmax(0,1fr) 8px minmax(0,1fr)');
const actionsCandidates = ['.inline-form > div', '.app-shell.app-shell .appointment-form .visit-form-actions'];
expect(actionsCandidates, 'display', 'grid');
expect(actionsCandidates, 'grid-template-columns', '1fr 1fr');

const picker = fs.readFileSync(path.join(appDirectory, 'appointment-record-picker.tsx'), 'utf8');
const dashboard = fs.readFileSync(path.join(appDirectory, 'dashboard-client.tsx'), 'utf8');
assert.match(picker, /return <div className="visit-record-field">/, 'contract targets the real picker root');
assert.match(dashboard, /<form className="inline-form appointment-form"/, 'contract targets the shared appointment form');
assert.match(dashboard, /<AppointmentRecordPicker kind="lead"/);
assert.match(dashboard, /<AppointmentRecordPicker kind="property"/);

console.log('PASS appointment layout stylesheet contracts: legacy flex collision reproduced; scoped vertical fields, wrapping text, compact controls and responsive footer protected. No rendered geometry or production writes tested.');
