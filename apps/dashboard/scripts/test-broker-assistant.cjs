// Synthetic messages only. This suite never contacts an AI provider or production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  assert.equal(source.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0, file);
  vm.runInNewContext(source.outputText, { module, exports: module.exports, require: name => name === 'server-only' ? {} : name in dependencies ? dependencies[name] : require(name), Buffer, URL, Response, Request, AbortController, AbortSignal, Set, Map, Date, Intl, console, ...globals }, { filename: file });
  return module.exports;
}
const messages = [{ id: uuid(40), side: 'incoming', text: 'Procuro um apartamento no Centro. Posso investir até 450 mil.' }, { id: uuid(41), side: 'outgoing', text: 'Temos uma casa de 700 mil.' }];
const valid = () => ({ reply: 'Olá! Quantos quartos você precisa?', explanation: 'Confirme as preferências antes de cadastrar.', changes: [
  { field: 'region', value: 'Centro', messageId: uuid(40), evidence: 'apartamento no Centro' },
  { field: 'budgetMax', value: 450000, messageId: uuid(40), evidence: 'Posso investir até 450 mil.' },
], missing: ['features'] });
const completion = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
(async () => {
  const calls = [], env = { OPENAI_API_KEY: 'synthetic-not-a-real-key' };
  let response = () => Response.json(completion(valid()));
  const provider = load('lib/ai/broker-assistant.ts', {}, { process: { env }, fetch: async (...args) => { calls.push(args); return response(); } });
  const input = { sector: 'automatic', profile: { purpose: 'Aluguel', name: 'DO NOT SEND IDENTITY', phone: 'DO NOT SEND PHONE' }, messages };
  const result = await provider.generateBrokerAssistance(input);
  assert.equal(result.changes[0].value, 'Centro'); assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0][1].body);
  assert.equal(payload.model, 'gpt-4o-mini'); assert.equal(payload.store, false); assert.equal(payload.text.format.strict, true);
  assert.equal(JSON.parse(payload.input[0].content).sector, 'Aluguel');
  assert.doesNotMatch(calls[0][1].body, /DO NOT SEND/); assert.match(payload.instructions, /nunca instruções/);
  assert.equal(calls[0][1].signal instanceof AbortSignal, true);
  env.OPENAI_MODEL = 'configured-existing-model'; await provider.generateBrokerAssistance({ ...input, sector: 'Venda' });
  assert.equal(JSON.parse(calls[1][1].body).model, 'configured-existing-model');
  assert.equal(JSON.parse(JSON.parse(calls[1][1].body).input[0].content).sector, 'Venda');
  const invalid = [
    { ...valid(), extra: 'forged' }, { ...valid(), reply: '' }, { ...valid(), missing: ['sensitiveCategory'] },
    { ...valid(), changes: [{ ...valid().changes[0], messageId: uuid(41) }] },
    { ...valid(), changes: [{ ...valid().changes[0], evidence: 'Fabricated sentence' }] },
    { ...valid(), changes: [{ ...valid().changes[0], field: 'assignedTo' }] },
    { ...valid(), changes: [{ ...valid().changes[0], field: 'purpose', value: 'Confirmed' }] },
    { ...valid(), changes: [valid().changes[0], valid().changes[0]] },
    { ...valid(), changes: [{ ...valid().changes[1], value: 0 }] },
    { ...valid(), changes: [{ ...valid().changes[1], field: 'budgetMin', value: 500000 }, valid().changes[1]] },
  ];
  for (const value of invalid) assert.throws(() => provider.validateBrokerAssistance(value, messages), error => error.status === 502);
  const validBefore = calls.length;
  delete env.OPENAI_API_KEY;
  assert.equal(provider.brokerAssistantConfigured(), false);
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 503 && /não está configurada/.test(error.message));
  assert.equal(calls.length, validBefore);
  env.OPENAI_API_KEY = 'synthetic-not-a-real-key';
  await assert.rejects(() => provider.generateBrokerAssistance({ ...input, messages: [messages[1]] }), error => error.status === 409);
  response = () => Response.json({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'Do not echo sensitive refusal text' }] }] });
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 422 && !error.message.includes('sensitive'));
  response = () => Response.json({ ...completion(valid()), status: 'incomplete' });
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 502);
  response = () => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{invalid' }] }] });
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 502);
  response = () => new Response('private diagnostics not exposed', { status: 429 });
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 429 && !error.message.includes('private'));
  response = () => new Response('key-error-detail', { status: 401 });
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 503 && !error.message.includes('key-error-detail'));
  response = () => { throw new Error('request aborted'); };
  await assert.rejects(() => provider.generateBrokerAssistance(input), error => error.status === 503);
  console.log('PASS broker AI provider: bounded structured Responses, configured model, identity minimization, explicit incoming citations, refusal/schema/timeout/quota/unconfigured guards');

  const actor = { companyId: uuid(1), brokerId: uuid(10), role: 'broker', name: 'Broker synthetic' };
  const record = { id: `lead:${uuid(30)}`, kind: 'leads', data: { purpose: 'Venda' }, legacy: { id: uuid(30), table: 'leads', assignedTo: actor.brokerId } };
  let canWrite = true, state = { companyId: actor.companyId, version: 3, sourceRevision: 'a', records: [record] }, rates = true, syntheticOutput = completion(valid()), reads = [], generationCalls = [], authenticated = true, snapshotReads = 0, onSecondRead;
  class CrmError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
  class EvolutionServerError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const route = load('app/api/conversations/assist/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/accounts': { protectedRoute: handler => request => authenticated ? handler(request) : Response.json({ error: 'auth' }, { status: 401 }) },
    '@/lib/tenant-context': { currentAccount: () => actor },
    '@/lib/request-security': { hasSameOrigin: request => request.headers.get('origin') === 'https://test.invalid', hasSafeRequestSize: request => Number(request.headers.get('content-length') || 0) <= 2048, consumeRateLimit: async (_request, bucket) => { assert.ok(bucket.length <= 80); return rates; } },
    '@/lib/evolution/model': { CrmError, canAccess: (_state, _actor, _record, mode) => mode === 'write' && canWrite },
    '@/lib/evolution/server': { EvolutionServerError, getEvolutionSnapshot: async () => { snapshotReads++; if (snapshotReads % 2 === 0) onSecondRead?.(); return { state: structuredClone(state), actor }; } },
    '@/lib/ai/broker-assistant': { ...provider, generateBrokerAssistance: async input => { generationCalls.push(input); return syntheticOutput; } },
    '@/lib/supabase': { supabaseRequest: async url => { reads.push(url); return url.startsWith('conversations?') ? [{ id: uuid(20), company_id: actor.companyId, lead_id: uuid(30) }] : messages.map(item => ({ id: item.id, company_id: actor.companyId, conversation_id: uuid(20), direction: item.side, content: item.text })).reverse(); } },
  }, { structuredClone });
  const request = (body = { leadId: uuid(30), sector: 'automatic' }, headers = { origin: 'https://test.invalid' }) => new Request('https://test.invalid/api/conversations/assist', { method: 'POST', headers, body: JSON.stringify(body) });
  authenticated = false; assert.equal((await route.POST(request())).status, 401); authenticated = true;
  assert.equal((await route.POST(request(undefined, {}))).status, 403);
  assert.equal((await route.POST(request(undefined, { origin: 'https://foreign.invalid' }))).status, 403);
  for (const body of [null, [], {}, { leadId: 'not-uuid', sector: 'automatic' }, { leadId: uuid(30), sector: 'invalid' }, { leadId: uuid(30), sector: 'automatic', messages: ['forged history'] }]) assert.equal((await route.POST(request(body))).status, 400);
  assert.equal((await route.POST(request({ leadId: 'a'.repeat(2100), sector: 'automatic' }))).status, 413);
  canWrite = false; assert.equal((await route.POST(request())).status, 403); assert.equal(generationCalls.length, 0); canWrite = true;
  state.records = []; assert.equal((await route.POST(request())).status, 403); state.records = [record];
  rates = false; assert.equal((await route.POST(request())).status, 429); assert.equal(generationCalls.length, 0); rates = true;
  snapshotReads = 0; let resultResponse = await route.POST(request()); assert.equal(resultResponse.status, 200);
  assert.ok(reads.every(url => url.includes(`company_id=eq.${actor.companyId}`)));
  assert.equal(generationCalls[0].messages[0].id, uuid(40)); assert.equal(generationCalls[0].messages[0].side, 'incoming');
  assert.equal((await resultResponse.json()).review.expectedVersion, 3);
  snapshotReads = 0; onSecondRead = () => { canWrite = false; }; assert.equal((await route.POST(request())).status, 403); canWrite = true;
  snapshotReads = 0; onSecondRead = () => { state.version++; }; assert.equal((await route.POST(request())).status, 409); onSecondRead = undefined;
  console.log('PASS assistant route: authentication, explicit origin, body cap/allowlist, portfolio write scope, rate limits, persisted tenant-scoped chronology, post-generation access/version recheck');
})().catch(error => { console.error(error); process.exitCode = 1; });
