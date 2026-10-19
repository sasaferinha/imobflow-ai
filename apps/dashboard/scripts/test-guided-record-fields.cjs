const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const base = path.resolve(__dirname, '..');
const modules = new Map();
let state = [], cursor = 0;
const react = { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = value; }]; } };
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
function load(relative) {
  const file = path.resolve(base, relative);
  if (modules.has(file)) return modules.get(file);
  const mod = { exports: {} };
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  vm.runInNewContext(compiled.outputText, { module: mod, exports: mod.exports, require(request) {
    if (request === 'react') return react;
    if (request === 'react/jsx-runtime') return jsx;
    if (request.endsWith('.css')) return new Proxy({}, { get: (_, key) => String(key) });
    const target = request.startsWith('@/') ? request.slice(2) : path.relative(base, path.resolve(path.dirname(file), request));
    return load(`${target}${fs.existsSync(path.join(base, `${target}.tsx`)) ? '.tsx' : '.ts'}`);
  } }, { filename: file });
  modules.set(file, mod.exports);
  return mod.exports;
}
const helpers = load('lib/guided-record-fields.ts');
const component = load('app/guided-record-field.tsx').default;
const propertyFields = load('app/guided-property-fields.tsx').default;
const schema = load('lib/evolution/schema.ts');
const all = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(all)];
const render = props => { cursor = 0; return component(props); };
const reset = () => { state = []; };

assert.equal(helpers.toggleFeature('Elevador, Quintal com árvores; Piscina', 'Elevador', false), 'Quintal com árvores, Piscina');
assert.equal(helpers.toggleFeature('Quintal com árvores', 'Elevador', true), 'Quintal com árvores, Elevador');
assert.equal(helpers.featureSelected('suite; Piscina', 'Suíte'), true, 'accent-insensitive selections');
assert.equal(helpers.customFeatures('Elevador, Escritório independente', helpers.PROPERTY_FEATURE_CHOICES), 'Escritório independente');
assert.equal(helpers.replaceCustomFeatures('Elevador, Antigo', helpers.PROPERTY_FEATURE_CHOICES, 'Sauna, '), 'Elevador, Sauna, ', 'typing a trailing separator is preserved');
assert.equal(helpers.replaceCustomFeatures('Elevador, Piscina', helpers.PROPERTY_FEATURE_CHOICES, 'Piscin', 'Piscina'), 'Elevador, Piscin', 'editing typed text must not leave a ghost selected feature');

const fixture = [
  { kind: 'properties', data: { city: 'Cidade A', district: 'Centro A' } },
  { kind: 'properties', data: { city: 'Cidade B', district: 'Centro B' } },
  { kind: 'neighborhoods', data: { name: 'Bairro cadastrado', city: 'Cidade A' } },
  { kind: 'leads', data: { city: 'cidade a', region: 'Zona Sul' } },
  { kind: 'messages', data: { city: 'Não é localização', district: 'Mensagem privada' } },
];
assert.deepEqual([...helpers.locationSuggestions(fixture, 'city')], ['Cidade A', 'Cidade B']);
assert.deepEqual([...helpers.locationSuggestions(fixture, 'district', 'Cidade A')], ['Bairro cadastrado', 'Centro A']);
assert.equal(helpers.locationSuggestions([], 'city').length, 0, 'no city assumed for an empty tenant');

let value = '';
const props = { id: 'type', name: 'propertyType', label: 'Tipo', value, onChange(next) { value = next; }, mode: 'choices', options: helpers.PROPERTY_TYPE_CHOICES, allowCustom: true, required: true };
let tree = render(props);
assert.equal(all(tree).filter(node => node.type === 'input' && node.props.type === 'radio' && node.props.checked).length, 0, 'unknown type starts unselected');
assert.ok(all(tree).filter(node => node.props?.type === 'radio').every(node => node.props.required), 'required uses native radio validation');
all(tree).find(node => node.props?.value === 'Casa' && node.props.type === 'radio').props.onChange();
assert.equal(value, 'Casa');
tree = render({ ...props, value });
assert.equal(all(tree).find(node => node.props?.type === 'hidden').props.value, 'Casa');
all(tree).find(node => node.props?.value === '__custom').props.onChange();
assert.equal(value, '', 'selecting other does not silently keep a known type');
tree = render({ ...props, value });
all(tree).find(node => node.props?.id === 'type').props.onChange({ target: { value: 'Galpão industrial' } });
tree = render({ ...props, value });
assert.equal(all(tree).find(node => node.props?.name === 'propertyType').props.value, 'Galpão industrial', 'FormData canonical value is not the custom-radio sentinel');
reset();
tree = render({ ...props, value: 'Tipo antigo personalizado' });
assert.equal(all(tree).find(node => node.props?.id === 'type').props.value, 'Tipo antigo personalizado', 'legacy free-form type retained');
reset();
tree = render({ id: 'rooms', label: 'Quartos', value: '', onChange: next => { value = next; }, mode: 'count' });
assert.ok(all(tree).filter(node => node.type === 'button').every(node => !node.props['aria-pressed']), 'unknown count is not zero');
all(tree).find(node => node.props?.['aria-label'] === 'Quartos: 0').props.onClick();
assert.equal(value, '0', 'zero selected explicitly');
reset();
tree = render({ id: 'features', label: 'Comodidades', value: 'Piscina, Sauna particular', onChange: next => { value = next; }, mode: 'multi', options: helpers.PROPERTY_FEATURE_CHOICES, disabled: true });
assert.equal(tree.props.disabled, true, 'native fieldset disables all choices');
assert.equal(all(tree).find(node => node.props?.id === 'features').props.value, 'Sauna particular');
assert.equal(all(tree).filter(node => node.props?.type === 'checkbox' && node.props.checked).length, 1);

