import { MEDIA_RESULT_LIMIT, MediaError, UUID } from './model';

export function mediaStoragePath(companyId: string, jobId: string, file: 'input.jpg' | 'result.jpg' | 'result.mp4') {
  if (!UUID.test(companyId) || !UUID.test(jobId)) throw new MediaError('media_forbidden', 403);
  return `${companyId}/${jobId}/${file}`;
}
function storageConfig(path: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(input\.jpg|result\.(jpg|mp4))$/.test(path)) throw new MediaError('media_forbidden', 403);
  const base = process.env.SUPABASE_URL?.replace(/\/$/, ''); const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key || new URL(base).protocol !== 'https:') throw new MediaError('media_storage_unavailable', 503);
  return { url: `${base}/storage/v1/object/media-ai/${path}`, headers: { apikey: key, Authorization: `Bearer ${key}` }, base };
}
export async function storeMediaFile(path: string, bytes: Uint8Array, contentType: 'image/jpeg' | 'video/mp4') {
  if (!bytes.length || bytes.length > MEDIA_RESULT_LIMIT) throw new MediaError('media_ai_output_too_large');
  const config = storageConfig(path);
  try {
    const response = await fetch(config.url, { method: 'POST', headers: { ...config.headers, 'Content-Type': contentType, 'x-upsert': 'true' }, body: new Uint8Array(bytes), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error('storage');
    await response.body?.cancel();
  } catch { throw new MediaError('media_storage_unavailable', 503); }
}
export async function streamMediaFile(path: string, expectedType: string, expectedBytes: number) {
  const config = storageConfig(path);
  let response: Response;
  try { response = await fetch(config.url, { headers: config.headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000) }); }
  catch { throw new MediaError('media_storage_unavailable', 503); }
  const length = Number(response.headers.get('content-length') || expectedBytes);
  if (!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0] !== expectedType || length !== expectedBytes || length > MEDIA_RESULT_LIMIT || length < 1) {
    await response.body?.cancel(); throw new MediaError('media_storage_unavailable', 503);
  }
  let received = 0;
  const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) { received += chunk.byteLength; if (received > expectedBytes) throw new Error('invalid_media_size'); controller.enqueue(chunk); },
    flush() { if (received !== expectedBytes) throw new Error('incomplete_media'); },
  }));
  return new Response(stream, { headers: { 'Content-Type': expectedType, 'Content-Disposition': `inline; filename="imobflow-ia.${expectedType === 'video/mp4' ? 'mp4' : 'jpg'}"`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Length': String(expectedBytes) } });
}
export async function removeMediaFiles(companyId: string, jobId: string) {
  const paths = (['input.jpg', 'result.jpg', 'result.mp4'] as const).map(file => mediaStoragePath(companyId, jobId, file));
  const config = storageConfig(paths[0]);
  const response = await fetch(`${config.base}/storage/v1/object/media-ai`, { method: 'DELETE', headers: { ...config.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new MediaError('media_storage_unavailable', 503);
  await response.body?.cancel();
}
