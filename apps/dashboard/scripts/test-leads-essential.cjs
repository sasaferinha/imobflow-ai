const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app/dashboard-client.tsx'), 'utf8');
const summary = source.slice(source.indexOf('function LeadIntelligenceCenter('), source.indexOf('function LeadImportModal('));
const leads = source.slice(source.indexOf('function Leads('), source.indexOf('function Properties('));
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(summary + leads + '\nexports.Summary=LeadIntelligenceCenter;exports.Leads=Leads;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports: moduleObject.exports, require,
  leadDate: new Intl.DateTimeFormat('pt-BR'), leadDateTime: new Intl.DateTimeFormat('pt-BR'),
});
const record = { id: 'test', name: 'Cliente Teste', initials: 'CT', tone: 0, source: 'Teste', intent: 'Comprar casa', region: 'Centro', lifecycleStatus: 'Novo', inactivityDays: null, lastContactAt: null, createdAt: '2026-09-11T12:00:00Z', goal: 'Comprar', propertyType: 'Casa', budget: 'Não informado', scoreDefined: false };
const noOp = () => {};
const summaryHtml = renderToStaticMarkup(React.createElement(moduleObject.exports.Summary, { leads: [record], mode: 'all', onMode: noOp }));
assert.equal((summaryHtml.match(/<button/g) || []).length, 3);
assert.match(summaryHtml, /Todos os leads/);
assert.match(summaryHtml, /Novos/);
assert.match(summaryHtml, /Sem contato recente/);
assert.doesNotMatch(summaryHtml, /recuperação|estimativa|diagnosticada/i);
const props = { leads: [record], selected: record, onSelect: noOp, search: '', setSearch: noOp, onContinue: noOp, notify: noOp, onUpdate: noOp };
const html = renderToStaticMarkup(React.createElement(moduleObject.exports.Leads, props));
assert.match(html, /Abrir conversa/);
assert.match(html, /Último contato/);
assert.match(html, /Indefinido/);
assert.doesNotMatch(html, /Diagnóstico comercial|carteira de recuperação|Tempo inativo/);
const empty = renderToStaticMarkup(React.createElement(moduleObject.exports.Leads, { ...props, leads: [] }));
assert.match(empty, /Nenhum resultado/);
assert.doesNotMatch(empty, /Ficha do cliente|Abrir conversa/);
assert.ok(source.includes("view === 'leads' ? <button"));
console.log('PASS essential summaries, client details, empty filtered list and contextual import action');
