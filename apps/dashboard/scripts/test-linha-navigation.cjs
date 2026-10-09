const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { navigationHarness, find, text, button, click, owner, state, runtime } = require('./test-evolution-navigation.cjs');

// Synthetic records, an isolated hook runner and stylesheet contracts only.
// This supplements (not replaces) browser layout/focus verification.
const root = path.resolve(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'app/evolution/evolution-client.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/evolution/evolution.module.css'), 'utf8');
const schema = runtime().load('lib/evolution/schema.ts');
const nav = navigationHarness(owner, '#dashboard');
const mainNav = () => find(nav.tree, node => node.type === 'nav' && node.props['aria-label'] === 'Navegação principal');
const primary = ['Dashboard', 'Conversas', 'Leads', 'Imóveis', 'Agenda', 'Equipe', 'Relatórios', 'Configurações'];
const directButtons = mainNav().props.children.map(group => find(group, node => node.type === 'button' && node.props.className === 'navButton'));
assert.deepEqual(Array.from(directButtons, text), primary);
assert.equal(directButtons[0].props['aria-current'], 'page');
assert(find(nav.tree, node => node.type === 'aside'), 'Navigation belongs to the persistent sidebar.');
assert.equal(find(nav.tree, node => node.props?.className === 'headerSearch').props.children[1].props['aria-label'], 'Busca global');

function expand(harness, title) {
  const trigger = find(harness.tree, node => node.props?.['aria-label'] === `Opções de ${title}`);
  assert(trigger, `Missing secondary navigation for ${title}`);
  trigger.props.onClick(); harness.render();
  const open = find(harness.tree, node => node.props?.id === trigger.props['aria-controls']);
  assert(open, 'Expanded submenu is associated with its control.');
  return open.props.children.map(text);
}
const reachable = new Set(primary);
for (const name of primary.slice(1)) for (const label of expand(nav, name)) reachable.add(label);
for (const definition of Object.values(schema.MODULES)) assert(reachable.has(definition.title), `${definition.title} remains reachable.`);
for (const label of ['Oportunidades', 'Importar clientes', 'Carteira de clientes', 'Catálogo e fotos', 'Agenda de visitas', 'Corretores e acessos', 'Resultados da operação', 'Metas da operação', 'Integrações', 'Minha conta']) assert(reachable.has(label), `${label} remains reachable.`);
assert(find(nav.tree, node => node.props?.className?.startsWith('workspaceShortcut')), 'Central de gestão remains available.');

click(nav, 'Dashboard');
const metrics = find(nav.tree, node => node.props?.className === 'summaryGrid');
assert.equal(metrics.props.children.length, 4);
assert(text(metrics.props.children[0]).startsWith('Atendimentos ativos'));
assert(text(metrics.props.children[2]).startsWith('Imóveis disponíveis'));
assert(text(metrics.props.children[3]).includes('Venda') && text(metrics.props.children[3]).includes('Locação'), 'Sale values and monthly rent stay separate.');
assert(clientSource.includes("drillCases({ status: 'Aberto' })"), 'Active KPI drills into open cases only.');
const pair = find(nav.tree, node => node.props?.className === 'journeyGrid');
assert.equal(pair.props.children.length, 2);
assert.equal(pair.props.children[0].props['aria-label'], 'Negociação de venda');
assert.equal(pair.props.children[1].props['aria-label'], 'Captação de venda');
for (const stage of [...schema.NEGOTIATION_STAGES, ...schema.CAPTURE_STAGES]) assert(text(pair).includes(stage));
assert(find(nav.tree, node => node.type === 'details' && node.props.className === 'dashboardDetails'), 'Additional analytics are preserved in a disclosed section.');
assert.equal(find(nav.tree, node => node.props?.className === 'dashboardFollowups').props.children.length, 2, 'Activities and history follow the retained funnel panel.');
for (const name of ['Data inicial', 'Data final', 'Responsável', 'Finalidade']) assert(find(nav.tree, node => node.props?.['aria-label'] === name), `${name} filter is retained.`);

const broker = navigationHarness({ ...owner, role: 'broker' }, '#dashboard');
assert(!expand(broker, 'Equipe').includes('Corretores e acessos'));
assert(!expand(broker, 'Leads').includes('Importar clientes'));
assert(!expand(broker, 'Relatórios').includes('Metas da operação'));
assert(!expand(broker, 'Configurações').includes('Conteúdo e banners'));

const handlers = {}, resizeHandlers = {};
const documentStub = { body: { style: { overflow: 'auto' } }, activeElement: null, addEventListener: (name, fn) => { handlers[name] = fn; }, removeEventListener: name => { delete handlers[name]; } };
const mobile = navigationHarness(owner, '#dashboard', { document: documentStub, window: { innerWidth: 390, addEventListener: (name, fn) => { resizeHandlers[name] = fn; }, removeEventListener: name => { delete resizeHandlers[name]; } } });
const trigger = find(mobile.tree, node => node.props?.['aria-label'] === 'Abrir navegação');
let restoredFocus = false;
trigger.props.ref.current = { focus() { restoredFocus = true; } };
trigger.props.onClick(); mobile.render();
assert.equal(documentStub.body.style.overflow, 'hidden');
assert.equal(find(mobile.tree, node => node.type === 'aside').props['aria-modal'], true);
assert.equal(find(mobile.tree, node => node.props?.className === 'workspace').props.inert, true);
assert(handlers.keydown && resizeHandlers.resize);
let prevented = false;
handlers.keydown({ key: 'Escape', preventDefault() { prevented = true; } });
assert.equal(restoredFocus, false, 'Do not focus the trigger while its workspace is still inert.');
mobile.render();
assert(prevented && restoredFocus);
assert.equal(documentStub.body.style.overflow, 'auto', 'Closing the drawer restores scrolling.');
assert(!handlers.keydown && !resizeHandlers.resize, 'Drawer listeners clean up.');
assert.equal(find(mobile.tree, node => node.type === 'aside').props['aria-modal'], undefined);
assert(!find(mobile.tree, node => node.props?.className === 'sidebarBackdrop'));

for (const contract of ['--ev-sidebar-width: 208px', '--ev-panel-radius: 12px', '--ev-font: var(--crm-font, Inter', '.sidebar.sidebarOpen', '.dashboardFollowups', '--ink: var(--ev-ink)', '--paper: var(--ev-paper)', 'prefers-reduced-motion']) assert(css.includes(contract), `Missing visual/accessibility contract: ${contract}`);
const { createRequire } = require('node:module');
const postcss = createRequire(require.resolve('next'))('postcss');
postcss.parse(css);
const classes = new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(match => match[1]));
for (const match of clientSource.matchAll(/\bs\.([a-zA-Z_]\w*)/g)) assert(classes.has(match[1]), `Missing stylesheet class ${match[1]}`);
assert(nav.requests.every(request => request.method === 'GET'), 'Navigation performs no writes.');
assert(state.records.every(record => record.id), 'Fixture contains only synthetic stable records.');
console.log('PASS Linha: 8 primary routes; all secondary modules; owner/broker boundaries; mobile Escape, inert, focus restoration and cleanup; retained funnels/real metrics; CSS parse/contracts. No live requests.');
