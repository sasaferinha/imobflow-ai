import { randomUUID } from 'node:crypto';
import {supabaseServiceRequest as db} from './supabase';

const BUCKET = 'whatsapp-media';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUDIO_TYPES = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr']);
const ACCEPTED_TYPES = new Set([...IMAGE_TYPES, ...AUDIO_TYPES]);

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
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_AUDIO_BYTES, allowed_mime_types: [...ACCEPTED_TYPES] }),
    cache: 'no-store',
  });
  if (response.ok) return;
  // Storage can report an existing bucket as HTTP 400 with statusCode 409.
  const error = await response.json().catch(() => ({})) as { statusCode?: string | number };
  if (response.status !== 409 && String(error.statusCode) !== '409') throw new Error('Não foi possível preparar o armazenamento de mídia.');
  const update = await fetch(`${config.baseUrl}/storage/v1/bucket/${BUCKET}`, {
    method: 'PUT', headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public: false, file_size_limit: MAX_AUDIO_BYTES, allowed_mime_types: [...ACCEPTED_TYPES] }),
    cache: 'no-store', signal: AbortSignal.timeout(8000),
  });
  if (!update.ok) throw new Error('Não foi possível habilitar áudios no armazenamento privado.');
}

function ensureMediaBucket(config: Configuration) {
  if (!bucketReady) bucketReady = ensureBucket(config).catch((error) => { bucketReady = null; throw error; });
  return bucketReady;
}

function contentType(value: string | null) {
  return value?.split(';', 1)[0].trim().toLowerCase() || '';
}

function extension(type: string) {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr' };
  return extensions[type];
}
export function safeMetaMediaUrl(value:unknown){
 if(typeof value!=='string')return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(url.hostname==='lookaside.fbsbx.com'||url.hostname==='graph.facebook.com')?url.href:'';}catch{return '';}
}
async function boundedImage(response:Response, limit = MAX_IMAGE_BYTES){
 const reader=response.body?.getReader();if(!reader)throw Error('Foto vazia.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw Error('A mídia ultrapassa o limite permitido.');chunks.push(part.value);}}
 finally{await reader.cancel();reader.releaseLock();}
 if(!size)throw Error('Foto vazia.');return Buffer.concat(chunks);
}

export function matchesAudioSignature(bytes: Uint8Array, type: string) {
  const prefix = Buffer.from(bytes.slice(0, 64));
  if (type === 'audio/ogg') return prefix.subarray(0, 4).toString() === 'OggS';
  if (type === 'audio/mp4') return prefix.subarray(4, 8).toString() === 'ftyp';
  if (type === 'audio/amr') return prefix.subarray(0, 6).toString() === '#!AMR\n' || prefix.subarray(0, 9).toString() === '#!AMR-WB\n';
  if (type === 'audio/aac') return bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 246) === 240;
  if (type === 'audio/mpeg') return prefix.subarray(0, 3).toString() === 'ID3' || (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 224) === 224);
  return false;
}

export function isWhatsAppAudioPath(value: string, companyId: string) {
  return isWhatsAppMediaPath(value, companyId) && /\.(ogg|mp3|m4a|aac|amr)$/i.test(value);
}
export function matchesImageSignature(bytes:Uint8Array,type:string){
 const hex=(n:number)=>Array.from(bytes.slice(0,n)).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(type==='image/jpeg')return hex(3)==='ffd8ff';
 if(type==='image/png')return hex(8)==='89504e470d0a1a0a';
 return type==='image/webp'&&Buffer.from(bytes.slice(0,4)).toString()==='RIFF'&&Buffer.from(bytes.slice(8,12)).toString()==='WEBP';
}

