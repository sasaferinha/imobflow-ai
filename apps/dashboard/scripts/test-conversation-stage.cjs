// Synthetic message metadata only. No content, credentials or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/conversation-stage.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: mod, exports: mod.exports, Date, Map });
const stage = mod.exports.automaticConversationStage;
const message = (id, direction, extra = {}) => ({ id: String(id), direction,
  created_at: new Date(Date.UTC(2026, 9, 11, 12, 0, id)).toISOString(),
  ...(direction === 'outgoing' ? { delivery_status: 'sent' } : {}), ...extra });
const incoming = id => message(id, 'incoming');
const outgoing = (id, extra) => message(id, 'outgoing', extra);

assert.equal(stage([]), 'Lead');
assert.equal(stage([incoming(1)]), 'Lead');
assert.equal(stage([incoming(1), outgoing(2)]), 'Lead', 'First agency answer alone is still a lead');
assert.equal(stage([incoming(1), outgoing(2), outgoing(3), outgoing(4), outgoing(5)]), 'Lead', 'Agency follow-ups do not manufacture customer engagement');
assert.equal(stage([incoming(1), incoming(2), incoming(3), incoming(4), outgoing(5)]), 'Lead', 'Customer must reply after the agency');
assert.equal(stage([incoming(1), outgoing(2), incoming(3)]), 'Lead', 'Exactly three messages do not meet more-than-three threshold');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), outgoing(4)]), 'Atendimento');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), incoming(4)]), 'Atendimento');
assert.equal(stage([incoming(4), outgoing(2), incoming(1), incoming(3)]), 'Atendimento', 'Delivery order does not replace chronology');
assert.equal(stage([incoming(1), outgoing(2, { delivery_status: 'pending' }), incoming(3), outgoing(4, { delivery_status: 'failed' }), incoming(5)]), 'Lead');
assert.equal(stage([incoming(1), outgoing(2, { delivery_status: null, external_message_id: 'provider-accepted' }), incoming(3), incoming(4)]), 'Atendimento', 'Older accepted replies retain receipt evidence');
assert.equal(stage([incoming(1), outgoing(2, { delivery_status: 'failed', external_message_id: 'provider-rejected' }), incoming(3), incoming(4)]), 'Lead', 'Failure takes priority over a provider ID');
assert.equal(stage([outgoing(1), outgoing(2), incoming(3), outgoing(4), incoming(5)]), 'Lead', 'Messages before the customer first contacted are excluded from this exchange');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), incoming(3)]), 'Lead', 'Duplicate rows cannot reach the threshold');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), message(4, 'system')]), 'Lead', 'System notes are not messages');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), incoming(4)].map(row => ({ ...row, created_at: 'invalid' }))), 'Lead');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), incoming(4)].map(row => ({ ...row, created_at: incoming(1).created_at }))), 'Lead', 'An ambiguous timestamp cannot prove a response sequence');
assert.equal(stage([message(1, 'Entrada'), message(2, 'Saída', { delivery_status: 'sent' }), message(3, 'Entrada'), message(4, 'Entrada')]), 'Atendimento');
assert.equal(stage([incoming(1), outgoing(2), incoming(3), incoming(4)].map(row => ({ ...row, content: 'visita realizada, proposta aceita, negócio fechado' }))), 'Atendimento', 'Text never advances to a broker-only stage');
console.log('PASS automatic stage: real exchange threshold, reply chronology, delivery evidence, duplicates and broker-only stages.');
