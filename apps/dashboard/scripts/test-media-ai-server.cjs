// In-memory database/provider/storage doubles; actual image decoding uses sharp.
// No network, credentials, paid jobs, database mutations, or customer data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');
const ts = require('typescript');
const sharp = require('sharp');
const root = path.join(__dirname, '..');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = { companyId: uuid(1), brokerId: uuid(2), role: 'owner', name: 'Synthetic', company: 'Synthetic company' };
const otherOwner = { ...owner, companyId: uuid(3), brokerId: uuid(4) };
const taskId = uuid(5), privateUrl = 'https://dnznrvs05pmza.cloudfront.net/synthetic.mp4';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
class ProviderError extends Error { constructor(code, ambiguous = false) { super(code); this.code = code; this.ambiguous = ambiguous; } }
class NextResponse extends Response { static json(value, init) { return Response.json(value, init); } }
class NextRequest extends Request {
  constructor(url, options) { super(url, options); this.nextUrl = new URL(url); this.cookies = { get: name => name === 'imobflow_session' && this.headers.get('cookie') === 'valid' ? { value: 'a'.repeat(64) } : undefined }; }
}
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports, require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    Buffer, Uint8Array, ArrayBuffer, URL, URLSearchParams, Response, Request, TransformStream, ReadableStream,
    AbortSignal, AbortController, Error, Date, setTimeout, clearTimeout, process: { env: {} }, ...globals,
  }, { filename: file });
  return module.exports;
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function rejects(work, code, status) {
  await assert.rejects(work, error => { assert.equal(error.code, code); if (status) assert.equal(error.status, status); return true; });
}

