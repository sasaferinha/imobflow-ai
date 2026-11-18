// Mocked provider HTTP and synthetic bytes only: no credentials, network, or paid jobs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/media-studio/providers.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const taskId = 'd2e3d1f4-1b3c-4b5c-8d46-1c1d7ee86892';
const outputUrl = 'https://dnznrvs05pmza.cloudfront.net/output.mp4?_jwt=synthetic-signature';
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 217]);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const webp = Uint8Array.from(Buffer.from('RIFF0000WEBPsynthetic'));
const mp4 = Buffer.alloc(24);
mp4.writeUInt32BE(24, 0); mp4.write('ftyp', 4); mp4.write('isom', 8); mp4.write('isom', 16); mp4.write('mp42', 20);
const input = { bytes: jpeg, contentType: 'image/jpeg', format: 'landscape' };
const secret = 'synthetic-do-not-expose-provider-diagnostic';

function harness(options = {}) {
  const calls = [], module = { exports: {} };
  const env = options.env ?? { MEDIA_AI_OPENAI_KEY: 'synthetic-image-key', OPENAI_API_KEY: 'synthetic-fallback-key', RUNWAYML_API_SECRET: 'synthetic-runway-key' };
  let handler = options.handler ?? (() => Response.json({ id: taskId }));
  vm.runInNewContext(source, {
    module, exports: module.exports, require: name => { assert.equal(name, 'server-only'); return {}; }, Buffer, Uint8Array, FormData, Blob, URL, AbortController, AbortSignal,
    setTimeout: options.setTimeout ?? setTimeout, clearTimeout, process: { env },
    fetch: async (url, request) => { calls.push({ url, request }); return handler(url, request); },
  });
  return { api: module.exports, env, calls, handle: next => { handler = next; } };
}

async function rejects(work, code, ambiguous) {
  await assert.rejects(work, error => {
    assert.equal(error.name, 'MediaProviderError');
    assert.equal(error.code, code);
    assert.equal(error.ambiguous, ambiguous);
    assert.equal(error.message, code);
    assert.ok(!JSON.stringify(error).includes(secret));
    assert.ok(!error.stack.includes(secret));
    assert.ok(!error.cause, 'Raw provider errors must not become an exposed cause');
    return true;
  });
}