// Render the actual catalog wrapper and its controls without a browser or transport.
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') { reset(); cursor = 0; return expand(node.type(node.props)); }
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}
reset(); cursor = 0;
const catalog = expand(propertyFields({ property: { purpose: 'Venda', propertyType: 'Galpão', city: 'Cidade teste', district: 'Bairro teste', bedrooms: 0, parkingSpaces: 0, area: 40, price: 'R$ 250.000', status: 'Disponível' }, properties: [] }));
const catalogInputs = all(catalog).filter(node => node.type === 'input');
assert.equal(catalogInputs.filter(node => node.props.name === 'purpose').length, 1, 'one canonical purpose value');
assert.equal(catalogInputs.filter(node => node.props.name === 'propertyType').length, 1, 'one canonical property type value');
assert.equal(catalogInputs.find(node => node.props.name === 'propertyType').props.value, 'Galpão', 'custom type preserved by actual catalog wrapper');
assert.equal(catalogInputs.find(node => node.props.name === 'bedrooms').props.value, '0', 'zero bedrooms preserved');
assert.equal(catalogInputs.find(node => node.props.name === 'parkingSpaces').props.value, '0', 'zero parking spaces preserved');
assert.ok(catalogInputs.filter(node => ['city', 'district', 'bedrooms', 'parkingSpaces'].includes(node.props.name)).every(node => node.props.required));

for (const kind of ['leads', 'properties']) {
  assert.equal(schema.MODULES[kind].fields.find(field => field.key === 'propertyType').options, undefined, 'suggestions cannot become a closed server-side vocabulary');
  assert.equal(schema.MODULES[kind].fields.find(field => field.key === 'propertyType').required, undefined, 'partial intake remains allowed');
}
assert.equal(schema.MODULES.leads.fields.find(field => field.key === 'temperature').required, false, 'temperature is optional per commercial essentials decision');
const editor = fs.readFileSync(path.join(base, 'app/evolution/evolution-client.tsx'), 'utf8');
assert.match(editor, /locationSuggestions\(state\.records/);
assert.match(editor, /sectionFields\.every\(field => !fieldRequired\(field\)\)/, 'UI-required fields never hidden in optional disclosure');
assert.match(editor, /const creatingProperty = editor\.kind === 'properties' && !editor\.record/, 'extra UI essentials only apply to manual creation');
assert.match(editor, /creatingProperty && NEW_PROPERTY_FORM_ESSENTIALS\.some/, 'UI essentials supplement rather than rewrite shared schema');
assert.match(editor, /\['bedrooms', 'parkingSpaces'\]\.includes\(field\.key\) \? 'Características principais'/);
assert.match(editor, /min=\{creatingProperty && \['area', 'price'\]\.includes\(field\.key\) \? 0\.01 : field\.min\}/, 'new property area and price must be positive');
assert.deepEqual([...helpers.NEW_PROPERTY_FORM_ESSENTIALS], ['city', 'district', 'propertyType', 'area', 'description', 'bedrooms', 'parkingSpaces']);
assert.match(editor, /onInvalidCapture=.*currentTarget\.open = true/, 'invalid optional input opens its disclosure');
assert.match(editor, /assignmentFromConversation/);
assert.match(editor, /existingSourceLead \? \{ source: existingSourceLead\.data\.source/);
console.log('Guided CRM fields: selections, accessibility semantics, partial intake, custom values, form serialization, tenant-local suggestions and preserved links passed.');