function harness(fixture) {
  const context = new AsyncLocalStorage();
  const state = {
    actor: owner, now: Date.parse('2026-11-17T12:00:00Z'), jobs: [], files: new Map(),
    plan: { enabled: true, photo_enabled: true, video_enabled: true, photo_daily_limit: 3, video_daily_limit: 1 },
    calls: { db: [], photo: 0, start: 0, inspect: [], download: [], store: [], stream: [], remove: [] },
    env: { MEDIA_AI_OPENAI_KEY: 'synthetic-image', RUNWAYML_API_SECRET: 'synthetic-video' },
    photo: async () => ({ bytes: fixture, contentType: 'image/jpeg', provider: 'openai', model: 'gpt-image-2.6-sunburst', usage: { output_tokens: 1 } }),
    video: async () => ({ taskId, provider: 'runway', model: 'gen4_turbo' }),
    inspect: async () => ({ state: 'processing', progress: 0.5 }),
    download: async () => ({ bytes: Uint8Array.from([0, 1, 2, 3]), contentType: 'video/mp4' }),
    beforeDb: null, beforeStore: null,
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } }
  const website = load('lib/website/media.ts', { './model': { WebsiteError: class extends Error {} } });
  const model = load('lib/media-studio/model.ts', { '../website/media': website }, { Date: Clock });
  const tenant = { currentAccount: () => context.getStore(), withAccount: (account, run) => context.run(account, run) };
  function newJob(body) {
    return {
      id: uuid(100 + state.jobs.length), company_id: body.p_company_id, actor_id: body.p_actor_id,
      request_id: body.p_request_id, request_hash: body.p_request_hash, kind: body.p_kind,
      property_id: body.p_property_id, photo_index: body.p_photo_index, format: body.p_format,
      provider: body.p_provider, model: body.p_model, status: 'reserved', provider_task_id: null,
      input_path: null, result_path: null, result_mime: null, result_bytes: null, provider_usage: null, error_code: null,
      created_at: new Clock().toISOString(), updated_at: new Clock().toISOString(),
      expires_at: new Clock(state.now + 7 * 86400000).toISOString(), poll_after: new Clock().toISOString(), purged_at: null,
    };
  }
  async function db(url, options = {}) {
    state.calls.db.push({ url, options: clone(options) });
    if (state.beforeDb) await state.beforeDb(url, options);
    const body = options.body;
    if (url === 'rpc/account_session') {
      if (!state.actor) return [];
      return [{ broker_id: state.actor.brokerId, company_id: state.actor.companyId, name: state.actor.name, company: state.actor.company, role: state.actor.role }];
    }
    if (url.startsWith('rpc/')) {
      assert.equal(body.p_company_id, context.getStore().companyId);
      assert.equal(body.p_actor_id, context.getStore().brokerId);
      if (!state.plan?.enabled) throw new Error('media_not_enabled');
      if (url === 'rpc/reserve_media_ai_job') {
        let row = state.jobs.find(job => job.company_id === body.p_company_id && job.actor_id === body.p_actor_id && job.request_id === body.p_request_id);
        if (row && row.request_hash !== body.p_request_hash) throw new Error('media_request_conflict');
        if (row) return { job: clone(row), reused: true };
        row = newJob(body); state.jobs.push(row); return { job: clone(row), reused: false };
      }
      assert.equal(url, 'rpc/claim_media_ai_job');
      const row = state.jobs.find(job => job.id === body.p_job_id && job.company_id === body.p_company_id && job.actor_id === body.p_actor_id);
      if (!row || row.status !== 'reserved' || Date.parse(row.expires_at) <= state.now) return null;
      row.status = 'submitting'; row.updated_at = new Clock().toISOString(); return clone(row);
    }
    const [table, query] = url.split('?'), params = new URLSearchParams(query);
    if (table === 'media_ai_entitlements') {
      assert.equal(params.get('company_id'), `eq.${context.getStore().companyId}`);
      return state.plan ? [clone(state.plan)] : [];
    }
    assert.equal(table, 'media_ai_jobs');
    const rows = state.jobs.filter(row => [...params.entries()].every(([key, expression]) => {
      if (['select', 'order', 'limit'].includes(key)) return true;
      const index = expression.indexOf('.'), operator = expression.slice(0, index), value = expression.slice(index + 1);
      if (operator === 'eq') return String(row[key]) === value;
      if (operator === 'is') return value === 'null' && row[key] === null;
      if (operator === 'not') return value === 'is.null' && row[key] !== null;
      if (operator === 'gt') return Date.parse(row[key]) > Date.parse(value);
      if (operator === 'lt') return Date.parse(row[key]) < Date.parse(value);
      if (operator === 'lte') return Date.parse(row[key]) <= Date.parse(value);
      throw new Error(`Unsupported synthetic filter ${operator}`);
    }));
    if (options.method === 'PATCH') for (const row of rows) Object.assign(row, clone(body), { updated_at: new Clock().toISOString() });
    return clone(rows.slice(0, Number(params.get('limit') || rows.length)));
  }
  const storageModule = load('lib/media-studio/storage.ts', { './model': model });
  const storage = {
    mediaStoragePath: storageModule.mediaStoragePath,
    storeMediaFile: async (name, bytes, type) => {
      state.calls.store.push({ name, type }); if (state.beforeStore) await state.beforeStore(name, bytes, type);
      state.files.set(name, { bytes, type });
    },
    streamMediaFile: async (name, type, bytes) => {
      state.calls.stream.push({ name, type, bytes }); assert.ok(state.files.has(name));
      return new Response(state.files.get(name).bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store' } });
    },
    removeMediaFiles: async (companyId, jobId) => {
      state.calls.remove.push({ companyId, jobId });
      for (const name of ['input.jpg', 'result.jpg', 'result.mp4']) state.files.delete(storageModule.mediaStoragePath(companyId, jobId, name));
    },
  };
  const providers = {
    MediaProviderError: ProviderError,
    enhancePhoto: async (...args) => { state.calls.photo++; return state.photo(...args); },
    startVideo: async (...args) => { state.calls.start++; return state.video(...args); },
    inspectVideo: async id => { state.calls.inspect.push(id); return state.inspect(id); },
    downloadVideo: async url => { state.calls.download.push(url); return state.download(url); },
  };
  const rawServer = load('lib/media-studio/server.ts', { '../tenant-context': tenant, '../supabase': { supabaseServiceRequest: db }, './model': model, './providers': providers, './storage': storage }, { Date: Clock, process: { env: state.env } });
  const server = Object.fromEntries(Object.entries(rawServer).map(([name, method]) => [name, (...args) => context.run(state.actor, () => method(...args))]));
  const security = load('lib/request-security.ts', { './supabase': { supabaseRequest: db } });
  const http = load('lib/media-studio/http.ts', { './model': model, '../request-security': security, 'next/server': { NextResponse, NextRequest } });
  const accounts = load('lib/accounts.ts', { './supabase': { supabaseRequest: db }, './tenant-context': tenant, 'next/server': { NextResponse, NextRequest } });
  const route = file => load(file, { '@/lib/accounts': accounts, '@/lib/media-studio/model': model, '@/lib/media-studio/http': http, '@/lib/media-studio/server': rawServer, 'next/server': { NextResponse, NextRequest } }, { process: { env: state.env } });
  return { state, server, model, http, storageModule, route };
}

