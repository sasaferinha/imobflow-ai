const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

// Exercise the real component's events with an isolated provider. No Meta calls or spending.
function workspace({ integrated = true, failCreate = false } = {}) {
  const slots = [], effects = [], calls = [], draftStates = [];
  let cursor = 0, dirty = true, tree, selectedAccount = 'act_12345', sequence = 0, allowConfirmation = true;
  const account = id => ({ id, name: id === 'act_12345' ? 'Empresa A' : 'Empresa B', currency: 'BRL', account_status: 1 });
  const status = () => ({ available: true, connected: true, accountId: selectedAccount, accountName: account(selectedAccount).name, currency: 'BRL' });
  const campaigns = () => [{ id: selectedAccount === 'act_12345' ? '777' : '888', name: selectedAccount === 'act_12345' ? 'Apartamentos Centro' : 'Casas Jardim', status: 'PAUSED', objective: 'OUTCOME_TRAFFIC', daily_budget: '2000' }];
  const dependenciesChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || dependenciesChanged(slots[index].deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
    useEffect(callback, deps) { const index = cursor++; if (!slots[index] || dependenciesChanged(slots[index].deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = callback(); }); } },
    useId() { return hooks.useMemo(() => `test-${++sequence}`, []); },
  };
  hooks.useCallback = (callback, deps) => hooks.useMemo(() => callback, deps);
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../app/evolution/meta-ads-panel.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: mod, exports: mod.exports,
    require: name => name === 'react' ? hooks : name.endsWith('.css') ? { default: new Proxy({}, { get: (_, key) => key }) } : require(name),
    Date, Intl, URL, URLSearchParams, console, Error, Map, Set,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    window: { location: { search: '', href: '' }, confirm: () => allowConfirmation, addEventListener() {}, removeEventListener() {} },
    fetch: async (url, init) => {
      assert.match(url, /^\/api\/integrations\/meta\/ads(?:\?|$)/);
      const query = new URL(url, 'https://example.test').searchParams;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ query: query.toString(), body });
      let data;
      if (body?.action === 'select-account') { selectedAccount = body.accountId; data = {}; }
      else if (body?.action === 'create-campaign') {
        if (failCreate) return { ok: false, json: async () => ({ error: 'Não foi possível confirmar a criação.' }) };
        data = { campaign: { id: '999' } };
      } else if (body) throw Error(`Unexpected write: ${body.action}`);
      else if (query.get('action') === 'accounts') data = { accounts: [account('act_12345'), account('act_67890')] };
      else if (query.get('action') === 'metrics') data = { campaigns: campaigns(), insights: [], currency: 'BRL', since: query.get('since'), until: query.get('until') };
      else if (query.get('action') === 'pages') data = { pages: [{ id: '456', name: 'Página fictícia' }] };
      else if (query.get('action') === 'drafts') data = { drafts: [] };
      else if (query.get('action') === 'attribution') data = { since: query.get('since'), until: query.get('until'), trackedLeads: 0, untrackedLeads: 0, unattributedSales: 0, totalLeads: 0, rows: [] };
      else data = status();
      return { ok: true, json: async () => data };
    },
  });
  const onDraftState = state => draftStates.push(state);
  function render() { cursor = 0; dirty = false; tree = mod.exports.default({ integrated, standalone: true, onDraftState }); return tree; }
  async function settle() { for (let i = 0; i < 30; i++) { if (dirty) render(); while (effects.length) effects.shift()(); await new Promise(resolve => setImmediate(resolve)); if (!dirty && !effects.length && i > 3) break; } return tree; }
  function nodes(node = tree) { if (Array.isArray(node)) return node.filter(n => n != null).flatMap(n => nodes(n)); if (!React.isValidElement(node)) return []; return [node, ...(node.props.children == null ? [] : nodes(node.props.children))]; }
  function text(node = tree) { if (Array.isArray(node)) return node.filter(n => n != null).map(text).join(''); return React.isValidElement(node) ? (node.props.children == null ? '' : text(node.props.children)) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
  function one(predicate, label) { const matches = nodes().filter(predicate); assert.equal(matches.length, 1, `${label}: expected one element, found ${matches.length}`); return matches[0]; }
  function button(label) { return one(n => n.type === 'button' && text(n).trim() === label, label); }
  function disabled(node) { return Boolean(node.props.disabled || nodes().some(parent => parent.type === 'fieldset' && parent.props.disabled && nodes(parent).includes(node))); }
  async function click(label) { const node = button(label); assert.ok(!disabled(node), `${label} should be enabled`); await node.props.onClick?.(); await settle(); }
  function field(label) { const parent = one(n => n.type === 'label' && text(n).startsWith(label), label); return nodes(parent).find(n => ['input', 'select', 'textarea'].includes(n.type)); }
  async function change(label, value) { const node = field(label); assert.ok(node, label); await node.props.onChange({ target: { value, checked: value } }); await settle(); }
  async function submit(buttonLabel) { const target = button(buttonLabel); assert.ok(!disabled(target)); const form = one(n => n.type === 'form' && nodes(n).includes(target), `form ${buttonLabel}`); await form.props.onSubmit({ preventDefault() {} }); await settle(); }
  return { settle, text, nodes, button, field, click, change, submit, calls, draftStates, disabled, confirm: value => { allowConfirmation = value; }, externalAccount: value => { selectedAccount = value; } };
}

