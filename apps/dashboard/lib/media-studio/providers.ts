import 'server-only';

export type MediaFormat = 'landscape' | 'portrait';

type MediaInput = { bytes: Uint8Array; contentType: string; format: MediaFormat };
type Provider = 'openai' | 'runway';

const INPUT_LIMIT = 2 * 1024 * 1024;
const PHOTO_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 30_000_000;
const PHOTO_MODEL = 'gpt-image-2.6-sunburst';
const VIDEO_MODEL = 'gen4_turbo';
const RUNWAY_API = 'https://api.dev.runwayml.com/v1';
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Exact hostname in Runway's documented output example. Unknown hosts fail closed.
// https://docs.dev.runwayml.com/assets/outputs/
const OUTPUT_HOSTS = new Set(['dnznrvs05pmza.cloudfront.net']);

const PHOTO_PROMPT = 'Conservatively enhance this real estate photograph for a truthful property listing. '
  + 'Correct only exposure, white balance, image noise and mild optical softness. Preserve the original '
  + 'composition, geometry, dimensions, materials, true colors, furniture and all visible defects, stains, '
  + 'damage and signs of wear. Do not remove, replace or invent objects or architectural details. '
  + 'Do not renovate, stage, beautify the surroundings, add text or logos, or invent detail that is not '
  + 'visible in the source. Keep uncertain areas unchanged. Fit the whole source image within the requested '
  + 'canvas without cropping property features or extending the scene; use plain neutral padding if necessary.';
const VIDEO_PROMPT = 'A restrained real estate presentation of the supplied photograph. A very slow, '
  + 'subtle camera push in within the existing frame. Keep the room, building geometry, materials, colors, '
  + 'furniture, lighting and all visible defects exactly as photographed. All objects remain stationary. '
  + 'Do not reveal unseen areas, invent details, add people, change architecture, remove damage, renovate, '
  + 'or add text and logos. Preserve an honest representation of the property.';

/** Only stable codes leave this module; provider bodies, prompts and keys never enter errors. */
export class MediaProviderError extends Error {
  constructor(public readonly code: string, public readonly ambiguous = false) {
    super(code);
    this.name = 'MediaProviderError';
  }
}

function validRaster(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (contentType === 'image/webp') return bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP';
  return false;
}

function validateInput(input: MediaInput) {
  if (!input || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || !['landscape', 'portrait'].includes(input.format)) {
    throw new MediaProviderError('media_ai_invalid_input');
  }
  if (input.bytes.byteLength > INPUT_LIMIT) throw new MediaProviderError('media_ai_input_too_large');
  if (!validRaster(input.bytes, input.contentType)) throw new MediaProviderError('media_ai_invalid_input');
}

function providerKey(provider: Provider) {
  const key = provider === 'openai'
    ? (process.env.MEDIA_AI_OPENAI_KEY?.trim() || process.env.OPENAI_API_KEY?.trim())
    : process.env.RUNWAYML_API_SECRET?.trim();
  if (!key || /[\r\n]/.test(key)) throw new MediaProviderError(`media_ai_${provider}_not_configured`);
  return key;
}

function runwayHeaders() {
  return { Authorization: `Bearer ${providerKey('runway')}`, 'X-Runway-Version': '2024-11-06' };
}

async function withinDeadline<T>(timeoutMs: number, creating: boolean, callerSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // A pre-aborted request never contacts the provider and therefore cannot incur a charge.
  if (callerSignal?.aborted) throw new MediaProviderError('media_ai_request_aborted');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  callerSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new MediaProviderError(timedOut ? 'media_ai_request_timeout' : 'media_ai_request_aborted', creating));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work(controller.signal), aborted]);
  } catch (error) {
    if (error instanceof MediaProviderError) throw error;
    throw new MediaProviderError(controller.signal.aborted
      ? (timedOut ? 'media_ai_request_timeout' : 'media_ai_request_aborted')
      : 'media_ai_network_error', creating);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}

