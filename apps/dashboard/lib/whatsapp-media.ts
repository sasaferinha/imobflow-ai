import { randomUUID } from 'node:crypto';
import {supabaseServiceRequest as db} from './supabase';

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
export function safeMetaMediaUrl(value:unknown){
 if(typeof value!=='string')return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&(url.hostname==='lookaside.fbsbx.com'||url.hostname==='graph.facebook.com')?url.href:'';}catch{return '';}
}
async function boundedImage(response:Response){
 const reader=response.body?.getReader();if(!reader)throw Error('Foto vazia.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_IMAGE_BYTES)throw Error('A foto ultrapassa 5 MB.');chunks.push(part.value);}}
 finally{await reader.cancel();reader.releaseLock();}
 if(!size)throw Error('Foto vazia.');return Buffer.concat(chunks);
}
export function matchesImageSignature(bytes:Uint8Array,type:string){
 const hex=(n:number)=>Array.from(bytes.slice(0,n)).map(b=>b.toString(16).padStart(2,'0')).join('');
 if(type==='image/jpeg')return hex(3)==='ffd8ff';
 if(type==='image/png')return hex(8)==='89504e470d0a1a0a';
 return type==='image/webp'&&Buffer.from(bytes.slice(0,4)).toString()==='RIFF'&&Buffer.from(bytes.slice(8,12)).toString()==='WEBP';
}

export function isWhatsAppMediaPath(value: string, companyId: string) {
  return value.startsWith(`${BUCKET}/${companyId}/`) && /^[a-z-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(jpg|png|webp)$/i.test(value);
}

export async function persistIncomingWhatsAppImage(input: { companyId: string; mediaId: string; mimeType: string; accessToken: string | null; apiVersion: string }) {
  if (!input.accessToken) throw new Error('A conexão WhatsApp não possui token de acesso para baixar fotos.');
  const metadata = await fetch(`https://graph.facebook.com/${input.apiVersion}/${encodeURIComponent(input.mediaId)}`, {
    headers: { Authorization: `Bearer ${input.accessToken}` }, cache: 'no-store', redirect:'error',signal:AbortSignal.timeout(12000),
  });
  if (!metadata.ok) throw new Error(`Não foi possível obter a foto recebida (${metadata.status}).`);
  const details = await metadata.json() as { url?: unknown; mime_type?: unknown };
  const downloadUrl = safeMetaMediaUrl(details.url);
  if (!downloadUrl) throw new Error('A Meta não forneceu um endereço seguro para a foto.');
  const declaredType = typeof details.mime_type === 'string' ? contentType(details.mime_type) : contentType(input.mimeType);
  if (!ACCEPTED_TYPES.has(declaredType)) throw new Error('O tipo de foto recebido não é suportado.');
  const download = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${input.accessToken}` }, cache: 'no-store',redirect:'error',signal:AbortSignal.timeout(12000) });
  if (!download.ok) throw new Error(`Não foi possível baixar a foto recebida (${download.status}).`);
  const receivedType = contentType(download.headers.get('content-type'));
  if (receivedType && receivedType !== declaredType) throw new Error('O tipo da foto recebida não confere.');
  const contentLength = Number(download.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('A foto recebida ultrapassa o limite de 5 MB.');
  const bytes = await boundedImage(download);
  if(!matchesImageSignature(bytes,declaredType))throw Error('O conteúdo não corresponde a uma foto válida.');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('A foto recebida ultrapassa o limite de 5 MB.');
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
  const bytes=await boundedImage(response);
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
