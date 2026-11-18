// Real Sharp decoding + mocked private Storage HTTP. No live assets, keys or paid calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const sharp = require('sharp');
const { createHash } = require('node:crypto');
const company = '26d30f4a-275b-4c10-ae80-c09d438fb3d8';
const job = 'b669fe59-07f6-40ee-9fd1-33433f61321f';
const syntheticKey = 'synthetic-storage-service-secret';

function load(relative, requireModule, globals = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: requireModule, Buffer, Uint8Array, URL, Error, Response, Request, Headers, ReadableStream, TransformStream, AbortController, AbortSignal, process: { env: {} }, fetch: () => assert.fail('No network allowed'), ...globals });
  return module.exports;
}
const websiteModel = load('../lib/website/model.ts', name => assert.fail(`Unexpected website model dependency ${name}`));
const websiteMedia = load('../lib/website/media.ts', name => name === './model' ? websiteModel : name === 'node:crypto' ? require(name) : assert.fail(`Unexpected website media dependency ${name}`));
const model = load('../lib/media-studio/model.ts', name => name === '../website/media' ? websiteMedia : name === 'sharp' ? sharp : name === 'node:crypto' ? require(name) : assert.fail(`Unexpected media model dependency ${name}`));
function storageHarness(handler, env = { SUPABASE_URL: 'https://storage.example.test', SUPABASE_SECRET_KEY: syntheticKey }) {
  const calls = [];
  const api = load('../lib/media-studio/storage.ts', name => name === './model' ? model : assert.fail(`Unexpected storage dependency ${name}`), {
    process: { env }, fetch: async (url, options) => { calls.push({ url, options }); return handler(url, options); },
  });
  return { api, calls };
}
const code = expected => error => { assert.equal(error.code, expected); assert(!String(error).includes(syntheticKey)); return true; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const dataUrl = bytes => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
function bodyRequest(chunks, headers = {}) {
  let cursor = 0, cancelled = false;
  const body = new ReadableStream({ pull(controller) { if (cursor === chunks.length) controller.close(); else controller.enqueue(new Uint8Array(chunks[cursor++])); }, cancel() { cancelled = true; } });
  return { request: { headers: new Headers({ 'Content-Type': 'application/json', ...headers }), body }, wasCancelled: () => cancelled };
}
function streamingResponse(bytes, options = {}) {
  const chunkSize = 64 * 1024; let cursor = 0, pulls = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulls++; if (cursor >= bytes) { controller.close(); return; } const size = Math.min(chunkSize, bytes - cursor); cursor += size; controller.enqueue(new Uint8Array(size).fill(37)); },
    cancel() { cancelled = true; },
  });
  const response = new Response(stream, { status: options.status || 200, headers: { 'Content-Type': options.type || 'video/mp4', ...(options.length === null ? {} : { 'Content-Length': String(options.length ?? bytes) }) } });
  response.arrayBuffer = () => assert.fail('The private download must not buffer the entire video');
  response.blob = () => assert.fail('The private download must stream directly');
  return { response, pulled: () => pulls, wasCancelled: () => cancelled };
}

