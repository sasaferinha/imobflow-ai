const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/media-studio/client.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const job = { id: 'job-1', kind: 'photo', propertyId: 'demo-casa-jardim', photoIndex: 1, format: 'landscape', status: 'completed', createdAt: '2026-11-17T12:00:00Z', expiresAt: '2026-11-18T12:00:00Z', resultAvailable: true };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(responses) {
  const calls = [], delays = [], timers = new Map(); let nextTimer = 0;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, Error, DOMException,
    fetch: async (url, options) => { calls.push({ url, options }); const next = responses.shift(); if (next instanceof Error) throw next; assert(next, `Unexpected fetch: ${url}`); return typeof next === 'function' ? next(url, options) : next; },
    setTimeout(fn, ms) { const id = ++nextTimer; delays.push(ms); timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { api: module.exports, calls, delays, advance() { const next = timers.entries().next().value; assert(next, 'Expected scheduled poll'); timers.delete(next[0]); next[1](); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  const auth = fixture([new Response(null, { status: 401 })]);
  const status = await auth.api.getMediaAiStatus();
  assert.equal(status.access, 'login_required'); assert.equal(status.photo.available, false); assert.equal(status.jobs.length, 0);
  assert.equal(auth.calls[0].options.credentials, 'same-origin'); assert.equal(auth.calls[0].options.cache, 'no-store'); assert.equal(auth.calls[0].options.redirect, 'error');
  const forbidden = fixture([json({ error: 'Sem permissão', code: 'media_forbidden' }, 403)]);
  assert.equal((await forbidden.api.getMediaAiStatus()).access, 'forbidden');

  const ready = fixture([json({ access: 'ready', photo: { available: true }, video: { available: false, message: 'Não configurado' }, jobs: [job] })]);
  assert.equal((await ready.api.getMediaAiStatus()).jobs[0].id, job.id);
  const invalidStatus = fixture([json({ access: 'ready', photo: { available: 'true' }, video: { available: true }, jobs: [] })]);
  await assert.rejects(invalidStatus.api.getMediaAiStatus(), /confirmar o acesso/);

  const input = { requestId: 'c6c90557-246a-4a1a-a41b-688c1c7ae05d', kind: 'photo', propertyId: job.propertyId, photoIndex: 1, format: 'landscape', imageDataUrl: 'data:image/jpeg;base64,/9j/dGVzdA==' };
  const retry = fixture([new TypeError('offline'), json({ job })]);
  await assert.rejects(retry.api.createMediaAiJob(input), error => error instanceof retry.api.MediaAiRequestError && error.ambiguous);
  assert.equal((await retry.api.createMediaAiJob(input)).id, job.id);
  assert.equal(retry.calls[0].options.body, retry.calls[1].options.body, 'Retry submits the same caller-owned request ID and data');
  assert.equal(retry.calls[0].url, '/api/media-studio/jobs');
  const payload = JSON.parse(retry.calls[0].options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['format', 'imageDataUrl', 'kind', 'photoIndex', 'propertyId', 'requestId']);
  assert(!('companyId' in payload) && !('provider' in payload) && !('prompt' in payload), 'The authenticated server decides company, provider and prompt');

  for (const statusCode of [500, 504, 408]) {
    const uncertain = fixture([json({ error: 'Interrompido' }, statusCode)]);
    await assert.rejects(uncertain.api.createMediaAiJob(input), error => error.ambiguous);
  }
  const denied = fixture([json({ error: 'Sem cota' }, 403)]);
  await assert.rejects(denied.api.createMediaAiJob(input), error => error.message === 'Sem cota' && !error.ambiguous);
  const malformed = fixture([json({ job: { id: 'wrong' } })]);
  await assert.rejects(malformed.api.createMediaAiJob(input), error => error.ambiguous, 'Malformed creation response cannot trigger a new request ID');

  const video = { ...job, kind: 'video' };
  const polling = fixture([json({ job: { ...video, status: 'processing', resultAvailable: false } }), json({ job: video })]);
  const controller = new AbortController(), updates = [];
  const followed = polling.api.followMediaAiJob({ ...video, status: 'processing', resultAvailable: false }, controller.signal, update => updates.push(update));
  assert.equal(polling.calls.length, 0, 'No immediate repeated polling');
  assert.equal(polling.delays[0], 6000);
  polling.advance(); await tick(); polling.advance();
  assert.equal((await followed).status, 'completed');
  assert.equal(polling.calls.length, 2); assert(polling.delays.every(ms => ms >= 6000));
  assert(polling.calls.every(call => call.url === '/api/media-studio/jobs/job-1' && call.options.method === 'POST' && call.options.body === '{}'), 'Video refresh only polls an existing job, never creates another');
  assert.equal(updates.length, 3);

  const cancel = fixture([]), stopped = new AbortController();
  const following = cancel.api.followMediaAiJob({ ...video, status: 'processing' }, stopped.signal, () => {});
  stopped.abort(); await assert.rejects(following, error => error.name === 'AbortError');
  assert.equal(cancel.calls.length, 0, 'Stopping UI monitoring never sends a provider cancellation');

  const completed = fixture([new Response(new Blob(['jpeg'], { type: 'image/jpeg' }))]);
  assert.equal((await completed.api.loadMediaAiResult(job)).type, 'image/jpeg');
  assert.equal(completed.calls[0].url, '/api/media-studio/jobs/job-1/result');
  const unsupported = fixture([new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })]);
  await assert.rejects(unsupported.api.loadMediaAiResult(job), /compatível/);
  const large = fixture([new Response(new Blob([new Uint8Array(30 * 1024 * 1024 + 1)], { type: 'video/mp4' }))]);
  await assert.rejects(large.api.loadMediaAiResult(video), /compatível/);
  const unavailable = fixture([]);
  await assert.rejects(unavailable.api.loadMediaAiResult({ ...job, resultAvailable: false }), /não está disponível/);
  await assert.rejects(unavailable.api.readMediaAiJob('../another-company'), /inválida/);
  assert.equal(unavailable.calls.length, 0);
  console.log('PASS media AI client: authenticated same-origin requests, validated job protocol, 401/config gating, idempotent ambiguous retry, six-second video polling, stop without cancellation, safe result types/sizes and no real provider calls.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
