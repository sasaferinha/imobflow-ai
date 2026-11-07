const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const publicFile = 'app/website/public-site.tsx';
let networkCalls = 0;
function runtime(react = React, environment = {}) {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative);
    assert(file.startsWith(root + path.sep));
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    modules.set(file, module.exports);
    let source = fs.readFileSync(file, 'utf8');
    if (relative.replaceAll('\\', '/') === publicFile) source += '\nexport { SiteView, PropertyDialog };';
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, URL, console, Intl, structuredClone, AbortController,
      fetch: () => { networkCalls++; throw Error('Unexpected network request'); },
      require(id) {
        if (environment.dependencies && Object.hasOwn(environment.dependencies, id)) return environment.dependencies[id];
        if (id === 'react') return react;
        if (id === 'react/jsx-runtime') return require(id);
        if (id.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
        assert(id.startsWith('@/') || id.startsWith('.'), `Unexpected import ${id}`);
        const base = id.startsWith('@/') ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        const target = ['.ts', '.tsx'].map(ext => base + ext).find(fs.existsSync);
        assert(target, id);
        return load(path.relative(root, target));
      },
      ...environment,
    }, { filename: file });
    return module.exports;
  }
  return { load };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
function harness(exportName, initialProps, environment = {}, effectsEnabled = false) {
  const slots = [];
  let cursor = 0, tree, props = initialProps, effects = [];
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] || (slots[i] = { current: initial }); },
    useEffect(callback, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) { const previous = slots[i]; slots[i] = { deps }; if (effectsEnabled) effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = callback(); }); } },
  };
  const Component = runtime(hooks, environment).load(publicFile)[exportName];
  const render = update => { props = { ...props, ...update }; cursor = 0; effects = []; tree = Component(props); effects.forEach(run => run()); return tree; };
  render();
  return { render, get tree() { return tree; }, unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

async function main() {
  const modules = runtime();
  const demo = modules.load('lib/website/demo.ts');
  const model = modules.load('lib/website/model.ts');
  const publicUi = modules.load(publicFile);
  const demoUi = modules.load('app/modelo-imobiliaria/demo-client.tsx');
  model.validateSiteContent(demo.demoContent);
  const props = { content: structuredClone(demo.demoContent), properties: structuredClone(demo.demoProperties), companySlug: demo.DEMO_COMPANY.slug, demo: true };
  assert.equal(publicUi.filterPublicProperties(props.properties, { purpose: 'Aluguel', city: 'Lavras', query: 'APARTAMENTO' }).length, 1);
  assert.equal(publicUi.filterPublicProperties(props.properties, { purpose: '', city: '', query: 'refugio' }).length, 1, 'Text search is accent insensitive');
  assert.equal(publicUi.filterPublicProperties(props.properties, { purpose: 'Venda', city: '', query: 'HZ002' })[0].id, 'demo-apartamento-centro');
  assert.equal(publicUi.filterPublicProperties(props.properties, { purpose: 'Venda', city: 'Outra cidade', query: '' }).length, 0);

  const markup = renderToStaticMarkup(React.createElement(publicUi.default, props));
  assert(markup.includes('Modelo demonstrativo') && markup.includes('/modelo-imobiliaria/editor'));
  assert(markup.includes('R$') && markup.includes('HZ001') && markup.includes('À venda') && markup.includes('Para alugar'));
  assert(!markup.includes('<iframe'), 'Disabled video must not embed a provider');
  const malicious = structuredClone(props);
  malicious.content.video = { enabled: true, title: 'Teste', url: 'javascript:alert(1)' };
  malicious.content.promotion.linkUrl = 'javascript:alert(1)';
  malicious.content.logoUrl = 'data:image/svg+xml,<svg onload="alert(1)" />';
  const safeMarkup = renderToStaticMarkup(React.createElement(publicUi.default, malicious));
  assert(!safeMarkup.includes('javascript:') && !safeMarkup.includes('svg+xml') && !safeMarkup.includes('<iframe'), 'An unfinished/malicious preview cannot produce active content');
  const privatePrices = structuredClone(props); privatePrices.content.showPrices = false;
  const hiddenPrices = renderToStaticMarkup(React.createElement(publicUi.default, privatePrices));
  assert(!hiddenPrices.includes('1.280.000') && hiddenPrices.includes('Consulte o valor'));

  const view = harness('SiteView', props);
  const card = nodes(view.tree).find(node => node.type === 'button' && node.props['aria-label']?.startsWith('Ver detalhes:'));
  card.props.onClick(); view.render();
  assert(nodes(view.tree).some(node => typeof node.type === 'function' && node.type.name === 'PropertyDialog'));
  view.render({ properties: props.properties.slice(1) });
  assert(!nodes(view.tree).some(node => typeof node.type === 'function' && node.type.name === 'PropertyDialog'), 'A withdrawn property cannot remain open in a stale detail dialog');

  const inquiry = harness('PropertyDialog', { ...props, property: props.properties[0], preview: false, close() {} });
  await nodes(inquiry.tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  inquiry.render();
  assert(text(inquiry.tree).includes('Interesse simulado!'));
  assert.equal(networkCalls, 0, 'Demonstration and preview never contact a tenant or create a lead');
  let inquiryRequests = 0, finishInquiry;
  const liveInquiry = harness('PropertyDialog', { ...props, demo: false, property: props.properties[0], preview: false, close() {} }, {
    FormData: class { get(key) { return ({ name: 'Contato fictício', phone: '35999999999' })[key] || ''; } },
    fetch: async () => { inquiryRequests++; return new Promise(resolve => { finishInquiry = resolve; }); },
  });
  const sendInquiry = nodes(liveInquiry.tree).find(node => node.type === 'form').props.onSubmit;
  const firstSubmit = sendInquiry({ preventDefault() {}, currentTarget: {} });
  await sendInquiry({ preventDefault() {}, currentTarget: {} });
  assert.equal(inquiryRequests, 1, 'Repeated submit in the same event tick must not create duplicate contacts');
  liveInquiry.render();
  assert.equal(nodes(liveInquiry.tree).find(node => node.type === 'fieldset').props.disabled, true);
  finishInquiry({ ok: true, json: async () => ({ ok: true }) }); await firstSubmit; liveInquiry.render();
  assert(text(liveInquiry.tree).includes('Recebemos seu interesse!'));

  const draft = structuredClone(demo.createDemoWebsiteSnapshot());
  draft.site.draft.heroTitle = 'RASCUNHO NÃO PUBLICADO';
  draft.site.published.heroTitle = 'PUBLICAÇÃO CONFIRMADA';
  draft.properties[0].price = 999000;
  const published = demoUi.readDemoPublicState(JSON.stringify(draft));
  assert.equal(published.content.heroTitle, 'PUBLICAÇÃO CONFIRMADA');
  assert.equal(published.properties[0].price, 999000);
  draft.site.published = null;
  assert.equal(demoUi.readDemoPublicState(JSON.stringify(draft)).content, null, 'Unpublishing cannot silently revert to the original demo site');
  assert.equal(demoUi.readDemoPublicState('{invalid').content.brandName, demo.demoContent.brandName);
  const injected = structuredClone(demo.createDemoWebsiteSnapshot());
  injected.site.published.heroImageUrl = 'data:image/svg+xml,<svg onload=alert(1) />';
  assert.equal(demoUi.readDemoPublicState(JSON.stringify(injected)).content.heroImageUrl, '');
  injected.site.published.heroImageUrl = 'data:image/png;base64,AAAA';
  assert.equal(demoUi.readDemoPublicState(JSON.stringify(injected)).content.heroImageUrl, 'data:image/png;base64,AAAA');
  delete injected.properties[0].features;
  delete injected.properties[0].description;
  const normalized = demoUi.readDemoPublicState(JSON.stringify(injected)).properties[0];
  assert.equal(normalized.features, ''); assert.equal(normalized.description, '');
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(publicUi.PropertyDialog, { ...props, property: normalized, close() {} })), 'Partial demo records must not crash details');

  let hasPublication = true;
  const Landing = () => React.createElement('div', {}, 'LEGACY CONTACT FORM');
  const page = runtime(React, { dependencies: {
    '@/lib/website/server': { getPublicWebsite: async () => null, hasWebsitePublication: async () => hasPublication },
    '@/lib/public-company': { publicCompany: async () => ({ id: demo.DEMO_COMPANY.id, name: demo.DEMO_COMPANY.name, slug: demo.DEMO_COMPANY.slug }) },
    'next/navigation': { notFound() { throw Error('404'); } },
    '../../landing-client': { __esModule: true, default: Landing },
  } }).load('app/imobiliaria/[slug]/page.tsx');
  const pageProps = { params: Promise.resolve({ slug: demo.DEMO_COMPANY.slug }) };
  const closedMarkup = renderToStaticMarkup(await page.default(pageProps));
  assert(closedMarkup.includes('Site temporariamente indisponível') && !closedMarkup.includes('LEGACY CONTACT FORM'), 'Withdrawing a published site also removes its old public contact page');
  assert.equal((await page.generateMetadata(pageProps)).robots.index, false);
  hasPublication = false;
  assert.equal(renderToStaticMarkup(await page.default(pageProps)), '<div>LEGACY CONTACT FORM</div>', 'A tenant that never published retains its previous contact page');

  let visibility, interval, cleared = false, requests = 0;
  let response = { ok: true, status: 200, json: async () => ({ content: props.content, properties: props.properties.slice(1) }) };
  const real = harness('default', { ...props, demo: false }, {
    fetch: async () => { requests++; return response; },
    document: { visibilityState: 'visible', addEventListener(_name, callback) { visibility = callback; }, removeEventListener() { visibility = null; } },
    window: { setInterval(callback, duration) { assert.equal(duration, 60000); interval = callback; return 1; }, clearInterval() { cleared = true; } },
  }, true);
  await new Promise(resolve => setImmediate(resolve)); real.render();
  assert.equal(real.tree.props.properties.length, 3, 'A mounted real site refreshes its available catalogue');
  response = { ok: false, status: 503 }; interval();
  await new Promise(resolve => setImmediate(resolve)); real.render();
  assert.equal(real.tree.props.properties.length, 3, 'Transient errors preserve the last confirmed catalogue');
  real.render({ companySlug: 'another-company', content: { ...props.content, brandName: 'Outra imobiliária' }, properties: [] });
  assert.equal(real.tree.props.content.brandName, 'Outra imobiliária');
  assert.equal(real.tree.props.properties.length, 0, 'Changing tenants cannot reuse the previous catalogue while its refresh is pending');
  real.render({ companySlug: props.companySlug, content: props.content, properties: props.properties });
  response = { ok: false, status: 404 }; visibility();
  await new Promise(resolve => setImmediate(resolve)); real.render();
  assert(text(real.tree).includes('Site temporariamente indisponível'));
  assert(!text(real.tree).includes('HZ001'), 'A withdrawn site must no longer show its cached catalogue');
  real.unmount(); assert(cleared && !visibility && requests >= 3);
  console.log('PASS website public UI: filtered catalogue, safe preview, hidden prices, dialog withdrawal, demo isolation, published-only demo storage, image filtering, live refresh, unpublish and cleanup.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