async function main() {
  const preview = workspace({ integrated: false });
  await preview.settle();
  assert.equal(preview.calls.length, 0, 'preview must not read or mutate the real account');
  assert(preview.disabled(preview.button('+ Nova campanha')));

  const ui = workspace();
  await ui.settle();
  assert.match(ui.text(), /Apartamentos Centro/);
  assert.match(ui.text(), /Pausada/);
  assert.equal(ui.calls.filter(call => call.body).length, 0, 'opening the workspace performs reads only');
  await ui.change('Buscar campanha por nome ou ID', 'não existe');
  assert.match(ui.text(), /Nenhuma campanha corresponde/);
  await ui.click('Limpar filtros');
  assert.match(ui.text(), /Apartamentos Centro/);
  const originalPeriod = ui.calls.find(call => call.query.startsWith('action=metrics')).query;
  await ui.change('De', '2026-10-01');
  assert.match(ui.text(), /Atualize para aplicar o novo período/);
  assert.equal(ui.calls.filter(call => call.query.startsWith('action=metrics')).length, 1, 'editing dates does not relabel or silently refetch the displayed report');
  await ui.submit('Atualizar métricas');
  assert.match(ui.text(), /01\/10\/2026/);
  assert.notEqual(ui.calls.filter(call => call.query.startsWith('action=metrics')).at(-1).query, originalPeriod);

  await ui.click('Criar campanha');
  await ui.change('Nome da campanha', 'Teste isolado');
  await ui.change('Orçamento diário (R$)', '20');
  await ui.click('Visão geral');
  await ui.click('Criar campanha');
  assert.equal(ui.field('Nome da campanha').props.value, 'Teste isolado', 'section navigation preserves the draft');
  assert.equal(ui.field('Orçamento diário (R$)').props.value, '20');
  await ui.submit('Criar campanha pausada');
  const creation = ui.calls.find(call => call.body?.action === 'create-campaign').body;
  assert.equal(creation.name, 'Teste isolado'); assert.equal(creation.dailyBudget, 20); assert.ok(creation.requestId);
  assert.equal(ui.calls.some(call => call.body?.action === 'update-campaign'), false, 'creating a campaign does not activate it');

  await ui.click('Visão geral');
  await ui.click('Gerenciar');
  assert(ui.disabled(ui.button('Ativar com este orçamento')));
  await ui.change('Confirmo ativar', true);
  assert(!ui.disabled(ui.button('Ativar com este orçamento')));
  await ui.change('Orçamento diário (BRL)', '30');
  assert(ui.disabled(ui.button('Ativar com este orçamento')), 'changing the budget invalidates approval');
  assert.equal(ui.draftStates.at(-1).dirty, true, 'budget edits are protected before the checkbox is selected');
  await ui.click('Conexão');
  await ui.change('Conta da imobiliária', 'act_67890');
  await ui.click('Visão geral');
  assert.match(ui.text(), /Casas Jardim/);
  assert.doesNotMatch(ui.text(), /Apartamentos Centro/);
  assert.equal(ui.nodes().some(node => node.type === 'button' && ui.text(node) === 'Ativar com este orçamento'), false, 'account switch clears the previous management selection');
  assert.equal(ui.calls.some(call => call.body?.action === 'update-campaign'), false);

  const external = workspace();
  await external.settle(); await external.click('Gerenciar');
  await external.click('Conexão'); external.externalAccount('act_67890');
  await external.click('Atualizar conexão'); await external.click('Visão geral');
  assert.match(external.text(), /Empresa B/);
  assert.doesNotMatch(external.text(), /Apartamentos Centro/, 'externally changed account cannot retain the previous account campaign data');
  assert.equal(external.nodes().some(node => node.type === 'button' && external.text(node) === 'Ativar com este orçamento'), false);

  const uncertain = workspace({ failCreate: true });
  await uncertain.settle(); await uncertain.click('Criar campanha');
  await uncertain.change('Nome da campanha', 'Falha simulada'); await uncertain.change('Orçamento diário (R$)', '20');
  await uncertain.submit('Criar campanha pausada');
  assert.match(uncertain.text(), /solicitação anterior precisa ser conferida/);
  assert(uncertain.disabled(uncertain.button('Criar campanha pausada')), 'uncertain creation cannot be submitted again accidentally');
  uncertain.confirm(false); await uncertain.click('Preparar outra solicitação');
  assert(uncertain.disabled(uncertain.button('Criar campanha pausada')));
  uncertain.confirm(true); await uncertain.click('Preparar outra solicitação');
  assert(!uncertain.disabled(uncertain.button('Criar campanha pausada')));
  assert.equal(uncertain.calls.filter(call => call.body?.action === 'create-campaign').length, 1, 'acknowledging recovery does not itself submit another campaign');
  console.log('PASS campaign workspace: read-only initialization, preview isolation, search, report period, preserved drafts, paused creation, budget reconfirmation, account reset and uncertain-creation recovery.');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { workspace };