async function main() {
  const photo = harness({ handler: () => Response.json({ data: [{ b64_json: Buffer.from(jpeg).toString('base64') }], usage: { input_tokens: 20, output_tokens: 50, input_tokens_details: { image_tokens: 12, text_tokens: 8, unsafe: secret }, debug: secret } }) });
  const result = await photo.api.enhancePhoto(input);
  assert.deepEqual(Buffer.from(result.bytes), Buffer.from(jpeg));
  assert.equal(result.provider, 'openai'); assert.equal(result.model, 'gpt-image-2.6-sunburst'); assert.equal(result.contentType, 'image/jpeg');
  assert.deepEqual(JSON.parse(JSON.stringify(result.usage)), { input_tokens: 20, output_tokens: 50, input_tokens_details: { image_tokens: 12, text_tokens: 8 } });
  const p = photo.calls[0];
  assert.equal(p.url, 'https://api.openai.com/v1/images/edits'); assert.equal(p.request.method, 'POST');
  assert.equal(p.request.headers.Authorization, 'Bearer synthetic-image-key');
  assert.equal(p.request.headers['Content-Type'], undefined, 'FormData sets the boundary');
  const form = p.request.body;
  assert.equal(form.get('image[]').name, 'property.jpg'); assert.equal(form.get('image[]').type, 'image/jpeg');
  assert.equal(form.get('model'), 'gpt-image-2.6-sunburst'); assert.equal(form.get('quality'), 'medium'); assert.equal(form.get('complexity'), 'low');
  assert.equal(form.get('n'), '1'); assert.equal(form.get('size'), '1536x1024'); assert.equal(form.get('output_format'), 'jpeg'); assert.equal(form.get('output_compression'), '90');
  assert.equal(form.get('response_format'), null); assert.equal(form.get('input_fidelity'), null);
  assert.match(form.get('prompt'), /all visible defects/); assert.match(form.get('prompt'), /Do not remove, replace or invent/);
  assert.equal(p.request.redirect, 'error'); assert.equal(p.request.cache, 'no-store'); assert.equal(p.request.credentials, 'omit');
  await photo.api.enhancePhoto({ ...input, format: 'portrait', bytes: png, contentType: 'image/png' });
  assert.equal(photo.calls[1].request.body.get('size'), '1024x1536'); assert.equal(photo.calls[1].request.body.get('image[]').name, 'property.png');
  delete photo.env.MEDIA_AI_OPENAI_KEY;
  await photo.api.enhancePhoto({ ...input, bytes: webp, contentType: 'image/webp' });
  assert.equal(photo.calls[2].request.headers.Authorization, 'Bearer synthetic-fallback-key');

  const video = harness();
  assert.equal((await video.api.startVideo(input)).taskId, taskId);
  const v = video.calls[0], body = JSON.parse(v.request.body);
  assert.equal(v.url, 'https://api.dev.runwayml.com/v1/image_to_video'); assert.equal(v.request.method, 'POST');
  assert.equal(v.request.headers.Authorization, 'Bearer synthetic-runway-key'); assert.equal(v.request.headers['X-Runway-Version'], '2024-11-06');
  assert.equal(v.request.headers['Content-Type'], 'application/json');
  assert.equal(body.model, 'gen4_turbo'); assert.equal(body.ratio, '1280:720'); assert.equal(body.duration, 5);
  assert.equal(body.promptImage, `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`);
  assert.ok(body.promptText.length <= 1000); assert.match(body.promptText, /Do not reveal unseen areas/);
  assert.equal(v.request.redirect, 'error'); assert.equal(v.request.credentials, 'omit');
  await video.api.startVideo({ ...input, format: 'portrait' }); assert.equal(JSON.parse(video.calls[1].request.body).ratio, '720:1280');

  const invalidInputs = [
    null, { ...input, bytes: 'https://attacker.example/photo.jpg' }, { ...input, bytes: new Uint8Array() },
    { ...input, contentType: 'image/svg+xml' }, { ...input, contentType: 'image/png' },
    { ...input, bytes: Uint8Array.from(Buffer.from('<html>bad</html>')) }, { ...input, format: 'square' },
  ];
  const invalid = harness();
  for (const value of invalidInputs) for (const method of ['enhancePhoto', 'startVideo']) await rejects(() => invalid.api[method](value), 'media_ai_invalid_input', false);
  for (const method of ['enhancePhoto', 'startVideo']) await rejects(() => invalid.api[method]({ ...input, bytes: new Uint8Array(2 * 1024 * 1024 + 1) }), 'media_ai_input_too_large', false);
  assert.equal(invalid.calls.length, 0);
  const unavailable = harness({ env: {} });
  await rejects(() => unavailable.api.enhancePhoto(input), 'media_ai_openai_not_configured', false);
  await rejects(() => unavailable.api.startVideo(input), 'media_ai_runway_not_configured', false);
  assert.equal(unavailable.calls.length, 0);

  for (const [status, code, ambiguous] of [[400, 'media_ai_request_rejected', false], [401, 'media_ai_authentication_failed', false], [402, 'media_ai_payment_required', false], [403, 'media_ai_authentication_failed', false], [408, 'media_ai_request_timeout', true], [429, 'media_ai_rate_limited', false], [500, 'media_ai_provider_unavailable', true], [503, 'media_ai_provider_unavailable', true]]) {
    for (const method of ['enhancePhoto', 'startVideo']) {
      const h = harness({ handler: () => Response.json({ error: secret }, { status }) });
      await rejects(() => h.api[method](input), code, ambiguous); assert.equal(h.calls.length, 1, 'Never automatically repeat a paid request');
    }
  }
  for (const method of ['enhancePhoto', 'startVideo']) {
    const h = harness({ handler: () => { throw new Error(secret); } });
    await rejects(() => h.api[method](input), 'media_ai_network_error', true); assert.equal(h.calls.length, 1);
    const pre = new AbortController(); pre.abort();
    await rejects(() => h.api[method](input, pre.signal), 'media_ai_request_aborted', false); assert.equal(h.calls.length, 1);
    const controller = new AbortController(); h.handle(() => { controller.abort(secret); return new Promise(() => {}); });
    await rejects(() => h.api[method](input, controller.signal), 'media_ai_request_aborted', true); assert.equal(h.calls.length, 2);
    const timed = harness({ handler: () => new Promise(() => {}), setTimeout: callback => setTimeout(callback, 0) });
    await rejects(() => timed.api[method](input), 'media_ai_request_timeout', true); assert.equal(timed.calls.length, 1);
  }

  const malformed = harness();
  for (const value of [{}, [], { id: secret }, { id: `../${taskId}` }]) {
    malformed.handle(() => Response.json(value)); await rejects(() => malformed.api.startVideo(input), 'media_ai_invalid_response', true);
  }
  malformed.handle(() => new Response(secret)); await rejects(() => malformed.api.enhancePhoto(input), 'media_ai_invalid_response', true);
  for (const value of [{}, { data: [] }, { data: [{ b64_json: 'abc' }] }, { data: [{ b64_json: 'a=== ' }] }, { data: [{ b64_json: jpeg.toString() }] }, { data: [{ b64_json: 'YQ==' }, { b64_json: 'YQ==' }] }]) {
    malformed.handle(() => Response.json(value)); await rejects(() => malformed.api.enhancePhoto(input), 'media_ai_invalid_response', true);
  }
  for (const bytes of [Buffer.from('<html>secret</html>'), Buffer.from(png), Buffer.from([255, 216, 255, 224])]) {
    malformed.handle(() => Response.json({ data: [{ b64_json: bytes.toString('base64') }] }));
    await rejects(() => malformed.api.enhancePhoto(input), 'media_ai_invalid_output', true);
  }
  malformed.handle(() => Response.json({ data: [{ b64_json: 'Yh==' }] }));
  await rejects(() => malformed.api.enhancePhoto(input), 'media_ai_invalid_output', true, 'Noncanonical base64 is rejected');
  malformed.handle(() => new Response('{}', { headers: { 'Content-Length': String(20 * 1024 * 1024) } }));
  await rejects(() => malformed.api.enhancePhoto(input), 'media_ai_output_too_large', true);
  malformed.handle(() => Response.json({ data: [{ b64_json: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') }] }));
  await rejects(() => malformed.api.enhancePhoto(input), 'media_ai_output_too_large', true);

  const status = harness();
  for (const state of ['PENDING', 'THROTTLED', 'RUNNING']) {
    status.handle(() => Response.json({ id: taskId, status: state, progress: 0.6 }));
    const result = await status.api.inspectVideo(taskId); assert.equal(result.state, 'processing'); assert.equal(result.progress, 0.6);
  }
  for (const progress of [-1, 10, '90', null]) {
    status.handle(() => Response.json({ id: taskId, status: 'RUNNING', progress }));
    assert.equal((await status.api.inspectVideo(taskId)).progress, undefined);
  }
  status.handle(() => Response.json({ id: taskId, status: 'SUCCEEDED', output: [outputUrl] }));
  const completed = await status.api.inspectVideo(taskId); assert.equal(completed.state, 'completed'); assert.equal(completed.outputUrl, outputUrl);
  status.handle(() => Response.json({ id: taskId, status: 'FAILED', failure: secret, failureCode: secret }));
  assert.deepEqual(JSON.parse(JSON.stringify(await status.api.inspectVideo(taskId))), { state: 'failed', errorCode: 'media_ai_video_failed' });
  status.handle(() => Response.json({ id: taskId, status: 'CANCELLED' })); assert.equal((await status.api.inspectVideo(taskId)).state, 'cancelled');
  for (const payload of [{ id: taskId, status: 'UNKNOWN' }, { id: 'other-tenant-task', status: 'SUCCEEDED', output: [outputUrl] }, { id: taskId, status: 'SUCCEEDED', output: [] }]) {
    status.handle(() => Response.json(payload)); await rejects(() => status.api.inspectVideo(taskId), 'media_ai_invalid_response', false);
  }
  const previous = status.calls.length;
  for (const id of ['../foo', `${taskId}?foo=bar`, '', secret, undefined]) await rejects(() => status.api.inspectVideo(id), 'media_ai_invalid_task_id', false);
  assert.equal(status.calls.length, previous);
  status.handle(() => new Response(secret, { status: 500 })); await rejects(() => status.api.inspectVideo(taskId), 'media_ai_provider_unavailable', false);
  assert.ok(status.calls.every(call => call.url === `https://api.dev.runwayml.com/v1/tasks/${taskId}`));

  const downloads = harness({ handler: () => new Response(mp4, { headers: { 'Content-Type': 'video/mp4' } }) });
  const downloaded = await downloads.api.downloadVideo(outputUrl); assert.deepEqual(Buffer.from(downloaded.bytes), mp4); assert.equal(downloaded.contentType, 'video/mp4');
  assert.equal(downloads.calls[0].request.headers, undefined, 'Provider key is never forwarded to CDN');
  assert.equal(downloads.calls[0].request.redirect, 'error'); assert.equal(downloads.calls[0].request.referrerPolicy, 'no-referrer');
  for (const url of ['http://dnznrvs05pmza.cloudfront.net/output.mp4', 'https://dnznrvs05pmza.cloudfront.net.attacker.example/output.mp4', 'https://another.cloudfront.net/output.mp4', 'https://127.0.0.1/output.mp4', 'https://169.254.169.254/latest/meta-data/', 'https://user:pass@dnznrvs05pmza.cloudfront.net/output.mp4', 'https://dnznrvs05pmza.cloudfront.net:8443/output.mp4', `${outputUrl}#fragment`, 'https://dnznrvs05pmza.cloudfront.net./output.mp4', 'https://dnznrvs05pmza.cloudfront.net\\@attacker.example/output.mp4', 'data:video/mp4;base64,AAAA', 'file:///etc/passwd', 'not-a-url']) {
    await rejects(() => downloads.api.downloadVideo(url), 'media_ai_unsafe_output_url', false);
    status.handle(() => Response.json({ id: taskId, status: 'SUCCEEDED', output: [url] }));
    await rejects(() => status.api.inspectVideo(taskId), 'media_ai_unsafe_output_url', false);
  }
  assert.equal(downloads.calls.length, 1, 'Unsafe URLs are rejected before fetch');
  downloads.handle(() => new Response(mp4, { headers: { 'Content-Type': 'application/octet-stream' } })); await downloads.api.downloadVideo(outputUrl);
  downloads.handle(() => new Response(mp4, { headers: { 'Content-Type': 'text/html' } })); await rejects(() => downloads.api.downloadVideo(outputUrl), 'media_ai_invalid_output', false);
  downloads.handle(() => new Response(secret, { headers: { 'Content-Type': 'video/mp4' } })); await rejects(() => downloads.api.downloadVideo(outputUrl), 'media_ai_invalid_output', false);
  downloads.handle(() => new Response(mp4, { status: 302, headers: { Location: 'http://169.254.169.254/', 'Content-Type': 'video/mp4' } })); await rejects(() => downloads.api.downloadVideo(outputUrl), 'media_ai_request_rejected', false);
  downloads.handle(() => new Response(mp4, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(30_000_001) } })); await rejects(() => downloads.api.downloadVideo(outputUrl), 'media_ai_output_too_large', false);
  let cancelled = false;
  downloads.handle(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024)); controller.enqueue(new Uint8Array(16 * 1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': '24' } }));
  await rejects(() => downloads.api.downloadVideo(outputUrl), 'media_ai_output_too_large', false); assert.ok(cancelled, 'Streaming size limit wins over a forged content length');
  const stalledDownload = harness({ handler: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(mp4); } }), { headers: { 'Content-Type': 'video/mp4' } }), setTimeout: callback => setTimeout(callback, 0) });
  await rejects(() => stalledDownload.api.downloadVideo(outputUrl), 'media_ai_request_timeout', false);

  console.log('PASS media AI providers: exact OpenAI/Runway requests, bounded streams, stable sanitized errors, no create retry, abort/timeout ambiguity, task identity, isolated CDN download and SSRF rejection. No real provider calls.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
