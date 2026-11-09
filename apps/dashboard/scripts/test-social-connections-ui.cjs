const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

const root = path.resolve(__dirname, '..');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim() === label);
const select = tree => find(find(tree, node => node.type === 'fieldset'), node => node.type === 'select');
const tick = () => new Promise(resolve => setImmediate(resolve));
const status = { available: true, webhookConfigured: true, authorized: true, accounts: [] };
const page = { id: '123', name: 'Imobiliária de teste', instagramId: null, instagramName: null };
const response = (body, ok = true) => ({ ok, json: async () => body });

function harness(fetch) {
  const slots = [], redirects = [];
  let cursor = 0, tree;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); },
  };
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'app/social-connections.tsx'), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, URL, fetch, window: { location: { assign: url => redirects.push(url) }, confirm: () => true }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw Error(`Unexpected dependency ${name}`);
  } });
  function render() { cursor = 0; tree = mod.exports.default(); return tree; }
  render();
  return { render, redirects, get tree() { return tree; }, async settle() { await tick(); return render(); } };
}

(async () => {
  const requests = [];
  let pendingOAuth;
  const h = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    requests.push({ url, body });
    if (body?.action === 'connect') return new Promise(resolve => { pendingOAuth = resolve; });
    return response(status);
  });
  h.tree.props.onToggle({ currentTarget: { open: true } }); await h.settle();
  button(h.tree, 'Conectar Facebook').props.onClick();
  button(h.tree, 'Conectar Instagram').props.onClick();
  h.render();
  assert.equal(requests.length, 2, 'one initial read and one authorization; concurrent buttons cannot replace the OAuth state');
  assert.deepEqual(requests[1].body, { action: 'connect', channel: 'facebook' });
  pendingOAuth(response({ url: 'https://www.facebook.com/v26.0/dialog/oauth?state=synthetic-facebook' })); await h.settle();
  assert.equal(h.redirects.length, 1);
  button(h.tree, 'Conectar Instagram').props.onClick();
  assert.deepEqual(requests.at(-1).body, { action: 'connect', channel: 'instagram' });
  pendingOAuth(response({ url: 'https://example.org/not-meta' })); await h.settle();
  assert.equal(h.redirects.length, 1, 'redirect validation still rejects other origins');
  assert.match(text(h.tree), /Endereço de autorização inválido/);

  const selections = [];
  let instagramDenied = false;
  const connected = { ...status, accounts: [{ id: 'account-fb', channel: 'facebook', name: page.name, enabled: true, defaultMode: 'human' }] };
  const chooser = harness(async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    selections.push({ url, body });
    if (url.includes('action=pages')) {
      if (url.includes('channel=instagram') && instagramDenied) return response({ error: 'Autorize o Instagram para escolher essa conta.' }, false);
      return response({ ...connected, pages: [{ ...page, ...(url.includes('channel=instagram') ? { instagramId: '456', instagramName: 'teste' } : {}) }] });
    }
    return response(connected);
  });
  chooser.tree.props.onToggle({ currentTarget: { open: true } }); await chooser.settle();
  button(chooser.tree, 'Escolher Página do Facebook').props.onClick(); await chooser.settle();
  assert.match(selections.at(-1).url, /action=pages&channel=facebook$/);
  select(chooser.tree).props.onChange({ target: { value: page.id } }); chooser.render();
  assert.equal(button(chooser.tree, 'Usar esta Página no Facebook').props.disabled, false, 'Facebook does not require an Instagram account');
  assert.equal(nodes(chooser.tree).filter(node => node.type === 'input' && node.props.type === 'checkbox').length, 0, 'no hidden/preselected Instagram choice');
  button(chooser.tree, 'Escolher Página do Facebook').props.onClick(); await chooser.settle();
  assert.equal(select(chooser.tree).props.value, page.id, 'refreshing the same channel preserves a valid Page selection');
  button(chooser.tree, 'Usar esta Página no Facebook').props.onClick(); await chooser.settle();
  assert.deepEqual(selections.at(-1).body, { action: 'select-page', pageId: page.id, channels: ['facebook'] });
  assert.equal(find(chooser.tree, node => node.type === 'fieldset'), undefined, 'confirmed connection closes the picker');

  button(chooser.tree, 'Escolher Página do Facebook').props.onClick(); await chooser.settle();
  select(chooser.tree).props.onChange({ target: { value: page.id } }); chooser.render();
  button(chooser.tree, 'Escolher conta do Instagram').props.onClick(); await chooser.settle();
  assert.match(selections.at(-1).url, /action=pages&channel=instagram$/);
  assert.equal(select(chooser.tree).props.value, '', 'switching channel never carries over a selected Facebook Page');
  assert.equal(button(chooser.tree, 'Usar esta Página no Instagram').props.disabled, true);
  select(chooser.tree).props.onChange({ target: { value: page.id } }); chooser.render();
  button(chooser.tree, 'Usar esta Página no Instagram').props.onClick(); await chooser.settle();
  assert.deepEqual(selections.at(-1).body, { action: 'select-page', pageId: page.id, channels: ['instagram'] });

  instagramDenied = true;
  button(chooser.tree, 'Escolher conta do Instagram').props.onClick(); await chooser.settle();
  assert.equal(find(chooser.tree, node => node.type === 'fieldset'), undefined);
  assert.match(text(chooser.tree), /Autorize o Instagram/);
  assert.ok(button(chooser.tree, 'Reconectar Facebook'), 'Instagram error preserves the existing Facebook connection');
  button(chooser.tree, 'Escolher Página do Facebook').props.onClick(); await chooser.settle();
  assert.ok(select(chooser.tree), 'Facebook remains usable after an Instagram authorization failure');
  const mode = find(find(chooser.tree, node => node.type === 'label' && text(node).startsWith('Novos atendimentos')), node => node.type === 'select');
  mode.props.onChange({ target: { value: 'suggestions' } }); await chooser.settle();
  assert.deepEqual(selections.at(-1).body, { action: 'mode', channel: 'facebook', mode: 'suggestions' });
  assert.ok(select(chooser.tree), 'changing the attendance preference preserves the Page picker');
  console.log('PASS social connection UI: independent channel OAuth, in-flight guard, Facebook without Instagram, isolated Page selection, failed Instagram recovery and preserved attendance controls.');
})().catch(error => { console.error(error); process.exit(1); });