async function main() {
  const fixture = await sharp({ create: { width: 80, height: 64, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
  const fixture2 = await sharp({ create: { width: 80, height: 64, channels: 3, background: '#abcdef' } }).jpeg().toBuffer();
  const request = (number = 10, kind = 'photo') => ({ requestId: uuid(number), kind, propertyId: 'demo-casa-jardim', photoIndex: 0, format: 'landscape', imageDataUrl: `data:image/jpeg;base64,${fixture.toString('base64')}` });

  const denied = harness(fixture);
  for (const actor of [null, { ...owner, role: 'broker' }, { ...owner, companyId: 'demo-company' }, { ...owner, brokerId: 'demo-owner' }]) {
    denied.state.actor = actor;
    for (const run of [() => denied.server.mediaStudioStatus(), () => denied.server.createMediaJob(request()), () => denied.server.readMediaJob(uuid(100))]) await rejects(run, 'media_forbidden', 403);
  }
  assert.equal(denied.state.calls.db.length, 0); assert.equal(denied.state.calls.photo, 0);
  const eligibility = harness(fixture);
  eligibility.state.plan.enabled = false; await rejects(() => eligibility.server.createMediaJob(request()), 'media_not_enabled', 403);
  eligibility.state.plan.enabled = true; eligibility.state.plan.photo_enabled = false;
  await rejects(() => eligibility.server.createMediaJob(request()), 'media_feature_disabled', 403);
  eligibility.state.plan.photo_enabled = true; delete eligibility.state.env.MEDIA_AI_OPENAI_KEY;
  await rejects(() => eligibility.server.createMediaJob(request()), 'media_ai_openai_not_configured', 503);
  assert.equal(eligibility.state.jobs.length, 0, 'No reservation or charge without enablement/key');

  const single = harness(fixture);
  const job = await single.server.createMediaJob(request()); assert.equal(job.status, 'completed');
  assert.equal(single.state.calls.photo, 1); assert.equal(single.state.jobs.length, 1);
  assert.equal(job.result_path, `${owner.companyId}/${job.id}/result.jpg`);
  assert.equal((await single.server.createMediaJob(request())).id, job.id); assert.equal(single.state.calls.photo, 1);
  await rejects(() => single.server.createMediaJob({ ...request(), imageDataUrl: `data:image/jpeg;base64,${fixture2.toString('base64')}` }), 'media_request_conflict', 409);
  await rejects(() => single.server.createMediaJob({ ...request(), format: 'portrait' }), 'media_request_conflict', 409);
  single.state.plan.enabled = false; delete single.state.env.MEDIA_AI_OPENAI_KEY;
  assert.equal((await single.server.createMediaJob(request())).id, job.id, 'Revoking generation still allows idempotent recovery');
  const view = single.model.jobView(job);
  for (const key of ['company_id', 'actor_id', 'request_hash', 'provider_task_id', 'input_path', 'result_path', 'provider_usage']) assert.equal(view[key], undefined);
  assert.equal(view.resultAvailable, true);
  const result = await single.server.mediaJobResult(job.id); assert.equal(result.headers.get('cache-control'), 'private, no-store'); await result.arrayBuffer();
  single.state.actor = otherOwner;
  await rejects(() => single.server.readMediaJob(job.id), 'media_not_found', 404);
  await rejects(() => single.server.mediaJobResult(job.id), 'media_not_found', 404);
  single.state.actor = { ...owner, brokerId: uuid(90) }; await rejects(() => single.server.readMediaJob(job.id), 'media_not_found', 404);
  single.state.actor = owner;
  const row = single.state.jobs[0], actualPath = row.result_path;
  row.result_path = `${otherOwner.companyId}/${row.id}/result.jpg`;
  await rejects(() => single.server.mediaJobResult(row.id), 'media_not_found', 404); row.result_path = actualPath;
  row.result_mime = 'text/html'; await rejects(() => single.server.mediaJobResult(row.id), 'media_not_found', 404); row.result_mime = 'image/jpeg';
  single.state.now += 8 * 86400000;
  await rejects(() => single.server.mediaJobResult(row.id), 'media_expired', 410);
  assert.equal(single.model.jobView(row).resultAvailable, false);

  const concurrent = harness(fixture), entered = deferred(), release = deferred();
  concurrent.state.photo = async () => { entered.resolve(); await release.promise; return { bytes: fixture }; };
  const first = concurrent.server.createMediaJob(request()), second = concurrent.server.createMediaJob(request());
  await entered.promise;
  const reused = await Promise.race([first, second]); assert.equal(reused.status, 'submitting'); assert.equal(concurrent.state.calls.photo, 1);
  release.resolve(); assert.ok((await Promise.all([first, second])).some(row => row.status === 'completed'));
  assert.equal(concurrent.state.jobs.length, 1); assert.equal(concurrent.state.calls.photo, 1, 'Concurrent callers share the durable claim');
  assert.equal(concurrent.state.calls.store.filter(item => item.name.endsWith('/input.jpg')).length, 1);

  const ambiguous = harness(fixture);
  ambiguous.state.photo = async () => { throw new ProviderError('media_ai_request_timeout', true); };
  assert.equal((await ambiguous.server.createMediaJob(request())).status, 'unknown');
  assert.equal((await ambiguous.server.createMediaJob(request())).status, 'unknown'); assert.equal(ambiguous.state.calls.photo, 1);
  const rejected = harness(fixture);
  rejected.state.photo = async () => { throw new ProviderError('media_ai_authentication_failed', false); };
  assert.equal((await rejected.server.createMediaJob(request())).status, 'failed');
  await rejected.server.createMediaJob(request()); assert.equal(rejected.state.calls.photo, 1, 'Definitive failure also retains its request ID');
  const failedStorage = harness(fixture);
  failedStorage.state.beforeStore = async () => { throw new Error('synthetic-private-diagnostic'); };
  const failedInput = await failedStorage.server.createMediaJob(request()); assert.equal(failedInput.status, 'failed'); assert.equal(failedStorage.state.calls.photo, 0);
  assert.equal(failedInput.error_code, 'media_storage_unavailable');
  const revoked = harness(fixture);
  revoked.state.beforeStore = async () => { revoked.state.plan.enabled = false; };
  const revokedJob = await revoked.server.createMediaJob(request());
  assert.equal(revokedJob.status, 'failed'); assert.equal(revokedJob.error_code, 'media_not_enabled');
  assert.equal(revoked.state.calls.photo, 0, 'Recheck entitlement after reservation and input upload, before provider spending');
  const stale = harness(fixture);
  stale.state.photo = async () => { throw new ProviderError('media_ai_network_error', true); };
  const staleRow = await stale.server.createMediaJob(request()); stale.state.jobs[0].status = 'submitting'; stale.state.now += 6 * 60000;
  assert.equal(stale.model.jobView(stale.state.jobs[0]).status, 'unknown');
  assert.equal((await stale.server.refreshMediaJob(staleRow.id)).status, 'unknown'); assert.equal(stale.state.calls.photo, 1);

  const video = harness(fixture);
  const videoJob = await video.server.createMediaJob(request(11, 'video')); assert.equal(videoJob.status, 'processing'); assert.equal(videoJob.provider_task_id, taskId);
  await video.server.refreshMediaJob(videoJob.id); assert.equal(video.state.calls.inspect.length, 0, 'Respect initial polling interval');
  video.state.now += 7000;
  const pollEntered = deferred(), pollRelease = deferred();
  video.state.inspect = async () => { pollEntered.resolve(); await pollRelease.promise; return { state: 'processing' }; };
  const pollA = video.server.refreshMediaJob(videoJob.id); await pollEntered.promise;
  const pollB = await video.server.refreshMediaJob(videoJob.id); assert.equal(pollB.status, 'processing'); assert.equal(video.state.calls.inspect.length, 1);
  pollRelease.resolve(); await pollA;
  video.state.now += 7000;
  video.state.inspect = async () => ({ state: 'completed', outputUrl: privateUrl });
  let failDownload = true;
  video.state.download = async () => { if (failDownload) throw new ProviderError('media_ai_network_error'); return { bytes: Uint8Array.from([0, 1, 2, 3]), contentType: 'video/mp4' }; };
  const recovering = await video.server.refreshMediaJob(videoJob.id); assert.equal(recovering.status, 'processing'); assert.equal(recovering.provider_task_id, taskId);
  video.state.now += 31000; failDownload = false;
  const finalVideo = await video.server.refreshMediaJob(videoJob.id); assert.equal(finalVideo.status, 'completed'); assert.equal(video.state.calls.start, 1);
  assert.ok(video.state.calls.inspect.every(id => id === taskId)); assert.ok(video.state.calls.download.every(url => url === privateUrl));
  assert.equal(finalVideo.result_path, `${owner.companyId}/${videoJob.id}/result.mp4`);
  await video.server.createMediaJob(request(11, 'video')); assert.equal(video.state.calls.start, 1);

  // Known task ID must survive a transient failure in the first database save.
  const persistence = harness(fixture); let failSave = true;
  persistence.state.beforeDb = async (_url, options) => {
    if (failSave && options.method === 'PATCH' && options.body?.provider_task_id === taskId) { failSave = false; throw new Error('synthetic-db-outage'); }
  };
  const recoveredTask = await persistence.server.createMediaJob(request(12, 'video'));
  assert.equal(recoveredTask.provider_task_id, taskId, 'Keep an acknowledged provider task when the first persistence attempt fails');
  assert.equal(recoveredTask.status, 'processing');
  await persistence.server.createMediaJob(request(12, 'video')); assert.equal(persistence.state.calls.start, 1);

  const savedPhoto = harness(fixture); let failPhotoSave = true;
  savedPhoto.state.beforeDb = async (_url, options) => {
    if (failPhotoSave && options.method === 'PATCH' && options.body?.status === 'completed') { failPhotoSave = false; throw new Error('synthetic-db-outage'); }
  };
  assert.equal((await savedPhoto.server.createMediaJob(request(13))).status, 'completed');
  await savedPhoto.server.createMediaJob(request(13)); assert.equal(savedPhoto.state.calls.photo, 1);

  // A stale worker cannot overwrite the newer worker's poll lease or terminal state.
  const fenced = harness(fixture), staleEntered = deferred(), staleRelease = deferred();
  const fencedJob = await fenced.server.createMediaJob(request(14, 'video')); fenced.state.now += 7000;
  fenced.state.inspect = async () => {
    if (fenced.state.calls.inspect.length === 1) { staleEntered.resolve(); await staleRelease.promise; return { state: 'failed', errorCode: 'media_ai_video_failed' }; }
    return { state: 'processing' };
  };
  const stalePoll = fenced.server.refreshMediaJob(fencedJob.id); await staleEntered.promise;
  fenced.state.now += 181000;
  await fenced.server.refreshMediaJob(fencedJob.id);
  const newerLease = fenced.state.jobs[0].poll_after;
  staleRelease.resolve(); await stalePoll;
  assert.equal(fenced.state.jobs[0].status, 'processing'); assert.equal(fenced.state.jobs[0].poll_after, newerLease);
  assert.equal(fenced.state.jobs[0].error_code, null); assert.equal(fenced.state.calls.start, 1);

  // The system recovery worker establishes each job's tenant context and only
  // retrieves tasks that already exist; no browser session or new charge is needed.
  const background = harness(fixture);
  background.state.video = async () => ({ taskId: uuid(500 + background.state.calls.start), provider: 'runway', model: 'gen4_turbo' });
  const backgroundA = await background.server.createMediaJob(request(15, 'video'));
  background.state.actor = otherOwner;
  const backgroundB = await background.server.createMediaJob(request(16, 'video'));
  background.state.actor = null; background.state.now += 7000;
  background.state.inspect = async () => ({ state: 'completed', outputUrl: privateUrl });
  const collected = await background.server.recoverMediaVideos();
  assert.equal(collected.completed, 2); assert.equal(background.state.calls.start, 2);
  assert.deepEqual(new Set(background.state.calls.inspect), new Set([backgroundA.provider_task_id, backgroundB.provider_task_id]));
  assert.ok(background.state.files.has(`${owner.companyId}/${backgroundA.id}/result.mp4`));
  assert.ok(background.state.files.has(`${otherOwner.companyId}/${backgroundB.id}/result.mp4`));
  assert.equal((await background.server.recoverMediaVideos()).checked, 0);

  const invalidImage = harness(fixture);
  await rejects(() => invalidImage.server.createMediaJob({ ...request(17), imageDataUrl: 'data:image/jpeg;base64,/9j/4AAA' }), 'media_ai_invalid_input');
  assert.equal(invalidImage.state.jobs.length, 0); assert.equal(invalidImage.state.calls.photo, 0, 'Signature-only spoof does not reach paid API');

  // Missing/external Origin, malformed bodies, and session checks fail before spending.
  const routes = harness(fixture), createRoute = routes.route('app/api/media-studio/jobs/route.ts');
  function httpRequest(body, headers = {}, method = 'POST') {
    return new NextRequest('https://www.imobflow.net.br/api/media-studio/jobs', {
      method, headers: { 'content-type': 'application/json', cookie: 'valid', origin: 'https://www.imobflow.net.br', ...headers },
      ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
  }
  const unauthenticated = await createRoute.POST(httpRequest(request(), { cookie: '' })); assert.equal(unauthenticated.status, 401);
  routes.state.actor = { ...owner, role: 'broker' };
  assert.equal((await createRoute.POST(httpRequest(request()))).status, 403); routes.state.actor = owner;
  for (const origin of ['', 'https://attacker.example', 'null']) assert.equal((await createRoute.POST(httpRequest(request(), { origin }))).status, 403);
  assert.equal((await createRoute.POST(httpRequest(request(), { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await createRoute.POST(httpRequest('{broken'))).status, 400);
  assert.equal((await createRoute.POST(httpRequest(request(), { 'content-length': '99999999' }))).status, 413);
  assert.equal((await createRoute.POST(httpRequest(' '.repeat(routes.model.MEDIA_BODY_LIMIT + 1)))).status, 413);
  assert.equal((await createRoute.POST(httpRequest({ ...request(), companyId: otherOwner.companyId }))).status, 400);
  assert.equal(routes.state.calls.photo, 0);
  const created = await createRoute.POST(httpRequest(request())); assert.equal(created.status, 200); assert.match(created.headers.get('cache-control'), /private/);
  const createdJson = await created.json(); assert.equal(createdJson.job.status, 'completed'); assert.equal(createdJson.job.result_path, undefined);
  const jobRoute = routes.route('app/api/media-studio/jobs/[id]/route.ts');
  assert.equal((await jobRoute.POST(httpRequest({ taskId: 'injected' }), { params: Promise.resolve({ id: createdJson.job.id }) })).status, 400);
  const statusRoute = routes.route('app/api/media-studio/status/route.ts');
  assert.equal((await statusRoute.GET(httpRequest(null, {}, 'GET'))).status, 200);
  const resultRoute = routes.route('app/api/media-studio/jobs/[id]/result/route.ts');
  routes.state.actor = otherOwner;
  assert.equal((await resultRoute.GET(httpRequest(null, {}, 'GET'), { params: Promise.resolve({ id: createdJson.job.id }) })).status, 404);
  const safeError = await routes.http.mediaResponse(async () => { throw new Error('private-key-synthetic'); });
  assert.equal(safeError.status, 503); assert.ok(!(await safeError.text()).includes('private-key-synthetic'));

  // Validate the real storage adapter independently; the private bucket never emits public URLs.
  const calls = [], storageEnv = { SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SECRET_KEY: 'synthetic-storage-key' };
  let storageHandler = () => new Response('', { status: 200 });
  const actualStorage = load('lib/media-studio/storage.ts', { './model': routes.model }, {
    process: { env: storageEnv }, fetch: async (url, options) => { calls.push({ url, options }); return storageHandler(url, options); },
  });
  const safePath = actualStorage.mediaStoragePath(owner.companyId, uuid(100), 'result.jpg');
  await actualStorage.storeMediaFile(safePath, fixture, 'image/jpeg');
  assert.equal(calls[0].url, `https://synthetic.supabase.co/storage/v1/object/media-ai/${safePath}`);
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-storage-key');
  assert.ok(!calls[0].url.includes('/public/'));
  for (const unsafe of ['../other/result.jpg', `https://attacker.example/${safePath}`, `${safePath}?x=1`, `${safePath}/../result.mp4`]) await rejects(() => actualStorage.storeMediaFile(unsafe, fixture, 'image/jpeg'), 'media_forbidden', 403);
  assert.equal(calls.length, 1);
  storageHandler = () => new Response(fixture, { headers: { 'content-type': 'image/jpeg', 'content-length': String(fixture.length) } });
  const stream = await actualStorage.streamMediaFile(safePath, 'image/jpeg', fixture.length);
  assert.equal(stream.headers.get('cache-control'), 'private, no-store'); assert.equal(stream.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await stream.arrayBuffer()), fixture);
  storageHandler = () => new Response(fixture, { headers: { 'content-type': 'text/html', 'content-length': String(fixture.length) } });
  await rejects(() => actualStorage.streamMediaFile(safePath, 'image/jpeg', fixture.length), 'media_storage_unavailable', 503);
  storageHandler = () => new Response(fixture.subarray(0, fixture.length - 1), { headers: { 'content-type': 'image/jpeg' } });
  const shortStream = await actualStorage.streamMediaFile(safePath, 'image/jpeg', fixture.length); await assert.rejects(() => shortStream.arrayBuffer(), /incomplete_media/);
  storageHandler = () => new Response(Buffer.concat([fixture, Buffer.from('extra')]), { headers: { 'content-type': 'image/jpeg', 'content-length': String(fixture.length) } });
  const longStream = await actualStorage.streamMediaFile(safePath, 'image/jpeg', fixture.length); await assert.rejects(() => longStream.arrayBuffer(), /invalid_media_size/);
  storageHandler = () => new Response('{}');
  await actualStorage.removeMediaFiles(owner.companyId, uuid(100));
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).prefixes, ['input.jpg', 'result.jpg', 'result.mp4'].map(name => `${owner.companyId}/${uuid(100)}/${name}`));

  // Expiry cleanup keeps idempotency rows and deletes only the three expected private objects.
  const purged = await single.server.purgeExpiredMedia(); assert.equal(purged.purged, 1);
  assert.equal(single.state.jobs.length, 1); assert.ok(single.state.jobs[0].purged_at); assert.equal(single.state.files.size, 0);
  assert.deepEqual(single.state.calls.remove[0], { companyId: owner.companyId, jobId: job.id });
  const purgeQuery = single.state.calls.db.find(call => call.url.includes('expires_at=lt.'));
  assert.equal(new URLSearchParams(purgeQuery.url.split('?')[1]).get('expires_at'), `lt.${new Date(single.state.now - 10 * 60000).toISOString()}`);

  const grace = harness(fixture), graceJob = await grace.server.createMediaJob(request(18));
  grace.state.now = Date.parse(graceJob.expires_at) + 1;
  await rejects(() => grace.server.mediaJobResult(graceJob.id), 'media_expired', 410);
  await rejects(() => grace.server.createMediaJob(request(18)), 'media_expired', 410);
  assert.equal((await grace.server.purgeExpiredMedia()).purged, 0, 'Access expires immediately; cleanup leaves time for in-flight uploads to stop');
  assert.equal(grace.state.files.size, 2); assert.equal(grace.state.jobs[0].purged_at, null);
  grace.state.now += 10 * 60000;
  assert.equal((await grace.server.purgeExpiredMedia()).purged, 1);
  assert.equal(grace.state.files.size, 0); assert.equal(grace.state.calls.photo, 1, 'Expired request cannot incur another charge');
  const maintenance = routes.route('app/api/media-studio/maintenance/route.ts');
  assert.equal((await maintenance.GET(httpRequest(null, {}, 'GET'))).status, 503);
  routes.state.env.CRON_SECRET = 'synthetic-cron';
  assert.equal((await maintenance.GET(httpRequest(null, { authorization: 'Bearer wrong' }, 'GET'))).status, 401);
  assert.equal((await maintenance.GET(httpRequest(null, { authorization: 'Bearer synthetic-cron' }, 'GET'))).status, 200);

  const worker = routes.route('app/api/media-studio/recover/route.ts');
  assert.equal((await worker.POST(httpRequest({}))).status, 401);
  routes.state.env.MESSAGE_RECOVERY_SECRET = 'short';
  assert.equal((await worker.POST(httpRequest({}, { authorization: 'Bearer short' }))).status, 401);
  routes.state.env.MESSAGE_RECOVERY_SECRET = 'synthetic-recovery-secret'.padEnd(32, 'x');
  assert.equal((await worker.POST(httpRequest({}, { authorization: 'Bearer wrong' }))).status, 401);
  const allowedWorker = await worker.POST(httpRequest({}, { authorization: `Bearer ${routes.state.env.MESSAGE_RECOVERY_SECRET}` }));
  assert.equal(allowedWorker.status, 200); assert.equal((await allowedWorker.json()).checked, 0);

  console.log('PASS media AI server: real image parsing, owner/tenant/actor isolation, idempotent concurrent creation, ambiguous failures, acknowledged-task recovery, poll leases, private bounded storage, expiry cleanup and authenticated same-origin routes. No real service calls.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
