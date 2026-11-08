const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const editorFile = 'app/website/site-editor.tsx';
const demoFile = 'app/modelo-imobiliaria/editor/demo-editor.tsx';
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function runtime(react = React, globals = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (modules.has(file)) return modules.get(file);
    const mod = { exports: {} }; modules.set(file, mod.exports);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(compiled, { module: mod, exports: mod.exports, structuredClone, URL, Date, JSON, console, Error, FormData, requestAnimationFrame: callback => callback(), fetch: () => { throw Error('Network not authorized in UI test'); }, require(id) {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === './public-site') return { __esModule: true, default: props => React.createElement('main', { 'data-preview': props.preview }, props.content.heroTitle) };
      if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) };
      const target = id.startsWith('@/') ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const resolved = ['.ts', '.tsx'].map(extension => target + extension).find(candidate => fs.existsSync(candidate));
      assert(resolved && resolved.startsWith(root + path.sep), `Allowed local module: ${id}`);
      return load(path.relative(root, resolved));
    }, ...globals }, { filename: file });
    modules.set(file, mod.exports); return mod.exports;
  }
  return { load };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const find = (tree, predicate) => nodes(tree).find(predicate);
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node).trim() === label);
const field = (tree, label) => find(find(tree, node => node.type === 'label' && text(node).startsWith(label)), node => ['input', 'textarea'].includes(node.type));
function harness(initial, supplied = {}) {
  const slots = [], events = new Map(), commands = [];
  let cursor = 0, effects = [], tree, props, pending = false, confirm = true;
  const different = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const hooks = { ...React,
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof value === 'function' ? value() : value }; return [slots[index].value, update => { slots[index].value = typeof update === 'function' ? update(slots[index].value) : update; pending = true; }]; },
    useRef(value) { const index = cursor++; return slots[index] || (slots[index] = { current: value }); },
    useMemo(create, deps) { const index = cursor++; if (!(index in slots) || different(slots[index].deps, deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
    useEffect(effect, deps) { const index = cursor++; if (!(index in slots) || different(slots[index].deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const env = runtime(hooks, { window: { confirm: () => confirm, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } }, ...(supplied.globals || {}) });
  const api = env.load(supplied.moduleFile || editorFile);
  const transform = env.load(demoFile).applyDemoWebsiteMutation;
  let saved = structuredClone(initial);
  const transport = { load: async () => structuredClone(saved), mutate: async command => { commands.push(command); if (supplied.mutate) return supplied.mutate(command, api); saved = transform(saved, command); return saved; }, upload: async () => '/test.png' };
  props = { initial, transport, ...supplied.props };
  function render() { let passes = 0; do { pending = false; cursor = 0; effects = []; tree = api[supplied.exportName || 'default'](props); effects.forEach(effect => effect()); assert(++passes < 20); } while (pending); return tree; }
  render();
  return { api, commands, events, render, get tree() { return tree; }, get saved() { return structuredClone(saved); }, setSaved(value) { saved = value; }, confirm(value) { confirm = value; },
    change(label, value) { const input = field(tree, label); assert(input, label); input.props.onChange({ target: { value } }); render(); },
    click(label) { const target = button(tree, label); assert(target, label); target.props.onClick(); render(); },
    chooseLayout(value) { const radio = find(tree, node => node.type === 'input' && node.props.type === 'radio' && node.props.name === 'site-layout' && node.props.value === value); assert(radio, `Layout ${value}`); radio.props.onChange(); render(); },
  };
}
async function run() {
  // Generic editor control styles used to override the embedded site's hidden
  // desktop menu and button geometry. Assert the preview boundary for every
  // generic editor descendant rule, including hover, disabled and focus states.
  const editorCss = fs.readFileSync(path.join(root, 'app/website/site-editor.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const cssRules = [...editorCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selectors: match[1].split(',').map(selector => selector.trim()), declarations: match[2] }));
  const editorDescendants = cssRules.flatMap(rule => rule.selectors.filter(selector => /^\.editor\s+(?:button|\*|:focus-visible)/.test(selector)).map(selector => ({ selector, declarations: rule.declarations })));
  assert(editorDescendants.length >= 6, 'Editor base, hover, disabled and focus styling remains present');
  for (const { selector } of editorDescendants) assert(selector.includes(':where(:not(.preview *))'), `Editor styling must not leak into the public preview: ${selector}`);
  assert(editorDescendants.some(rule => /^\.editor button:where\(:not\(\.preview \*\)\)$/.test(rule.selector) && /display\s*:\s*inline-flex/.test(rule.declarations)), 'Editor controls retain their layout outside the preview');
  const pure = runtime();
  const model = pure.load('lib/website/model.ts');
  const demo = pure.load(demoFile);
  const api = pure.load(editorFile);
  const initial = demo.initialDemoSnapshot();
  const draft = { ...initial.site.draft, heroTitle: 'Título ainda em rascunho' };
  const saved = demo.applyDemoWebsiteMutation(initial, { action: 'save', expectedVersion: 0, content: draft });
  assert.equal(saved.site.draft.heroTitle, draft.heroTitle);
  assert.equal(saved.site.published.heroTitle, initial.site.published.heroTitle, 'Saving a draft must not publish it');
  assert.throws(() => demo.applyDemoWebsiteMutation(saved, { action: 'publish', expectedVersion: 0, content: draft }), error => error.status === 409);
  const published = demo.applyDemoWebsiteMutation(saved, { action: 'publish', expectedVersion: 1, content: draft });
  assert.equal(published.site.published.heroTitle, draft.heroTitle);
  assert.equal(published.site.previous.heroTitle, initial.site.published.heroTitle);
  const restored = demo.applyDemoWebsiteMutation(published, { action: 'restore', expectedVersion: 2 });
  assert.equal(restored.site.published.heroTitle, initial.site.published.heroTitle);
  assert.deepEqual(restored.properties, initial.properties, 'Restoring content cannot modify stock');
  const offline = demo.applyDemoWebsiteMutation(restored, { action: 'unpublish', expectedVersion: 3 });
  assert.equal(offline.site.published, null);
  assert(offline.site.draft.heroTitle && offline.properties.length, 'Unpublishing preserves content and stock');
  assert.equal(initial.site.version, 0, 'Mutation does not mutate caller input');
  assert.throws(() => api.validatedEditorContent({ ...draft, logoUrl: 'javascript:alert(1)' }, true));
  assert.throws(() => api.validatedEditorContent({ ...draft, logoUrl: 'data:image/svg+xml;base64,AAAA' }, true));
  assert.throws(() => api.validatedEditorContent({ ...draft, logoUrl: 'data:image/png;base64,AAAA' }, false));
  assert.equal(api.validatedEditorContent({ ...draft, logoUrl: 'data:image/png;base64,AAAA' }, true).logoUrl, 'data:image/png;base64,AAAA');
  assert.throws(() => model.validateSiteContent({ ...draft, video: { enabled: true, title: 'Vídeo', url: '' } }));
  const damagedProperty = { ...initial.properties[0], features: undefined, area: undefined, description: undefined, images: ['javascript:alert(1)'] };
  const restoredStorage = runtime(React, { localStorage: { getItem: () => JSON.stringify({ site: initial.site, properties: [damagedProperty] }) } }).load(demoFile).readDemo();
  assert.equal(restoredStorage.snapshot.properties[0].features, '');
  assert.equal(restoredStorage.snapshot.properties[0].area, 0);
  assert.equal(restoredStorage.snapshot.properties[0].description, '');
  assert.equal(restoredStorage.snapshot.properties[0].images.length, 0, 'Restored browser state is normalized before preview rendering');
  const legacy = structuredClone(initial);
  legacy.site.draft.heroTitle = 'Título personalizado antes dos modelos';
  legacy.site.draft.logoUrl = '/logo-personalizado.png';
  legacy.site.draft.heroImageUrl = '/capa-personalizada.webp';
  legacy.site.draft.promotion.title = 'Campanha já configurada';
  legacy.site.draft.video = { enabled: true, title: 'Vídeo já configurado', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
  legacy.site.published = structuredClone(legacy.site.draft);
  legacy.site.previous = structuredClone(initial.site.draft);
  for (const content of [legacy.site.draft, legacy.site.published, legacy.site.previous]) delete content.layout;
  const legacyPayload = { site: legacy.site, properties: legacy.properties.slice(1), unavailable: [legacy.properties[0]] };
  const migrated = runtime(React, { localStorage: { getItem: () => JSON.stringify(legacyPayload) } }).load(demoFile).readDemo();
  for (const content of [migrated.snapshot.site.draft, migrated.snapshot.site.published, migrated.snapshot.site.previous]) assert.equal(content.layout, 'classic');
  for (const key of ['draft', 'published', 'previous']) assert.deepEqual(plain(migrated.snapshot.site[key]), { ...plain(legacy.site[key]), layout: 'classic' }, `Legacy ${key} receives only the classic layout default`);
  assert.equal(migrated.snapshot.site.published.heroTitle, legacy.site.published.heroTitle);
  assert.deepEqual(plain(migrated.snapshot.site.published.promotion), plain(legacy.site.published.promotion));
  assert.deepEqual(plain(migrated.snapshot.site.published.video), plain(legacy.site.published.video));
  assert.deepEqual(plain(migrated.snapshot.properties), plain(legacyPayload.properties));
  assert.deepEqual(plain(migrated.unavailable), plain(legacyPayload.unavailable), 'A sold demo property is not restored when older content gains a layout default');

  let demoStorage = JSON.stringify(legacyPayload), demoWrites = 0;
  const demoWrapper = harness(initial, { moduleFile: demoFile, globals: {
    localStorage: { getItem: () => demoStorage, setItem: (_key, value) => { demoStorage = value; demoWrites++; } },
    window: { dispatchEvent() {} }, Event,
  } });
  const demoEditorProps = demoWrapper.tree.props;
  assert.equal(demoWrapper.tree.type.name, 'SiteEditor', 'Demo uses the shared editor with no separate stock-mutation panel');
  assert(demoEditorProps.demo);
  assert.equal(demoWrites, 0, 'Opening the demo must not reset or overwrite saved contents');
  const demoMarkup = renderToStaticMarkup(React.createElement(api.default, demoEditorProps));
  assert(demoMarkup.includes('somente para consulta'));
  for (const removed of ['Atualizar preço', 'Marcar vendido', 'Voltar a disponibilizar', 'Cadastrar imóvel fictício', 'Reiniciar demonstração']) assert(!demoMarkup.includes(removed), `Demo catalog has no mutation control: ${removed}`);
  await demoEditorProps.transport.mutate({ action: 'save', expectedVersion: migrated.snapshot.site.version, content: { ...migrated.snapshot.site.draft, heroTitle: 'Conteúdo novo, catálogo preservado' } });
  const demoAfterSave = JSON.parse(demoStorage);
  assert.equal(demoWrites, 1);
  assert.deepEqual(demoAfterSave.properties, plain(legacyPayload.properties));
  assert.deepEqual(demoAfterSave.unavailable, plain(legacyPayload.unavailable));
  assert.equal(demoAfterSave.site.published.heroTitle, legacyPayload.site.published.heroTitle, 'Saving the read-only catalog demo still changes only the draft');

  const ownerMarkup = renderToStaticMarkup(React.createElement(api.default, { initial }));
  const marketingMarkup = renderToStaticMarkup(React.createElement(api.default, { initial: { ...initial, role: 'marketing' } }));
  assert(ownerMarkup.includes('Acesso da equipe de marketing'));
  assert(ownerMarkup.includes('Domínio próprio'));
  assert(!marketingMarkup.includes('Domínio próprio'), 'Marketing cannot manage domain ownership');
  assert(!marketingMarkup.includes('Acesso da equipe de marketing') && !marketingMarkup.includes('Gerenciar imóveis'), 'Marketing does not receive CRM controls or access management');
  assert(marketingMarkup.includes('Sair do editor'));
  assert(ownerMarkup.includes('Seções do editor') && ownerMarkup.includes('Publicação e histórico'));
  for (const markup of [ownerMarkup, marketingMarkup]) {
    assert.equal((markup.match(/type="radio"/g) || []).length, 3);
    for (const name of ['Clássico', 'Moderno', 'Vitrine']) assert(markup.includes(`aria-label="${name}"`), `${name} is an accessible native radio option`);
  }

  const layouts = harness(initial);
  assert(find(layouts.tree, node => node.props?.preview === true), 'Desktop preview is mounted immediately alongside the editor');
  assert(find(layouts.tree, node => node.type === 'form' && node.props.className === 'form'), 'Form and preview coexist in the editor');
  layouts.change('Título principal', 'Rascunho em andamento');
  layouts.chooseLayout('modern');
  assert.equal(find(layouts.tree, node => node.props?.preview === true).props.content.heroTitle, 'Rascunho em andamento', 'Typing updates the live preview before saving');
  assert.equal(find(layouts.tree, node => node.props?.preview === true).props.content.layout, 'modern', 'Model selection updates the live preview immediately');
  assert.equal(layouts.commands.length, 0, 'Choosing a model neither saves nor publishes automatically');
  assert.equal(field(layouts.tree, 'Título principal').props.value, 'Rascunho em andamento', 'Choosing a model preserves current unsaved edits');
  layouts.click('Salvar rascunho'); await tick(); layouts.render();
  assert.deepEqual(plain(layouts.commands[0].content), plain({ ...initial.site.draft, heroTitle: 'Rascunho em andamento', layout: 'modern' }), 'Model selection changes only layout and preserves brand, media, campaigns and contact');
  assert.equal(layouts.saved.site.draft.layout, 'modern');
  assert.equal(layouts.saved.site.published.layout, 'classic', 'A saved model stays unpublished until publication');
  layouts.click('Recarregar dados'); await tick(); layouts.render();
  assert(find(layouts.tree, node => node.type === 'input' && node.props.value === 'modern' && node.props.checked), 'Reload retains the saved model');
  layouts.click('Ver prévia');
  const layoutPreview = find(layouts.tree, node => node.props?.preview === true);
  assert(layoutPreview && layoutPreview.props.content.layout === 'modern', 'Preview receives the selected layout');
  assert.deepEqual(layoutPreview.props.properties, initial.properties);
  layouts.click('Voltar à edição');
  layouts.click('Publicar alterações'); await tick(); layouts.render();
  assert.equal(layouts.saved.site.published.layout, 'modern');
  assert.equal(layouts.saved.site.previous.layout, 'classic');
  layouts.chooseLayout('catalog'); layouts.click('Publicar alterações'); await tick(); layouts.render();
  assert.equal(layouts.saved.site.published.layout, 'catalog');
  layouts.click('Restaurar publicação anterior'); await tick(); layouts.render();
  assert.equal(layouts.saved.site.published.layout, 'modern');
  assert.deepEqual(layouts.saved.properties, initial.properties, 'Changing and restoring a model never modifies the catalogue');
  for (const configuration of [{ role: 'marketing', demo: false }, { role: 'owner', demo: true }]) {
    const scoped = harness({ ...initial, role: configuration.role }, { props: { demo: configuration.demo } });
    scoped.chooseLayout('catalog'); scoped.click('Salvar rascunho'); await tick(); scoped.render();
    assert.equal(scoped.commands[0].content.layout, 'catalog', 'Marketing and demonstration use the same model picker');
    assert.deepEqual(plain(scoped.commands[0].content), plain({ ...initial.site.draft, layout: 'catalog' }));
  }

  const ui = harness(initial);
  assert(button(ui.tree, 'Salvar rascunho').props.disabled);
  ui.change('Título principal', 'Novo título pela interface');
  assert(!button(ui.tree, 'Salvar rascunho').props.disabled);
  const unload = { prevented: false, preventDefault() { this.prevented = true; } };
  ui.events.get('beforeunload')(unload); assert(unload.prevented, 'Unsaved changes warn on closing the tab');
  ui.click('Salvar rascunho'); await tick(); ui.render();
  assert.equal(ui.commands[0].action, 'save'); assert.equal(ui.commands[0].content.heroTitle, 'Novo título pela interface');
  assert(button(ui.tree, 'Salvar rascunho').props.disabled);
  assert(text(ui.tree).includes('Rascunho salvo. O site publicado continua como estava.'));
  ui.click('Publicar alterações'); await tick(); ui.render();
  assert.equal(ui.commands[1].expectedVersion, 1); assert.equal(ui.commands[1].action, 'publish');
  assert(text(ui.tree).includes('Site publicado. As alterações já estão disponíveis.'));

  const conflict = harness(initial, { mutate: async (_command, module) => { throw new module.WebsiteRequestError('Alterado por outra pessoa.', 409); } });
  conflict.change('Nome da imobiliária', 'Meu rascunho preservado');
  conflict.chooseLayout('catalog');
  conflict.click('Publicar alterações'); await tick(); conflict.render();
  assert.equal(field(conflict.tree, 'Nome da imobiliária').props.value, 'Meu rascunho preservado');
  assert(find(conflict.tree, node => node.type === 'input' && node.props.value === 'catalog' && node.props.checked), 'CAS conflict retains the unsaved model choice');
  assert(button(conflict.tree, 'Publicar alterações').props.disabled);
  assert(button(conflict.tree, 'Carregar versão atual'));
  conflict.confirm(false); conflict.click('Carregar versão atual'); await tick(); conflict.render();
  assert.equal(field(conflict.tree, 'Nome da imobiliária').props.value, 'Meu rascunho preservado');
  conflict.confirm(true); conflict.click('Carregar versão atual'); await tick(); conflict.render();
  assert.equal(field(conflict.tree, 'Nome da imobiliária').props.value, initial.site.draft.brandName);

  let finish;
  const slow = harness(initial, { mutate: command => new Promise(resolve => { finish = () => resolve(demo.applyDemoWebsiteMutation(initial, command)); }) });
  slow.change('Nome da imobiliária', 'Dois cliques');
  slow.click('Publicar alterações');
  const waiting = button(slow.tree, 'Aguarde…'); waiting.props.onClick();
  assert.equal(slow.commands.length, 1, 'Synchronous ref prevents duplicate mutations');
  finish(); await tick(); slow.render();

  const invalid = harness(initial);
  invalid.change('Nome da imobiliária', '');
  invalid.change('Título principal', '');
  invalid.click('Ver prévia');
  assert(!find(invalid.tree, node => node.props?.role === 'alert'), 'Opening the small-screen preview does not validate an unfinished draft');
  assert.equal(find(invalid.tree, node => node.props?.preview === true).props.content.heroTitle, '', 'Incomplete draft text reaches the preview without replacing the actual draft');
  invalid.click('Voltar à edição');
  assert.equal(field(invalid.tree, 'Nome da imobiliária').props.value, '', 'Switching views preserves incomplete edits');
  invalid.click('Publicar alterações'); await tick(); invalid.render();
  assert.equal(invalid.commands.length, 0, 'Invalid content never reaches a transport');
  assert(find(invalid.tree, node => node.props?.role === 'alert'));

  const PublicSite = pure.load('app/website/public-site.tsx').default;
  for (const layout of ['classic', 'modern', 'catalog']) {
    const unfinished = { ...initial.site.draft, layout, brandName: '', heroTitle: '', primaryColor: '#', logoUrl: 'javascript:alert(1)', heroImageUrl: 'https://', instagramUrl: 'javascript:alert(2)', promotion: { ...initial.site.draft.promotion, enabled: true, title: '', imageUrl: 'javascript:alert(3)', linkUrl: 'javascript:alert(4)' }, video: { enabled: true, title: '', url: 'https://www.youtube.com/watch?v=' } };
    const previewMarkup = renderToStaticMarkup(React.createElement(PublicSite, { content: unfinished, properties: initial.properties, companySlug: initial.company.slug, preview: true }));
    assert(previewMarkup.includes(`data-site-layout="${layout}"`), 'Every model safely renders an unfinished draft');
    assert(!previewMarkup.includes('javascript:') && !previewMarkup.includes('<iframe'), 'Incomplete or unsafe URLs never become executable preview content');
    assert.equal(unfinished.primaryColor, '#', 'Preview fallbacks never mutate the user’s partial input');
  }

  const requests = [];
  const transportRuntime = runtime(React, { fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => url.includes('/media') ? { url: '/logo.png' } : initial }; } });
  const marketing = transportRuntime.load(editorFile).websiteTransport(true);
  await marketing.load(); await marketing.mutate({ action: 'save', expectedVersion: 0, content: draft }); await marketing.upload('data:image/png;base64,AAAA');
  assert.deepEqual(requests.map(r => r.url), ['/api/website?access=marketing', '/api/website?access=marketing', '/api/website/media?access=marketing']);
  assert(requests.every(r => r.options.credentials === 'same-origin'), 'Marketing mode is explicit even when an owner cookie also exists');
  const resetRequests = [], account = { id: 'synthetic-marketing', name: 'Marketing sintético', email: 'marketing@example.org', active: true };
  let passwordCleared = false;
  const access = harness(initial, { exportName: 'MarketingAccess', props: { accounts: [account], locked: false, onChange() {} }, globals: {
    FormData: class { constructor(form) { this.form = form; } get(name) { return this.form[name]; } },
    fetch: async (url, options) => { resetRequests.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ marketingAccounts: [account] }) }; },
  } });
  access.click('Nova senha');
  const resetForm = find(access.tree, node => node.type === 'form' && node.props['aria-label'] === 'Nova senha para Marketing sintético');
  assert(resetForm && field(resetForm, 'Nova senha').props.type === 'password');
  resetForm.props.onSubmit({ preventDefault() {}, currentTarget: { password: 'synthetic-passphrase', reset() { passwordCleared = true; } } });
  await tick(); access.render();
  assert.equal(resetRequests.length, 1);
  assert.equal(resetRequests[0].url, '/api/website/access');
  assert.deepEqual(resetRequests[0].body, { action: 'reset-password', id: account.id, password: 'synthetic-passphrase' });
  assert(passwordCleared && text(access.tree).includes('As sessões anteriores dessa pessoa foram encerradas.'));
  assert(!find(access.tree, node => node.props?.['aria-label'] === 'Nova senha para Marketing sintético'), 'Reset password is unmounted after success');
  console.log('PASS website editor: simultaneous live draft preview, safe incomplete previews in all models, read-only demo catalog and legacy preservation, accessible model selection, save/publish/rollback, CAS conflict preservation, role-limited controls, dirty guard, duplicate-submit prevention, media validation, explicit marketing transport, and owner password reset.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