function checkStatus(response: Response, creating: boolean) {
  if (response.ok && !response.redirected) return;
  void response.body?.cancel().catch(() => {});
  const code = response.status === 401 || response.status === 403 ? 'media_ai_authentication_failed'
    : response.status === 402 ? 'media_ai_payment_required'
    : response.status === 429 ? 'media_ai_rate_limited'
    : response.status === 408 ? 'media_ai_request_timeout'
    : response.status >= 500 ? 'media_ai_provider_unavailable'
    : 'media_ai_request_rejected';
  throw new MediaProviderError(code, creating && (response.status === 408 || response.status >= 500 || response.status < 400 || response.redirected));
}

async function readBounded(response: Response, limit: number, creating: boolean, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new MediaProviderError('media_ai_output_too_large', creating);
  }
  if (!response.body) throw new MediaProviderError('media_ai_invalid_response', creating);
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new MediaProviderError('media_ai_request_aborted', creating);
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        cancel();
        throw new MediaProviderError('media_ai_output_too_large', creating);
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  if (signal.aborted) throw new MediaProviderError('media_ai_request_aborted', creating);
  return new Uint8Array(Buffer.concat(chunks, size));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readJson(response: Response, limit: number, creating: boolean, signal: AbortSignal) {
  const bytes = await readBounded(response, limit, creating, signal);
  try {
    const result = asRecord(JSON.parse(Buffer.from(bytes).toString('utf8')));
    if (result) return result;
  } catch { /* Do not include malformed provider payloads in diagnostics. */ }
  throw new MediaProviderError('media_ai_invalid_response', creating);
}

function numericUsage(value: unknown) {
  const source = asRecord(value);
  if (!source) return undefined;
  const result: Record<string, number | Record<string, number>> = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    const count = source[key];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) result[key] = count;
  }
  const details = asRecord(source.input_tokens_details);
  const safeDetails: Record<string, number> = {};
  for (const key of ['image_tokens', 'text_tokens']) {
    const count = details?.[key];
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) safeDetails[key] = count;
  }
  if (Object.keys(safeDetails).length) result.input_tokens_details = safeDetails;
  return Object.keys(result).length ? result : undefined;
}

export async function enhancePhoto(input: MediaInput, signal?: AbortSignal): Promise<{
  bytes: Uint8Array; contentType: 'image/jpeg'; provider: 'openai'; model: string; usage?: unknown;
}> {
  validateInput(input);
  const key = providerKey('openai');
  const form = new FormData();
  const extension = input.contentType === 'image/jpeg' ? 'jpg' : input.contentType.split('/')[1];
  form.set('image[]', new Blob([new Uint8Array(input.bytes)], { type: input.contentType }), `property.${extension}`);
  for (const [name, value] of Object.entries({ model: PHOTO_MODEL, prompt: PHOTO_PROMPT, quality: 'medium', complexity: 'low', n: '1', output_format: 'jpeg', output_compression: '90', size: input.format === 'portrait' ? '1024x1536' : '1536x1024' })) form.set(name, value);
  return withinDeadline(180_000, true, signal, async requestSignal => {
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      signal: requestSignal, cache: 'no-store', redirect: 'error', credentials: 'omit',
    });
    checkStatus(response, true);
    const payload = await readJson(response, Math.ceil(PHOTO_LIMIT / 3) * 4 + 64 * 1024, true, requestSignal);
    const data = Array.isArray(payload.data) && payload.data.length === 1 ? asRecord(payload.data[0]) : null;
    const encoded = data?.b64_json;
    if (typeof encoded !== 'string' || !encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new MediaProviderError('media_ai_invalid_response', true);
    if (encoded.length > Math.ceil(PHOTO_LIMIT / 3) * 4) throw new MediaProviderError('media_ai_output_too_large', true);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.byteLength > PHOTO_LIMIT) throw new MediaProviderError('media_ai_output_too_large', true);
    if (bytes.toString('base64') !== encoded || !validRaster(bytes, 'image/jpeg') || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new MediaProviderError('media_ai_invalid_output', true);
    return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg', provider: 'openai', model: PHOTO_MODEL, usage: numericUsage(payload.usage) };
  });
}

