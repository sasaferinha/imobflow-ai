const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map(), hooks = new Map();
let currentHooks, index = 0;
const jsx = (type, props) => ({ type, props: props || {} });
const react = {
  useState(initial) { const slot = index++; const values = currentHooks; values[slot] ||= { value: typeof initial === 'function' ? initial() : initial }; return [values[slot].value, next => { values[slot].value = typeof next === 'function' ? next(values[slot].value) : next; }]; },
  useRef(value) { const slot = index++; return currentHooks[slot] ||= { current: value }; },
  useEffect() {},
};
function load(file) {
  if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} }; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) });
      if (name.startsWith('@/')) return load(path.join(root, name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      throw Error('Unexpected dependency: ' + name);
    },
    crypto: require('node:crypto').webcrypto, structuredClone, URL, Date, Intl, Response, Request, console,
    process: { env: {} }, fetch() { throw Error('Demonstration must not call any API.'); },
  }, { filename: file });
  return module.exports;
}
function render(fn, props, key) {
  if (!hooks.has(key)) hooks.set(key, []);
  currentHooks = hooks.get(key); index = 0; return fn(props);
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)] : [];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join(' ') : '';

module.exports = (async () => {
  const fixture = load(path.join(root, 'lib/product-demo-data')).createProductDemoTransport();
  const properties = (await (await fixture('/api/properties')).json()).data;
  const Demo = load(path.join(root, 'app/demonstracao/property-visit-demo')).default;
  const workflow = load(path.join(root, 'app/evolution/property-workflows'));
  const { createProductDemoVisitState, productDemoVisitActor } = load(path.join(root, 'lib/product-demo-visits'));
  const { applyCommand } = load(path.join(root, 'lib/evolution/model'));
  const property = properties.find(item => item.title === 'Apartamento no Centro');
  const props = { property, close() {} };
  let tree = render(Demo, props, 'demo');
  let startProps = nodes(tree).find(item => item.type === workflow.PropertyVisitStartPanel).props;
  let panel = render(workflow.PropertyVisitStartPanel, startProps, 'start');
  assert.match(text(panel), /Compra · Ana Martins/);
  assert.ok(!text(panel).includes('Locação · Lucas'), 'buying property only offers matching existing cases');
  nodes(panel).find(item => item.type === 'select').props.onChange({ target: { value: 'demo-case-1' } });
  panel = render(workflow.PropertyVisitStartPanel, startProps, 'start');
  const form = nodes(panel).find(item => item.type === 'form');
  await Promise.all([form.props.onSubmit({ preventDefault() {} }), form.props.onSubmit({ preventDefault() {} })]);
  tree = render(Demo, props, 'demo');
  let visitProps = nodes(tree).find(item => item.type === workflow.VisitWorkflowPanel).props;
  assert.equal(visitProps.record.data.propertyId, property.id);
  assert.equal(visitProps.record.data.visitPersonId, 'demo-person-1');
  assert.equal(visitProps.record.data.visitBrokerId, productDemoVisitActor.brokerId);
  assert.ok(visitProps.record.data.visitStartedAt);
  panel = render(workflow.VisitWorkflowPanel, visitProps, 'visit');
  assert.match(text(panel), /Encerrar visita/);
  await nodes(panel).find(item => item.type === 'form').props.onSubmit({ preventDefault() {} });
  tree = render(Demo, props, 'demo');
  visitProps = nodes(tree).find(item => item.type === workflow.VisitWorkflowPanel).props;
  assert.equal(visitProps.record.data.status, 'Realizada');
  assert.ok(visitProps.record.data.visitEndedAt);
  assert.equal(visitProps.record.data.clientFeedback, '', 'closing requires no extra observation');
  panel = render(workflow.VisitWorkflowPanel, visitProps, 'visit');
  const Feedback = load(path.join(root, 'app/evolution/property-feedback-panel')).default;
  const feedbackProps = nodes(panel).find(item => item.type === Feedback).props;
  assert.equal(feedbackProps.demonstration, true);
  assert.equal(feedbackProps.visitId, visitProps.record.id);
  const feedbackPanel = render(Feedback, feedbackProps, 'feedback');
  await nodes(feedbackPanel).find(item => item.type === 'button').props.onClick();
  assert.match(text(render(Feedback, feedbackProps, 'feedback')), /Demonstração/);
  const sold = properties.find(item => item.status === 'Vendido');
  assert.throws(() => applyCommand(createProductDemoVisitState(sold), productDemoVisitActor, {
    type: 'visit-start', caseId: 'demo-case-1', propertyId: sold.id, requestId: require('node:crypto').randomUUID(),
  }), /não está disponível/, 'demo uses real availability guard');
  console.log('Product demo visits passed: actual catalog fixture, existing matching client, start/finish, immutable links, duplicate submit, optional note and zero network.');
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