async function testModel() {
  const source = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#699384' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const before = digest(source);
  const normalized = await model.normalizeMediaImage(source);
  const meta = await sharp(normalized.bytes).metadata();
  assert.equal(normalized.contentType, 'image/jpeg'); assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 120); assert.equal(meta.height, 80, 'EXIF rotation is physically applied');
  assert.equal(meta.orientation, undefined); assert.equal(meta.exif, undefined, 'Private EXIF metadata is stripped'); assert.equal(digest(source), before, 'Normalization leaves the submitted bytes immutable');
  const large = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#ccc' } }).png().toBuffer();
  const resized = await sharp((await model.normalizeMediaImage(large)).bytes).metadata();
  assert.equal(resized.width, 1600); assert.equal(resized.height, 800);
  const small = await sharp({ create: { width: 63, height: 100, channels: 3, background: '#abc' } }).png().toBuffer();
  const excessPixels = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: '#eee' } }).png().toBuffer();
  for (const invalid of [Buffer.from('<html>not a photo</html>'), Buffer.from([255, 216, 255, 0]), small, excessPixels, Buffer.from('<svg width="100" height="100"><rect width="100" height="100"/></svg>')]) {
    await assert.rejects(model.normalizeMediaImage(invalid), code('media_ai_invalid_input'));
  }
  await assert.rejects(model.normalizeMediaImage(Buffer.from('broken'), true), code('media_ai_invalid_output'));
  const frames = Buffer.alloc(64 * 128 * 3); frames.fill(40, 0, 64 * 64 * 3); frames.fill(220, 64 * 64 * 3);
  const animated = await sharp(frames, { raw: { width: 64, height: 128, channels: 3, pageHeight: 64 } }).webp({ lossless: true, loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2, 'Synthetic WebP contains two real frames');
  await assert.rejects(model.normalizeMediaImage(animated), code('media_ai_invalid_input'));

  const payload = { requestId: job.toUpperCase(), kind: 'photo', propertyId: 'demo-casa-jardim', photoIndex: 0, format: 'portrait', imageDataUrl: dataUrl(source) };
  const parsed = model.parseMediaRequest(payload);
  assert.equal(parsed.requestId, job); assert.equal(parsed.hash.length, 64); assert.equal(digest(parsed.image.bytes), before);
  assert.equal(model.parseMediaRequest({ ...payload, requestId: company }).hash, parsed.hash, 'Idempotency content hash does not depend on request ID');
  assert.equal(model.parseMediaRequest({ ...payload }).hash, parsed.hash, 'Identical requests retain the same hash');
  const otherPhoto = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#cba' } }).jpeg().toBuffer();
  for (const patch of [{ kind: 'video' }, { photoIndex: 1 }, { format: 'landscape' }, { propertyId: 'demo-casa-verde' }, { imageDataUrl: dataUrl(otherPhoto) }]) assert.notEqual(model.parseMediaRequest({ ...payload, ...patch }).hash, parsed.hash);
  for (const patch of [{ companyId: company }, { provider: 'other' }, { prompt: 'change the house' }, { actorId: company }, { photoIndex: -1 }, { photoIndex: 3 }, { photoIndex: 1.2 }, { kind: 'audio' }, { propertyId: company }, { format: 'square' }, { requestId: '../request' }]) assert.throws(() => model.parseMediaRequest({ ...payload, ...patch }), code('media_invalid_request'));
  for (const value of [null, [], {}, 'photo']) assert.throws(() => model.parseMediaRequest(value), code('media_invalid_request'));
  for (const value of ['https://images.example.test/photo.jpg', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/jpeg;base64,bm90LWpwZWc=', `data:image/png;base64,${source.toString('base64')}`, dataUrl(Buffer.alloc(2 * 1024 * 1024 + 1, 255))]) assert.throws(() => model.parseMediaRequest({ ...payload, imageDataUrl: value }), code('media_ai_invalid_input'));
  const exact = bodyRequest([Buffer.from('{"ok":'), Buffer.from('true}')]); assert.equal((await model.readMediaJson(exact.request)).ok, true);
  const wrongType = bodyRequest([Buffer.from('{}')], { 'Content-Type': 'text/plain' }); await assert.rejects(model.readMediaJson(wrongType.request), error => error.status === 415);
  const declared = bodyRequest([Buffer.from('{}')], { 'Content-Length': String(model.MEDIA_BODY_LIMIT + 1) }); await assert.rejects(model.readMediaJson(declared.request), error => error.status === 413);
  const lying = bodyRequest([Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)], { 'Content-Length': '1' }); await assert.rejects(model.readMediaJson(lying.request, 10), error => error.status === 413); assert(lying.wasCancelled(), 'Oversized chunked body is cancelled even when Content-Length lies');
  const malformed = bodyRequest([Buffer.from('{oops')]); await assert.rejects(model.readMediaJson(malformed.request), code('media_invalid_request'));
}

async function testStorage() {
  const validPath = `${company}/${job}/result.mp4`;
  const success = storageHarness(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  assert.equal(success.api.mediaStoragePath(company, job, 'result.mp4'), validPath);
  assert.throws(() => success.api.mediaStoragePath('../other', job, 'result.mp4'), code('media_forbidden'));
  await success.api.storeMediaFile(validPath, new Uint8Array([0, 1, 2, 3]), 'video/mp4');
  const call = success.calls[0]; assert.equal(call.url, `https://storage.example.test/storage/v1/object/media-ai/${validPath}`); assert(!call.url.includes('/public/')); assert(!call.url.includes(syntheticKey));
  assert.equal(call.options.method, 'POST'); assert.equal(call.options.redirect, 'error'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.headers.Authorization, `Bearer ${syntheticKey}`); assert.equal(call.options.headers['Content-Type'], 'video/mp4');
  for (const unsafe of [`../${validPath}`, `${company}/${job}/../../other`, `${company}/${job}/result.svg`, `${company}/${job}/result.mp4?token=1`, `public/${validPath}`, `${company}/${job}/%2e%2e`]) await assert.rejects(success.api.storeMediaFile(unsafe, new Uint8Array([1]), 'video/mp4'), code('media_forbidden'));
  assert.equal(success.calls.length, 1, 'Invalid storage paths never reach fetch');
  await assert.rejects(success.api.storeMediaFile(validPath, new Uint8Array(), 'video/mp4'), code('media_ai_output_too_large'));
  await assert.rejects(success.api.storeMediaFile(validPath, new Uint8Array(model.MEDIA_RESULT_LIMIT + 1), 'video/mp4'), code('media_ai_output_too_large'));
  const notConfigured = storageHarness(() => assert.fail('Missing credentials cannot reach storage'), {}); await assert.rejects(notConfigured.api.storeMediaFile(validPath, new Uint8Array([1]), 'video/mp4'), code('media_storage_unavailable'));
  const insecure = storageHarness(() => assert.fail('Insecure storage cannot receive credentials'), { SUPABASE_URL: 'http://storage.example.test', SUPABASE_SECRET_KEY: syntheticKey }); await assert.rejects(insecure.api.storeMediaFile(validPath, new Uint8Array([1]), 'video/mp4'), code('media_storage_unavailable'));

  // A 6 MB result exceeds Vercel's 4.5 MB buffered response limit: return the stream,
  // without buffering/signing/publicizing its object or forwarding service headers.
  const size = 6 * 1024 * 1024, upstream = streamingResponse(size);
  const streaming = storageHarness(() => upstream.response);
  const result = await streaming.api.streamMediaFile(validPath, 'video/mp4', size);
  assert(upstream.pulled() < size / (64 * 1024), 'The route returns before the whole video is read');
  assert.equal(result.headers.get('Content-Type'), 'video/mp4'); assert.equal(result.headers.get('Cache-Control'), 'private, no-store'); assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(result.headers.get('Content-Length'), String(size));
  assert.equal(result.headers.get('Location'), null); assert.equal(result.headers.get('Authorization'), null); assert.equal(result.headers.get('apikey'), null); assert(!JSON.stringify([...result.headers]).includes(syntheticKey));
  const reader = result.body.getReader(); let received = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; received += value.length; assert.equal(value[0], 37); assert(value.length <= 64 * 1024); }
  assert.equal(received, size);
  for (const options of [{ type: 'text/html' }, { length: 20 }, { length: 0 }, { status: 404 }]) {
    const invalid = streamingResponse(10, options); const h = storageHarness(() => invalid.response);
    await assert.rejects(h.api.streamMediaFile(validPath, 'video/mp4', 10), code('media_storage_unavailable')); assert(invalid.wasCancelled());
  }
  for (const actual of [9, 11]) {
    const invalid = streamingResponse(actual, { length: 10 }); const h = storageHarness(() => invalid.response); const response = await h.api.streamMediaFile(validPath, 'video/mp4', 10);
    await assert.rejects(response.arrayBuffer(), /incomplete_media|invalid_media_size/, 'Actual stream length must match the recorded job, even if headers lie');
  }
  const noLength = streamingResponse(10, { length: null }); const h = storageHarness(() => noLength.response); assert.equal((await (await h.api.streamMediaFile(validPath, 'video/mp4', 10)).arrayBuffer()).byteLength, 10);
  const interrupted = streamingResponse(size); const c = storageHarness(() => interrupted.response); const download = await c.api.streamMediaFile(validPath, 'video/mp4', size); await download.body.cancel(); await tick(); assert(interrupted.wasCancelled(), 'Client cancellation propagates to private storage');
  const failing = storageHarness(() => { throw new Error(`provider raw secret ${syntheticKey}`); });
  await assert.rejects(failing.api.streamMediaFile(validPath, 'video/mp4', 10), code('media_storage_unavailable'));
  await assert.rejects(failing.api.storeMediaFile(validPath, new Uint8Array([1]), 'video/mp4'), code('media_storage_unavailable'));

  await success.api.removeMediaFiles(company, job);
  const removal = success.calls.at(-1); assert.equal(removal.options.method, 'DELETE'); assert.equal(removal.url, 'https://storage.example.test/storage/v1/object/media-ai');
  assert.deepEqual(JSON.parse(removal.options.body), { prefixes: [`${company}/${job}/input.jpg`, `${company}/${job}/result.jpg`, `${company}/${job}/result.mp4`] }, 'Cleanup deletes only the three exact private object paths, never a company prefix');
  const priorCalls = success.calls.length; await assert.rejects(success.api.removeMediaFiles(company, '../another-job'), code('media_forbidden')); assert.equal(success.calls.length, priorCalls);
}

(async () => { await testModel(); await testStorage(); console.log('PASS media AI model/storage: real Sharp raster/frame/pixel validation and EXIF normalization; strict scoped input/hash/body limits; private bounded 6 MB streaming without buffering or public URLs; MIME/size checks and exact-file cleanup. Synthetic media and mocked storage only.'); })().catch(error => { console.error(error); process.exitCode = 1; });