export async function startVideo(input: MediaInput, signal?: AbortSignal): Promise<{ taskId: string; provider: 'runway'; model: string }> {
  validateInput(input);
  const headers = { ...runwayHeaders(), 'Content-Type': 'application/json' };
  return withinDeadline(30_000, true, signal, async requestSignal => {
    const response = await fetch(`${RUNWAY_API}/image_to_video`, {
      method: 'POST', headers, body: JSON.stringify({ model: VIDEO_MODEL, promptImage: `data:${input.contentType};base64,${Buffer.from(input.bytes).toString('base64')}`, promptText: VIDEO_PROMPT, ratio: input.format === 'portrait' ? '720:1280' : '1280:720', duration: 5 }),
      signal: requestSignal, cache: 'no-store', redirect: 'error', credentials: 'omit',
    });
    checkStatus(response, true);
    const payload = await readJson(response, 64 * 1024, true, requestSignal);
    if (typeof payload.id !== 'string' || !TASK_ID.test(payload.id)) throw new MediaProviderError('media_ai_invalid_response', true);
    return { taskId: payload.id, provider: 'runway', model: VIDEO_MODEL };
  });
}

function validatedOutputUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\]/.test(value)) throw new MediaProviderError('media_ai_unsafe_output_url');
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && OUTPUT_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port && !url.hash && url.pathname !== '/') return url.href;
  } catch { /* Fail closed without reflecting an untrusted URL. */ }
  throw new MediaProviderError('media_ai_unsafe_output_url');
}

/** The caller persists the task ID and spaces status checks at least five seconds apart. */
export async function inspectVideo(taskId: string, signal?: AbortSignal): Promise<{
  state: 'processing' | 'completed' | 'failed' | 'cancelled'; progress?: number; outputUrl?: string; errorCode?: string;
}> {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) throw new MediaProviderError('media_ai_invalid_task_id');
  const headers = runwayHeaders();
  return withinDeadline(15_000, false, signal, async requestSignal => {
    const response = await fetch(`${RUNWAY_API}/tasks/${taskId}`, { headers, signal: requestSignal, cache: 'no-store', redirect: 'error', credentials: 'omit' });
    checkStatus(response, false);
    const payload = await readJson(response, 64 * 1024, false, requestSignal);
    if (payload.id !== taskId) throw new MediaProviderError('media_ai_invalid_response');
    if (payload.status === 'SUCCEEDED') {
      if (!Array.isArray(payload.output) || payload.output.length !== 1) throw new MediaProviderError('media_ai_invalid_response');
      return { state: 'completed', progress: 1, outputUrl: validatedOutputUrl(payload.output[0]) };
    }
    if (payload.status === 'FAILED') return { state: 'failed', errorCode: 'media_ai_video_failed' };
    if (payload.status === 'CANCELLED') return { state: 'cancelled' };
    if (payload.status === 'PENDING' || payload.status === 'THROTTLED' || payload.status === 'RUNNING') {
      const progress = typeof payload.progress === 'number' && Number.isFinite(payload.progress) && payload.progress >= 0 && payload.progress <= 1 ? payload.progress : undefined;
      return { state: 'processing', ...(progress === undefined ? {} : { progress }) };
    }
    throw new MediaProviderError('media_ai_invalid_response');
  });
}

/** Download only URLs returned by inspectVideo, never a URL supplied by a client. */
export async function downloadVideo(outputUrl: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: 'video/mp4' }> {
  const safeUrl = validatedOutputUrl(outputUrl);
  return withinDeadline(45_000, false, signal, async requestSignal => {
    const response = await fetch(safeUrl, { signal: requestSignal, cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    checkStatus(response, false);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'video/mp4' && contentType !== 'application/octet-stream') {
      void response.body?.cancel().catch(() => {});
      throw new MediaProviderError('media_ai_invalid_output');
    }
    const bytes = await readBounded(response, VIDEO_LIMIT, false, requestSignal);
    // ISO BMFF ftyp first box; reject HTML and unrelated files even with a forged MIME.
    const buffer = Buffer.from(bytes);
    if (bytes.length < 16 || buffer.toString('ascii', 4, 8) !== 'ftyp' || buffer.readUInt32BE(0) < 16 || buffer.readUInt32BE(0) > bytes.length
      || !['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '].includes(buffer.toString('ascii', 8, 12))) throw new MediaProviderError('media_ai_invalid_output');
    return { bytes, contentType: 'video/mp4' };
  });
}
