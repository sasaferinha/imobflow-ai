const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}, suffix = '') {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { module: mod, exports: mod.exports, require: name => name in deps ? deps[name] : require(name), Date, Intl, Error, console });
  return mod.exports;
}
const helper = load('lib/whatsapp-handoff.ts');
const { ConversationWhatsAppHandoff } = load('app/conversation-whatsapp-handoff.tsx', { '@/lib/whatsapp-handoff': helper });
const text = 'Olá! Imóvel & visita?\nAmanhã às 14h 🏠';
const url = new URL(helper.whatsappConversationLink('+55 (35) 99999-0000', text));
assert.equal(url.origin, 'https://wa.me');
assert.equal(url.pathname, '/5535999990000');
assert.equal(url.searchParams.get('text'), text);
for (const phone of ['', 'javascript:alert(1)', 'https://wa.me/5535999990000', 'Exemplo 123456789', '00012345678', '123', '1'.repeat(16)]) assert.equal(helper.whatsappConversationLink(phone, text), null);
assert.equal(helper.isWhatsAppWindowError('Fora da janela de 24 horas. Configure um modelo aprovado pela Meta.'), true);
assert.equal(helper.isWhatsAppWindowError('A janela de 24 horas expirou. Para iniciar nova conversa, use um modelo aprovado pela Meta.'), true);
assert.equal(helper.isWhatsAppWindowError('Assuma o atendimento antes de enviar.'), false);
let html = renderToStaticMarkup(React.createElement(ConversationWhatsAppHandoff, { phone: '+5535999990000', text }));
assert.match(html, /target="_blank"/); assert.match(html, /noopener noreferrer/);
assert.match(html, /não ao seu número pessoal/); assert.match(html, /nada é enviado automaticamente/);
assert.doesNotMatch(renderToStaticMarkup(React.createElement(ConversationWhatsAppHandoff, { phone: '', text })), /href=/);

// Exercise actual workspace submit handler and re-render, without network or customer messages.
let states, cursor, props, denied, calls, dispatched;
const ui = load('app/conversation-center.tsx', {
  react: { useState: initial => { const n = cursor++; if (!(n in states)) states[n] = initial?.leadId === '' ? { leadId: 'a', ready: true } : initial; return [states[n], v => { states[n] = typeof v === 'function' ? v(states[n]) : v; }]; }, useEffect() {}, useMemo: fn => fn(), useRef: initial => ({ current: initial }) },
  '@/lib/dashboard-transport': {}, '@/lib/demo-conversations': { demoContacts: [] },
  '@/lib/dashboard-sync': {}, '@/lib/conversation-inbox': load('lib/conversation-inbox.ts'),
  './conversation-message': {}, './conversation-settings': {},
  './conversation-whatsapp-handoff': { ConversationWhatsAppHandoff }, '@/lib/whatsapp-handoff': helper,
  './conversation-attendance': { describeConversationAttendance: () => ({ canSend: !denied, owner: null }) },
}, '\nexport { ConversationWorkspace };');
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
}
function render() { cursor = 0; return ui.ConversationWorkspace(props); }
function handoff() { return find(render(), node => node.type === ConversationWhatsAppHandoff); }
function setup(message = 'Fora da janela de 24 horas. Configure um modelo aprovado pela Meta.') {
  states = []; denied = false; calls = 0; dispatched = [];
  props = { state: { selectedId: 'lead-a', threads: { 'lead-a': { messages: [], draft: text } } },
    leads: [{ id: 'a', name: 'Cliente fictício', phone: '+5535999990000', details: '', lifecycleStatus: 'Novo', temperature: 'Frio' }],
    ready: true, currentBrokerName: 'Teste', notify() {}, dispatch: v => dispatched.push(v),
    persistMessage: async () => { calls++; throw new Error(message); } };
}
async function send() { await find(render(), node => node.type === 'form' && node.props.className === 'full-composer').props.onSubmit({ preventDefault() {} }); }
(async () => {
  setup(); assert.equal(handoff(), undefined); await send();
  assert.equal(calls, 1); assert.equal(dispatched.length, 0); assert.equal(props.state.threads['lead-a'].draft, text);
  assert.equal(handoff().props.text, text); assert.equal(handoff().props.phone, '+5535999990000');
  props.state.threads['lead-a'].draft = 'Texto revisado'; assert.equal(handoff().props.text, 'Texto revisado');
  denied = true; assert.equal(handoff(), undefined); denied = false;
  props.demonstration = true; assert.equal(handoff(), undefined); props.demonstration = false;
  props.state.threads['lead-a'].messages.push({ id: 'in-new', side: 'incoming' }); assert.equal(handoff(), undefined);
  setup('Erro de conexão'); await send(); assert.equal(handoff(), undefined);
  setup(); props.state.threads['lead-a'].messages.push({ id: 'failed', side: 'outgoing', text: 'Texto recusado', deliveryStatus: 'failed', deliveryError: 'A janela de 24 horas expirou.' });
  props.state.threads['lead-a'].draft = ''; assert.equal(handoff().props.text, 'Texto recusado');
  props.state.threads['lead-a'].messages.push({ id: 'echo', side: 'outgoing', deliveryStatus: 'sent' }); assert.equal(handoff(), undefined);
  setup(); await send(); props.persistMessage = async () => ({ id: 'sent', time: '12:00' }); await send(); assert.equal(handoff(), undefined);
  setup(); await send(); props.leads = [{ ...props.leads[0], id: 'b' }]; props.state.selectedId = 'lead-b'; assert.equal(handoff(), undefined);
  setup(); states[6] = true; // Property picker open, exercise its actual selection handler.
  const picker = find(render(), node => typeof node.props?.select === 'function');
  await picker.props.select({ id: 'property', title: 'Casa fictícia', purpose: 'Venda', district: 'Centro', meta: '2 quartos', price: 'R$ 300 mil', images: [] });
  props.state.threads['lead-a'].draft = '';
  assert.match(handoff().props.text, /Separei uma opção/);
  assert.equal(dispatched.length, 0);
  console.log('PASS WhatsApp handoff: safe recipient/Unicode draft, preflight and provider rejection, no false sends, ownership/demo guards, edits, incoming recovery, successful retry and contact isolation');
})().catch(error => { console.error(error); process.exitCode = 1; });
