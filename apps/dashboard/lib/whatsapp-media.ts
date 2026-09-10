import { randomUUID } from 'node:crypto';

const BUCKET = 'whatsapp-media';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type Configuration = { baseUrl: string; secretKey: string };

function configuration(): Configuration {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !secretKey) throw new Error('Armazenamento de mídia não configurado.');
  return { baseUrl, secretKey };
}

let bucketReady: Promise<void> | null = null;

async function ensureBucket(config: Configuration) {
  const response = await fetch(`${config.baseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: [...ACCEPTED_TYPES] }),
    cache: 'no-store',
  });
  if (!response.ok && response.status !== 409) throw new Error(`Não foi possível preparar o armazenamento de fotos (${response.status}).`);
}

function ensureMediaBucket(config: Configuration) {
  if (!bucketReady) bucketReady = ensureBucket(config).catch((error) => { bucketReady = null; throw error; });
  return bucketReady;
}

function contentType(value: string | null) {
  return value?.split(';', 1)[0].trim().toLowerCase() || '';
}

function extension(type: string) {
  return type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp';
}

export function isWhatsAppMediaPath(value: string, companyId: string) {
  return value.startsWith(`${BUCKET}/${companyId}/`) && /^[a-z-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(jpg|png|webp)$/i.test(value);
}

export async function persistIncomingWhatsAppImage(input: { companyId: string; mediaId: string; mimeType: string; accessToken: string | null; apiVersion: string }) {
  if (!input.accessToken) throw new Error('A conexão WhatsApp não possui token de acesso para baixar fotos.');
  const metadata = await fetch(`https://graph.facebook.com/${input.apiVersion}/${encodeURIComponent(input.mediaId)}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` }, cache: 'no-store',
  });
  if (!metadata.ok) throw new Error(`Não foi possível obter a foto recebida (${metadata.status}).`);
  const details = await metadata.json() as { url?: unknown; mime_type?: unknown };
  const downloadUrl = typeof details.url === 'string' && details.url.startsWith('https://') ? details.url : '';
  if (!downloadUrl) throw new Error('A Meta não forneceu um endereço seguro para a foto.');
  const declaredType = typeof details.mime_type === 'string' ? contentType(details.mime_type) : contentType(input.mimeType);
  if (!ACCEPTED_TYPES.has(declaredType)) throw new Error('O tipo de foto recebido não é suportado.');
  const download = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${input.accessToken}` }, cache: 'no-store' });
  if (!download.ok) throw new Error(`Não foi possível baixar a foto recebida (${download.status}).`);
  const receivedType = contentType(download.headers.get('content-type'));
  if (receivedType && receivedType !== declaredType) throw new Error('O tipo da foto recebida não confere.');
  const contentLength = Number(download.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('A foto recebida ultrapassa o limite de 5 MB.');
  const bytes = Buffer.from(await download.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('A foto recebida ultrapassa o limite de 5 MB.');
  const config = configuration();
  await ensureMediaBucket(config);
  const objectPath = `${input.companyId}/${randomUUID()}.${extension(declaredType)}`;
  const upload = await fetch(`${config.baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, 'Content-Type': declaredType, 'x-upsert': 'false' },
    body: bytes, cache: 'no-store',
  });
  if (!upload.ok) throw new Error(`Não foi possível salvar a foto recebida (${upload.status}).`);
  return `${BUCKET}/${objectPath}`;
}

export async function readStoredWhatsAppImage(path: string) {
  const config = configuration();
  const response = await fetch(`${config.baseUrl}/storage/v1/object/${path}`, {
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}` }, cache: 'no-store',
  });
  if (!response.ok) throw new Error('Foto não encontrada.');
  const type = contentType(response.headers.get('content-type'));
  if (!ACCEPTED_TYPES.has(type)) throw new Error('Foto armazenada em formato inválido.');
  return { bytes: await response.arrayBuffer(), contentType: type };
}