export function isWhatsAppMediaPath(value: string, companyId: string) {
  return value.startsWith(`${BUCKET}/${companyId}/`) && /^[a-z-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(jpg|png|webp|ogg|mp3|m4a|aac|amr)$/i.test(value);
}

export async function persistIncomingWhatsAppImage(input: { companyId: string; mediaId: string; mimeType: string; accessToken: string | null; apiVersion: string; kind?: 'image' | 'audio' }) {
  if (!input.accessToken) throw new Error('A conexão WhatsApp não possui token de acesso para baixar fotos.');
  const metadata = await fetch(`https://graph.facebook.com/${input.apiVersion}/${encodeURIComponent(input.mediaId)}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` }, cache: 'no-store', redirect:'error',signal:AbortSignal.timeout(12000),
  });
  if (!metadata.ok) throw new Error(`Não foi possível obter a foto recebida (${metadata.status}).`);
  const details = await metadata.json() as { url?: unknown; mime_type?: unknown };
  const downloadUrl = safeMetaMediaUrl(details.url);
  if (!downloadUrl) throw new Error('A Meta não forneceu um endereço seguro para a foto.');
  const declaredType = typeof details.mime_type === 'string' ? contentType(details.mime_type) : contentType(input.mimeType);
  const audio = input.kind === 'audio';
  const limit = audio ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES;
  if (!(audio ? AUDIO_TYPES : IMAGE_TYPES).has(declaredType)) throw new Error('O tipo de mídia recebido não é suportado.');
  const download = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${input.accessToken}` }, cache: 'no-store',redirect:'error',signal:AbortSignal.timeout(12000) });
  if (!download.ok) throw new Error(`Não foi possível baixar a foto recebida (${download.status}).`);
  const receivedType = contentType(download.headers.get('content-type'));
  if (receivedType && receivedType !== declaredType) throw new Error('O tipo da foto recebida não confere.');
  const contentLength = Number(download.headers.get('content-length') || 0);
  if (contentLength > limit) throw new Error('A mídia recebida ultrapassa o limite permitido.');
  const bytes = await boundedImage(download, limit);
  if (!(audio ? matchesAudioSignature(bytes, declaredType) : matchesImageSignature(bytes, declaredType))) throw Error('Conteúdo de mídia inválido.');
  const config = configuration();
  await ensureMediaBucket(config);
  const objectPath = `${input.companyId}/${randomUUID()}.${extension(declaredType)}`;
  await db('conversation_media',{method:'POST',body:{company_id:input.companyId,object_path:`${BUCKET}/${objectPath}`}});
  const upload = await fetch(`${config.baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`, 'Content-Type': declaredType, 'x-upsert': 'false' },
    body: bytes, cache: 'no-store',signal:AbortSignal.timeout(12000),
  });
  if (!upload.ok) throw new Error(`Não foi possível salvar a foto recebida (${upload.status}).`);
  return `${BUCKET}/${objectPath}`;
}

export async function readStoredWhatsAppImage(path: string) {
  const companyId=path.split('/')[1];
  const rows=await db<Array<{expires_at:string}>>(`conversation_media?company_id=eq.${companyId}&object_path=eq.${encodeURIComponent(path)}&select=expires_at&limit=1`);
  if(!rows[0]||!Number.isFinite(Date.parse(rows[0].expires_at))||Date.parse(rows[0].expires_at)<=Date.now())throw Error('Foto expirada.');
  const config = configuration();
  const signing = await fetch(`${config.baseUrl}/storage/v1/object/sign/${path}`, {
    method:'POST',headers: { apikey: config.secretKey, Authorization: `Bearer ${config.secretKey}`,'Content-Type':'application/json' },
    body:JSON.stringify({expiresIn:60}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000),
  });
  if(!signing.ok)throw Error('Foto indisponível.');
  const signed=await signing.json() as {signedURL?:unknown};
  if(typeof signed.signedURL!=='string'||!signed.signedURL.startsWith(`/object/sign/${path}?`))throw Error('Endereço de mídia inválido.');
  // The short-lived URL stays on the server; every browser read still checks
  // the tenant session and the retention deadline through the private proxy.
  const response = await fetch(`${config.baseUrl}/storage/v1${signed.signedURL}`, {cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('Foto não encontrada.');
  const type = contentType(response.headers.get('content-type'));
  if (!ACCEPTED_TYPES.has(type)) throw new Error('Foto armazenada em formato inválido.');
  const bytes=await boundedImage(response, AUDIO_TYPES.has(type) ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES);
  return { bytes: bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer, contentType: type };
}
export async function removeExpiredConversationMedia(companyId:string,deadline=Date.now()+10000){
 const config=configuration();
 const rows=await db<Array<{id:string;object_path:string}>>(`conversation_media?company_id=eq.${companyId}&expires_at=lte.${new Date().toISOString()}&select=id,object_path&limit=100`);
 for(const row of rows){
  if(Date.now()+8000>deadline)break;
  if(!isWhatsAppMediaPath(row.object_path,companyId))continue;
  const result=await fetch(`${config.baseUrl}/storage/v1/object/${BUCKET}`,{method:'DELETE',headers:{apikey:config.secretKey,Authorization:`Bearer ${config.secretKey}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[row.object_path.slice(BUCKET.length+1)]}),signal:AbortSignal.timeout(8000)});
  if(result.ok)await db(`conversation_media?company_id=eq.${companyId}&id=eq.${row.id}`,{method:'DELETE'});
 }
}
