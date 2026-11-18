export type MediaAiKind = 'photo' | 'video';
export type MediaAiJob = {
  id: string;
  kind: MediaAiKind;
  propertyId: string;
  photoIndex: number;
  format: 'landscape' | 'portrait';
  status: 'reserved' | 'submitting' | 'processing' | 'completed' | 'failed' | 'unknown';
  createdAt: string;
  expiresAt: string;
  error?: string;
  progress?: number;
  resultAvailable: boolean;
};
export type MediaAiStatus = {
  access: 'login_required' | 'forbidden' | 'not_enabled' | 'ready';
  photo: { available: boolean; message?: string };
  video: { available: boolean; message?: string };
  jobs: MediaAiJob[];
};
export type MediaAiInput = {
  requestId: string;
  kind: MediaAiKind;
  propertyId: string;
  photoIndex: number;
  format: 'landscape' | 'portrait';
  imageDataUrl: string;
};

export const MEDIA_AI_POLL_MS = 6_000;
const root = '/api/media-studio';
const noAccess: MediaAiStatus = { access: 'login_required', photo: { available: false }, video: { available: false }, jobs: [] };

export class MediaAiRequestError extends Error {
  constructor(message: string, readonly ambiguous = false) { super(message); this.name = 'MediaAiRequestError'; }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function readJob(value: unknown): MediaAiJob {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    || !['photo', 'video'].includes(String(value.kind)) || typeof value.propertyId !== 'string'
    || !Number.isInteger(value.photoIndex) || Number(value.photoIndex) < 0
    || !['landscape', 'portrait'].includes(String(value.format))
    || !['reserved', 'submitting', 'processing', 'completed', 'failed', 'unknown'].includes(String(value.status))
    || typeof value.createdAt !== 'string' || typeof value.expiresAt !== 'string' || typeof value.resultAvailable !== 'boolean') {
    throw new MediaAiRequestError('A resposta da geração está incompleta. Verifique novamente.');
  }
  return value as MediaAiJob;
}
async function responseJob(response: Response): Promise<MediaAiJob> {
  const value: unknown = await response.json();
  return readJob(isRecord(value) ? value.job : null);
}

async function request(path: string, init: RequestInit = {}, creation = false): Promise<Response> {
  let response: Response;
  try { response = await fetch(`${root}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }); }
  catch (error) {
    if (init.signal?.aborted && !creation) throw error;
    throw new MediaAiRequestError(creation
      ? 'A conexão interrompeu a confirmação. Verifique a mesma solicitação antes de tentar uma nova geração.'
      : 'Não foi possível consultar a geração. Verifique sua conexão e tente novamente.', creation);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message = response.status === 401 ? 'Entre no painel da ImobFlow para usar a IA.'
      : isRecord(body) && typeof body.error === 'string' ? body.error.slice(0, 300)
      : 'Não foi possível concluir esta solicitação.';
    throw new MediaAiRequestError(message, creation && (response.status >= 500 || response.status === 408));
  }
  return response;
}

export async function getMediaAiStatus(signal?: AbortSignal): Promise<MediaAiStatus> {
  // A public demonstration is not an authenticated CRM company.
  const response = await fetch(`${root}/status`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  if (response.status === 401) return { ...noAccess, jobs: [] };
  if (response.status === 403) return { ...noAccess, access: 'forbidden', jobs: [] };
  if (!response.ok) throw new MediaAiRequestError('Não foi possível verificar o acesso à IA. Tente novamente.');
  const value: unknown = await response.json();
  if (!isRecord(value) || !['login_required', 'forbidden', 'not_enabled', 'ready'].includes(String(value.access))
    || !isRecord(value.photo) || typeof value.photo.available !== 'boolean'
    || !isRecord(value.video) || typeof value.video.available !== 'boolean' || !Array.isArray(value.jobs)) {
    throw new MediaAiRequestError('Não foi possível confirmar o acesso à IA.');
  }
  return { ...value, jobs: value.jobs.map(readJob) } as MediaAiStatus;
}

function jobPath(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new MediaAiRequestError('Identificação da geração inválida.');
  return `/jobs/${encodeURIComponent(id)}`;
}

export async function createMediaAiJob(input: MediaAiInput, signal?: AbortSignal): Promise<MediaAiJob> {
  const response = await request('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal }, true);
  try { return await responseJob(response); }
  catch { throw new MediaAiRequestError('A confirmação ficou incompleta. Verifique a mesma solicitação.', true); }
}

export async function readMediaAiJob(id: string, signal?: AbortSignal): Promise<MediaAiJob> {
  const response = await request(jobPath(id), { signal });
  return responseJob(response);
}

export async function refreshMediaAiJob(id: string, signal?: AbortSignal): Promise<MediaAiJob> {
  const response = await request(jobPath(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
  return responseJob(response);
}

function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Acompanhamento interrompido.', 'AbortError')); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException('Acompanhamento interrompido.', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, MEDIA_AI_POLL_MS);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function followMediaAiJob(initial: MediaAiJob, signal: AbortSignal, onUpdate: (job: MediaAiJob) => void): Promise<MediaAiJob> {
  let job = initial;
  onUpdate(job);
  while (['reserved', 'submitting', 'processing'].includes(job.status)) {
    await delay(signal);
    job = job.kind === 'video' ? await refreshMediaAiJob(job.id, signal) : await readMediaAiJob(job.id, signal);
    onUpdate(job);
  }
  return job;
}

export async function loadMediaAiResult(job: MediaAiJob, signal?: AbortSignal): Promise<Blob> {
  if (job.status !== 'completed' || !job.resultAvailable) throw new MediaAiRequestError('O resultado ainda não está disponível.');
  const response = await request(`${jobPath(job.id)}/result`, { signal });
  const blob = await response.blob();
  const validType = job.kind === 'photo' ? blob.type === 'image/jpeg' : blob.type === 'video/mp4';
  if (!validType || !blob.size || blob.size > (job.kind === 'photo' ? 12 : 30) * 1024 * 1024) {
    throw new MediaAiRequestError('O arquivo recebido não é compatível com esta prévia.');
  }
  return blob;
}
