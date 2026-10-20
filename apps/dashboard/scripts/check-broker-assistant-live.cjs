// Opt-in deployment gate. Only fictional conversations, never customer data or outbound messages.
if (process.argv.includes('--if-requested') && process.env.IMOBFLOW_VERIFY_BROKER_ASSISTANT !== '1') process.exit(0);
const assert = require('node:assert/strict');
const { loadLocalAI } = require('./helpers/load-local-ai.cjs');
const codes = ['invalid_json_schema', 'invalid_api_key', 'model_not_found', 'insufficient_quota', 'rate_limit_exceeded', 'unsupported_parameter', 'invalid_request_error'];
const parameters = ['model', 'text.format', 'text.format.schema', 'max_output_tokens'];
const checkedFetch = async (url, options) => {
  assert.equal(url, 'https://api.openai.com/v1/responses');
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.clone().json().catch(() => ({}));
    const error = body?.error || {};
    console.error('BROKER_ASSISTANT_PROVIDER_REJECTED', JSON.stringify({ status: response.status,
      code: codes.includes(error.code) ? error.code : 'unknown', param: parameters.includes(error.param) ? error.param : null }));
  }
  return response;
};
const mod = { exports: loadLocalAI('broker-assistant.ts', { process, fetch: checkedFetch, console }) };
(async () => {
  if (!mod.exports.brokerAssistantConfigured()) throw new Error('OPENAI_KEY_NOT_AVAILABLE');
  const cases = [
    { name: 'sale', sector: 'Venda', text: 'Quero comprar uma casa no Centro de Lavras, com orçamento máximo de 400 mil reais.', expected: { purpose: 'Venda', propertyType: 'Casa', budgetMax: 400000 } },
    { name: 'rental', sector: 'Aluguel', text: 'Quero alugar um apartamento no Centro de Lavras. Meu limite de aluguel é 2000 reais por mês.', expected: { purpose: 'Aluguel', propertyType: 'Apartamento', budgetMax: 2000 } },
    { name: 'clarification', sector: 'Geral', text: 'Olá, gostaria de informações.', expected: {} },
  ];
  for (const test of cases) {
    const result = await mod.exports.generateBrokerAssistance({ sector: test.sector, profile: {}, messages: [{ id: `fictional-${test.name}`, side: 'incoming', text: test.text }] });
    assert.ok(result.reply.trim());
    const fields = Object.fromEntries(result.changes.map(change => [change.field, change.value]));
    for (const [field, value] of Object.entries(test.expected)) assert.equal(fields[field], value, `${test.name}:${field}`);
    if (test.name === 'clarification') assert.equal(result.changes.length, 0);
    console.log(`PASS live broker assistant: ${test.name}; real provider and validated response, fictional data only.`);
  }
  console.log('PASS live broker assistant: no customer data, database writes or outbound messages.');
})().catch(error => {
  console.error('BROKER_ASSISTANT_LIVE_FAILED', JSON.stringify({ status: error?.status || null, reason: error?.message === 'OPENAI_KEY_NOT_AVAILABLE' ? 'OPENAI_KEY_NOT_AVAILABLE' : 'provider_or_contract_failure' }));
  process.exitCode = 1;
});
