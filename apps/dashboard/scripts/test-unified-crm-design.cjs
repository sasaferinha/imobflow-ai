const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const postcss = createRequire(require.resolve('next'))('postcss');
const root = path.resolve(__dirname, '..');

// Stylesheet contracts and isolated component renders. These tests do not
// replace a browser layout check and never access a real account or network.
const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
const imports = [...layout.matchAll(/import\s+['"](.+\.css)['"]/g)].map(match => match[1]);
for (const name of ['crm-foundation', 'crm-shell', 'crm-operational', 'conversation-workspace', 'crm-access']) {
  assert(imports.includes(`./${name}.css`), `${name} must be imported by the shared layout`);
}
assert(imports.indexOf('./crm-foundation.css') > imports.indexOf('./native-theme.css'));
assert(imports.indexOf('./crm-operational.css') > imports.indexOf('./crm-foundation.css'));
assert(imports.indexOf('./conversation-workspace.css') > imports.indexOf('./crm-operational.css'));

const parsed = new Map();
for (const file of [...imports, './opportunity-center.module.css', './client-import.module.css', './team-modal.module.css']) {
  parsed.set(file, postcss.parse(fs.readFileSync(path.join(root, 'app', file), 'utf8'), { from: file }));
}
const operational = parsed.get('./crm-operational.css');
operational.walkRules(rule => {
  for (const selector of rule.selectors) {
    assert(selector.includes('.crm-workspace'), `operational rule leaks outside workspace: ${selector}`);
    if (/^\.app-shell\.crm-workspace\s+(?:button|:is\(button\))$/.test(selector)) {
      assert(!rule.nodes.some(node => node.prop === 'width' && node.value === '100%'), 'do not expand every button to full width');
    }
  }
});
for (const module of ['opportunity-center', 'client-import', 'team-modal']) {
  const source = fs.readFileSync(path.join(root, 'app', `${module}.tsx`), 'utf8');
  const localClasses = new Set();
  parsed.get(`./${module}.module.css`).walkRules(rule => {
    for (const match of rule.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) localClasses.add(match[1]);
  });
  for (const match of source.matchAll(/styles\.([a-zA-Z_]\w*)/g)) {
    assert(localClasses.has(match[1]), `${module} references missing CSS class ${match[1]}`);
  }
}

const cssModule = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const sampleLead = { name: 'Cliente de teste', phone: '35999999999', goal: 'Comprar', propertyType: 'Casa', region: 'Centro', budget: '300000' };
function runtime(react = React, services = {}) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } });
    const errors = (compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${file} must parse as TypeScript/JSX`);
    const module = { exports: {} };
    vm.runInNewContext(compiled.outputText, {
      module, exports: module.exports, console, URL, Blob, setTimeout,
      require(id) {
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return cssModule;
        if (id === './password-input') return load('app/password-input.tsx');
        if (id === '@/lib/dashboard-transport') return { dashboardFetch: services.fetch || (() => { throw Error('Unexpected network call during render'); }) };
        if (id === '@/lib/dashboard-sync') return { announceDashboardChange: services.announce || (() => {}), subscribeDashboardSync: () => () => {} };
        if (id === '@/lib/leads') return { hasCommercialQualification: () => true };
        if (id === '@/lib/lead-import') return { IMPORT_BYTES: 2 * 1024 * 1024, leadImportTemplate: 'nome,telefone', parseLeadImport: () => [sampleLead] };
        if (id === '@/lib/plans') return { planNameForLimit: () => 'Teste' };
        throw Error(`Unexpected component dependency: ${id}`);
      },
    }, { filename: file });
    modules.set(file, module.exports);
    return module.exports;
  }
  return { load };
}
const server = runtime();
const importsHtml = renderToStaticMarkup(React.createElement(server.load('app/client-import.tsx').default, { onImported() {}, onOpportunities() {} }));
assert(importsHtml.includes('aria-label="Importar clientes antigos"'));
assert(importsHtml.includes('aria-label="Etapas da importação"'));
assert.equal((importsHtml.match(/data-current="true"/g) || []).length, 1, 'only the current import stage is emphasized');
assert(importsHtml.includes('type="file"') && importsHtml.includes('accept=".csv,text/csv"'));
assert(!importsHtml.includes('<form'), 'the presentation must not add a competing form submit');
const opportunitiesHtml = renderToStaticMarkup(React.createElement(server.load('app/opportunity-center.tsx').default, { onLead() {}, onProperty() {} }));
assert(opportunitiesHtml.includes('aria-labelledby="compatible-properties-title"'));
assert(opportunitiesHtml.includes('id="compatible-properties-title"'));
assert.equal((opportunitiesHtml.match(/role="status"/g) || []).length, 2, 'both asynchronous sections retain accessible loading status');
const teamHtml = renderToStaticMarkup(React.createElement(server.load('app/team-modal.tsx').default, { close() {}, notify() {} }));
assert(teamHtml.includes('role="dialog"') && teamHtml.includes('aria-modal="true"'));
assert(teamHtml.includes('aria-labelledby="crm-team-title"') && teamHtml.includes('id="crm-team-title"'));
assert(teamHtml.includes('type="password"'), 'password input remains masked by default');

function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return null; }
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function label(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(label).join('');
  return typeof node === 'object' ? label(node.props?.children) : String(node);
}
function importHarness(publicDemo = false) {
  const slots = [], calls = [], announcements = [], imported = [];
  let cursor = 0, tree;
  const hooks = {
    ...React,
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; }];
    },
  };
  const isolated = runtime(hooks, {
    fetch: async (url, options) => { calls.push({ url, ...options }); return { ok: true, json: async () => ({ data: { imported: 1, skipped: 0, leads: [sampleLead] } }) }; },
    announce: entity => announcements.push(entity),
  });
  const Client = isolated.load('app/client-import.tsx').default;
  function render() { cursor = 0; tree = Client({ publicDemo, onImported: value => imported.push(value), onOpportunities() {} }); return tree; }
  render();
  return { render, calls, announcements, imported, get tree() { return tree; } };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function pickCsv(harness) {
  const input = find(harness.tree, node => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files: [{ name: 'clientes.csv', size: 100, text: async () => 'nome,telefone\nCliente,35999999999' }], value: 'file' } });
  await flush(); harness.render();
}
async function workflow() {
  const live = importHarness();
  await pickCsv(live);
  assert.equal(live.calls.length, 0, 'selecting a file is a local preview, never an import');
  assert(find(live.tree, node => node.type === 'table'), 'preview must remain a semantic table');
  const steps = find(live.tree, node => node.type === 'ol');
  assert.equal(steps.props.children[1].props['data-current'], true, 'review step reflects actual state');
  const confirm = find(live.tree, node => node.type === 'button' && label(node).startsWith('Confirmar importação'));
  assert(confirm && !confirm.props.disabled);
  confirm.props.onClick();
  confirm.props.onClick();
  await flush(); live.render();
  assert.equal(live.calls.length, 1, 'the existing duplicate-submit guard must survive the redesign');
  assert.equal(live.calls[0].url, '/api/leads/import');
  assert.equal(live.calls[0].method, 'POST');
  assert.equal(JSON.parse(live.calls[0].body).leads[0].phone, sampleLead.phone);
  assert.equal(live.imported.length, 1, 'successful import still updates the parent');
  assert.deepEqual(live.announcements, ['leads', 'opportunities']);
  assert(find(live.tree, node => node.props?.role === 'status'), 'success is announced accessibly');
  assert.equal(find(live.tree, node => node.type === 'ol').props.children[2].props['data-current'], true);
  const demo = importHarness(true);
  await pickCsv(demo);
  find(demo.tree, node => node.type === 'button' && label(node).startsWith('Confirmar importação')).props.onClick();
  await flush(); demo.render();
  assert.equal(demo.calls.length, 0, 'public demonstration must still block live imports');
  assert(find(demo.tree, node => node.props?.role === 'alert'), 'the restriction stays accessible');
}
workflow().then(() => console.log('PASS unified CRM design: parsed stylesheet scope/order, real TSX renders, accessible headings/dialogs, staged import flow, duplicate-submit guard and public-demo isolation. No production requests or rendered geometry tested.')).catch(error => { console.error(error); process.exitCode = 1; });
