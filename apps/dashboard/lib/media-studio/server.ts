import { currentAccount, withAccount } from '../tenant-context';
import { supabaseServiceRequest } from '../supabase';
import { MEDIA_MODELS, MediaError, type MediaJobRow, type MediaKind, UUID, jobView, mediaErrorMessage, normalizeMediaImage, parseMediaRequest } from './model';
import { MediaProviderError, downloadVideo, enhancePhoto, inspectVideo, startVideo } from './providers';
import { mediaStoragePath, removeMediaFiles, storeMediaFile, streamMediaFile } from './storage';

type Entitlement = { enabled: boolean; photo_enabled: boolean; video_enabled: boolean; photo_daily_limit: number; video_daily_limit: number };
function owner() {
  const actor = currentAccount();
  if (!actor || actor.role !== 'owner' || !UUID.test(actor.companyId) || !UUID.test(actor.brokerId)) throw new MediaError('media_forbidden', 403);
  return actor;
}
function scope() { const actor = owner(); return `company_id=eq.${actor.companyId}&actor_id=eq.${actor.brokerId}`; }
async function db<T>(path: string, options?: Parameters<typeof supabaseServiceRequest>[1]): Promise<T> {
  try { return await supabaseServiceRequest<T>(path, options); }
  catch (error) {
    const detail = error instanceof Error ? error.message : '';
    const code = ['media_forbidden', 'media_not_enabled', 'media_feature_disabled', 'media_invalid_request', 'media_request_conflict', 'media_daily_limit', 'media_global_limit', 'media_expired', 'media_reservation_expired'].find(code => detail.includes(code));
    throw new MediaError(code || 'media_database_unavailable', code?.includes('limit') ? 429 : code?.includes('expired') ? 410 : code === 'media_request_conflict' ? 409 : code?.includes('forbidden') || code?.includes('enabled') || code?.includes('disabled') ? 403 : code ? 400 : 503);
  }
}
async function entitlement() {
  const actor = owner();
  const rows = await db<Entitlement[]>(`media_ai_entitlements?company_id=eq.${actor.companyId}&select=enabled,photo_enabled,video_enabled,photo_daily_limit,video_daily_limit&limit=1`);
  return rows[0];
}
function configured(kind: MediaKind) {
  return kind === 'photo' ? Boolean(process.env.MEDIA_AI_OPENAI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim()) : Boolean(process.env.RUNWAYML_API_SECRET?.trim());
}
async function requireGeneration(kind: MediaKind) {
  const plan = await entitlement();
  if (!plan?.enabled) throw new MediaError('media_not_enabled', 403);
  if (!plan[`${kind}_enabled`]) throw new MediaError('media_feature_disabled', 403);
  if (!configured(kind)) throw new MediaError(kind === 'photo' ? 'media_ai_openai_not_configured' : 'media_ai_runway_not_configured', 503);
}
export async function mediaStudioStatus() {
  owner();
  const plan = await entitlement();
  const capability = (kind: MediaKind) => {
    const code = !plan?.enabled ? 'media_not_enabled' : !plan[`${kind}_enabled`] ? 'media_feature_disabled' : !configured(kind) ? `media_ai_${kind === 'photo' ? 'openai' : 'runway'}_not_configured` : null;
    return { available: !code, ...(code ? { message: mediaErrorMessage(code) } : {}) };
  };
  const jobs = await db<MediaJobRow[]>(`media_ai_jobs?${scope()}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=20&select=*`);
  return { access: plan?.enabled ? 'ready' : 'not_enabled', photo: capability('photo'), video: capability('video'), jobs: jobs.map(jobView) };
}
export async function readMediaJob(id: string) {
  owner();
  if (!UUID.test(id)) throw new MediaError('media_not_found', 404);
  const rows = await db<MediaJobRow[]>(`media_ai_jobs?${scope()}&id=eq.${id}&select=*&limit=1`);
  if (!rows[0]) throw new MediaError('media_not_found', 404);
  return rows[0];
}
async function patchJob(job: MediaJobRow, update: Partial<MediaJobRow>, condition = '') {
  const rows = await db<MediaJobRow[]>(`media_ai_jobs?${scope()}&id=eq.${job.id}&status=eq.${job.status}${condition}`, { method: 'PATCH', body: update, prefer: 'return=representation' });
  return rows[0] || null;
}
export async function createMediaJob(payload: unknown) {
  const actor = owner();
  const input = parseMediaRequest(payload);
  // Read retries before credentials/entitlement checks: a revoked feature must still
  // allow the owner to recover an existing result, without making a paid call.
  const previous = await db<MediaJobRow[]>(`media_ai_jobs?${scope()}&request_id=eq.${input.requestId}&select=*&limit=1`);
  if (previous[0]) {
    if (previous[0].request_hash !== input.hash) throw new MediaError('media_request_conflict', 409);
    if (Date.parse(previous[0].expires_at) <= Date.now() || previous[0].purged_at) throw new MediaError('media_expired', 410);
    if (previous[0].status !== 'reserved') return previous[0];
  }
  await requireGeneration(input.kind);
  const image = await normalizeMediaImage(input.image.bytes);
  const reservation = await db<{ job: MediaJobRow; reused: boolean }>('rpc/reserve_media_ai_job', { method: 'POST', body: {
    p_company_id: actor.companyId, p_actor_id: actor.brokerId, p_request_id: input.requestId, p_request_hash: input.hash,
    p_kind: input.kind, p_property_id: input.propertyId, p_photo_index: input.photoIndex, p_format: input.format,
    p_provider: input.kind === 'photo' ? 'openai' : 'runway', p_model: MEDIA_MODELS[input.kind],
  } });
  let job = reservation.job;
  if (job.status !== 'reserved') return job;
  const claimed = await db<MediaJobRow | null>('rpc/claim_media_ai_job', { method: 'POST', body: { p_company_id: actor.companyId, p_actor_id: actor.brokerId, p_job_id: job.id } });
  if (!claimed) return readMediaJob(job.id);
  job = claimed;
  let calledProvider = false;
  let knownOutcome: Partial<MediaJobRow> | null = null;
  try {
    const inputPath = mediaStoragePath(actor.companyId, job.id, 'input.jpg');
    await storeMediaFile(inputPath, image.bytes, image.contentType);
    job = await patchJob(job, { input_path: inputPath }) || job;
    // Recheck immediately before spending; neither a demo role nor a browser flag grants access.
    await requireGeneration(input.kind);
    const providerInput = { ...image, format: input.format };
    calledProvider = true;
    if (input.kind === 'video') {
      const task = await startVideo(providerInput);
      knownOutcome = { status: 'processing', provider_task_id: task.taskId, poll_after: new Date(Date.now() + 6000).toISOString() };
      const saved = await patchJob(job, knownOutcome);
      if (!saved) throw new MediaError('media_database_unavailable', 503);
      return saved;
    }
    const result = await enhancePhoto(providerInput);
    const output = await normalizeMediaImage(result.bytes, true);
    const resultPath = mediaStoragePath(actor.companyId, job.id, 'result.jpg');
    await storeMediaFile(resultPath, output.bytes, output.contentType);
    knownOutcome = { status: 'completed', result_path: resultPath, result_mime: output.contentType, result_bytes: output.bytes.byteLength, provider_usage: result.usage || null };
    const saved = await patchJob(job, knownOutcome);
    if (!saved) throw new MediaError('media_database_unavailable', 503);
    return saved;
  } catch (error) {
    // A known task/result survives a transient database failure. This retry only
    // persists existing metadata; it never repeats the paid provider request.
    if (knownOutcome) return await patchJob(job, knownOutcome) || readMediaJob(job.id);
    const ambiguous = calledProvider && (!(error instanceof MediaProviderError) || error.ambiguous);
    const code = ambiguous ? 'media_unknown' : error instanceof MediaProviderError || error instanceof MediaError ? error.code : 'media_storage_unavailable';
    // If this persistence fails, the durable submitting row remains non-retriable.
    const saved = await patchJob(job, { status: ambiguous ? 'unknown' : 'failed', error_code: code });
    return saved || readMediaJob(job.id);
  }
}
export async function refreshMediaJob(id: string) {
  let job = await readMediaJob(id);
  if (Date.parse(job.expires_at) <= Date.now() || job.purged_at) throw new MediaError('media_expired', 410);
  if (job.status === 'submitting' && Date.parse(job.updated_at) < Date.now() - 5 * 60_000) return await patchJob(job, { status: 'unknown', error_code: 'media_unknown' }) || job;
  if (job.status !== 'processing' || job.kind !== 'video' || !job.provider_task_id) return job;
  const now = new Date().toISOString();
  // Durable lease covers the provider GET, download and upload, not just a single poll.
  const leased = await patchJob(job, { poll_after: new Date(Date.now() + 180_000).toISOString() }, `&poll_after=lte.${encodeURIComponent(now)}`);
  if (!leased) return readMediaJob(id);
  job = leased;
  const finish = async (update: Partial<MediaJobRow>) => await patchJob(job, update, `&poll_after=eq.${encodeURIComponent(job.poll_after)}`) || readMediaJob(id);
  try {
    const state = await inspectVideo(job.provider_task_id!);
    if (state.state === 'failed' || state.state === 'cancelled') return finish({ status: 'failed', error_code: state.errorCode || 'media_ai_video_cancelled' });
    if (state.state === 'completed') {
      if (!state.outputUrl) throw new MediaError('media_ai_invalid_output');
      const result = await downloadVideo(state.outputUrl);
      const resultPath = mediaStoragePath(owner().companyId, job.id, 'result.mp4');
      await storeMediaFile(resultPath, result.bytes, result.contentType);
      return finish({ status: 'completed', result_path: resultPath, result_mime: result.contentType, result_bytes: result.bytes.byteLength, error_code: null });
    }
    return finish({ poll_after: new Date(Date.now() + 6000).toISOString(), error_code: null });
  } catch (error) {
    // Retry only status/download of the same task. Never resubmit a paid generation.
    const code = error instanceof MediaProviderError || error instanceof MediaError ? error.code : 'media_storage_unavailable';
    return finish({ poll_after: new Date(Date.now() + 30_000).toISOString(), error_code: code });
  }
}
export async function mediaJobResult(id: string) {
  const job = await readMediaJob(id);
  if (Date.parse(job.expires_at) <= Date.now() || job.purged_at) throw new MediaError('media_expired', 410);
  if (job.status !== 'completed' || !job.result_bytes || !job.result_path) throw new MediaError('media_not_ready', 409);
  const mime = job.kind === 'photo' ? 'image/jpeg' : 'video/mp4';
  const path = mediaStoragePath(owner().companyId, job.id, job.kind === 'photo' ? 'result.jpg' : 'result.mp4');
  if (job.result_path !== path || job.result_mime !== mime) throw new MediaError('media_not_found', 404);
  return streamMediaFile(path, mime, job.result_bytes);
}
export async function purgeExpiredMedia() {
  // System cron only. Keep job records for idempotency/quota/audit; delete exact private paths.
  // Access expires immediately; the cleanup grace outlasts any in-flight upload
  // so a worker cannot recreate an object after its row was marked purged.
  const rows = await db<MediaJobRow[]>(`media_ai_jobs?expires_at=lt.${encodeURIComponent(new Date(Date.now() - 10 * 60_000).toISOString())}&purged_at=is.null&order=expires_at.asc&limit=200&select=*`);
  let purged = 0; const deadline = Date.now() + 40_000;
  for (let offset = 0; offset < rows.length && Date.now() < deadline; offset += 10) {
    await Promise.all(rows.slice(offset, offset + 10).map(async row => {
      try {
        await removeMediaFiles(row.company_id, row.id);
        await db(`media_ai_jobs?id=eq.${row.id}&company_id=eq.${row.company_id}&purged_at=is.null`, { method: 'PATCH', body: { purged_at: new Date().toISOString() } });
        purged++;
      } catch { /* The row remains eligible for the next daily cleanup. */ }
    }));
  }
  return { purged, pending: rows.length - purged, hasMore: rows.length === 200 };
}
export async function recoverMediaVideos() {
  // Called only by the secret-protected worker. It can collect an existing
  // provider task, never reserve quota or create another paid generation.
  const now = encodeURIComponent(new Date().toISOString());
  const rows = await db<MediaJobRow[]>(`media_ai_jobs?kind=eq.video&provider=eq.runway&status=eq.processing&provider_task_id=not.is.null&poll_after=lte.${now}&expires_at=gt.${now}&purged_at=is.null&order=poll_after.asc&limit=3&select=*`);
  const results = await Promise.allSettled(rows.map(row => withAccount({ companyId: row.company_id, brokerId: row.actor_id, company: '', name: 'Recuperação de mídia', role: 'owner' }, () => refreshMediaJob(row.id))));
  return { checked: results.length, completed: results.filter(result => result.status === 'fulfilled' && result.value.status === 'completed').length,
    failed: results.filter(result => result.status === 'rejected').length };
}
