const assert = require('node:assert/strict');
const { renderToStaticMarkup } = require('react-dom/server');
const { navigationHarness, find, text, click, owner, state, runtime } = require('./test-evolution-navigation.cjs');
const { filterCases } = runtime().load('lib/evolution/model.ts');
const { NEGOTIATION_STAGES, CAPTURE_STAGES } = runtime().load('lib/evolution/schema.ts');

const byLabel = (nav, label) => find(nav.tree, node => node.props?.['aria-label'] === label);
const all = (node, predicate) => !node ? [] : Array.isArray(node) ? node.flatMap(child => all(child, predicate)) : typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
const cards = nav => all(nav.tree, node => node.props?.className === 'attendanceCard');
const snapshot = JSON.stringify(state);

for (const purpose of ['Venda', 'Aluguel']) for (const journey of ['Negociação', 'Captação']) {
  const stages = journey === 'Captação' ? CAPTURE_STAGES : NEGOTIATION_STAGES;
  for (const stage of stages) {
    const nav = navigationHarness(owner, '#dashboard');
    if (purpose === 'Aluguel') click(nav, 'Locação');
    const funnel = byLabel(nav, `${journey} de ${purpose.toLowerCase()}`);
    const row = find(funnel, node => node.props?.className === 'funnelRow' && node.props['aria-label'].startsWith(`${stage}:`));
    assert(row, `Missing ${purpose}/${journey}/${stage}`);
    row.props.onClick(); nav.render();
    const expected = filterCases(state, { purpose, journey, stage }).map(record => record.id);
    assert.deepEqual(cards(nav).map(card => card.props['data-record-id']), Array.from(expected), 'Drill-down must show exactly the records counted by the selected stage.');
    assert.equal(byLabel(nav, 'Visualização em cartões').props['aria-pressed'], true);
    for (const card of cards(nav)) {
      const markup = renderToStaticMarkup(card);
      assert(markup.includes(`etapa ${stage}, ${stages.indexOf(stage) + 1} de ${stages.length}`));
      assert(markup.includes('Criado em') && markup.includes('Alterado em'));
    }
    assert(nav.requests.every(request => request.method === 'GET'), 'Selecting a stage must not write or send a message.');
  }
}

const nav = navigationHarness(owner, '#cases');
assert(cards(nav).length > 0, 'Direct navigation opens cards.');
byLabel(nav, 'Visualização em lista').props.onClick(); nav.render();
assert.equal(cards(nav).length, 0);
assert(find(nav.tree, node => node.type === 'table'));
click(nav, 'Dashboard');
const firstStage = find(nav.tree, node => node.props?.className === 'funnelRow');
firstStage.props.onClick(); nav.render();
assert.equal(byLabel(nav, 'Visualização em cartões').props['aria-pressed'], true, 'A new drill-down resets the previously selected table view.');
click(nav, 'Leads');
assert.equal(cards(nav).length, state.records.filter(record => record.kind === 'leads').length);
assert(renderToStaticMarkup(cards(nav)[1]).includes('etapa Atendimento, 2 de 6'), 'Lead cards show the linked attendance stage, not a made-up lead stage.');
assert(!renderToStaticMarkup(cards(nav)[0]).includes('28 dias'), 'Deadlines use configured stage limits, not the reference screenshot.');
const firstCard = cards(nav)[0];
find(firstCard, node => node.type === 'button' && text(node) === 'Cliente fictício 01').props.onClick(); nav.render();
assert(find(nav.tree, node => node.props?.record?.id === 'demo-person-1'), 'Customer action opens the correct record.');
assert.equal(JSON.stringify(state), snapshot, 'Navigation preserves source records.');
console.log('PASS attendance cards: all stage/purpose/journey drill-downs, default cards, table fallback, linked stage, real deadlines and customer navigation; no writes.');
