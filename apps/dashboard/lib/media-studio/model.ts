import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { decodeWebsiteImage } from '../website/media';

export const MEDIA_MODELS = { photo: 'gpt-image-2.6-sunburst', video: 'gen4_turbo' } as const;
export const MEDIA_INPUT_LIMIT = 2 * 1024 * 1024;
export const MEDIA_BODY_LIMIT = 2_850_000;
export const MEDIA_RESULT_LIMIT = 30_000_000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const photoCounts: Record<string, number> = { 'demo-casa-jardim': 3, 'demo-apartamento-centro': 2, 'demo-casa-verde': 2, 'demo-apartamento-serra': 2 };
export type MediaKind = 'photo' | 'video';
export type MediaJobRow = {
  id: string; company_id: string; actor_id: string; request_id: string; request_hash: string;
  kind: MediaKind; property_id: string; photo_index: number; format: 'landscape' | 'portrait';
  provider: 'openai' | 'runway'; model: string;
  status: 'reserved' | 'submitting' | 'processing' | 'completed' | 'failed' | 'unknown';
  provider_task_id: string | null; input_path: string | null; result_path: string | null;
  result_mime: string | null; result_bytes: number | null; provider_usage: unknown; error_code: string | null;
  created_at: string; updated_at: string; expires_at: string; poll_after: string; purged_at: string | null;
};
export class MediaError extends Error {
  constructor(public code: string, public status = 400) { super(mediaErrorMessage(code)); }
}
export function mediaErrorMessage(code: string | null) {
  switch (code) {
    case 'media_forbidden': return 'Somente o administrador autorizado pode usar a IA neste modelo.';
    case 'media_not_enabled': case 'media_feature_disabled': return 'A IA ainda não foi habilitada para esta imobiliária.';
    case 'media_not_found': return 'Geração não encontrada nesta conta.';
    case 'media_expired': return 'O prazo de sete dias para recuperar esta geração terminou.';
    case 'media_reservation_expired': return 'Este pedido não chegou a ser enviado e venceu. Inicie uma nova geração.';
    case 'media_request_conflict': return 'Este pedido já existe com outra foto. Confira as gerações recentes.';
    case 'media_daily_limit': case 'media_global_limit': return 'O limite de gerações de hoje foi atingido.';
    case 'media_ai_openai_not_configured': return 'A conexão de fotos com a OpenAI ainda precisa ser configurada.';
    case 'media_ai_runway_not_configured': return 'A conexão de vídeos com a Runway ainda precisa ser configurada.';
    case 'media_ai_payment_required': return 'O serviço de IA precisa de créditos. Peça ao responsável para conferir a conta.';
    case 'media_ai_authentication_failed': return 'O serviço de IA recusou o acesso. Peça ao responsável para revisar a conexão.';
    case 'media_ai_content_rejected': case 'media_ai_request_rejected': return 'O serviço de IA não aceitou esta imagem.';
    case 'media_ai_rate_limited': return 'O serviço de IA está ocupado. Aguarde antes de criar outro pedido.';
    case 'media_unknown': return 'Não foi possível confirmar a geração. O pedido não será reenviado para evitar uma cobrança duplicada.';
    case 'media_ai_video_failed': case 'media_ai_video_cancelled': return 'O serviço não concluiu o vídeo. Confira o histórico antes de gerar novamente.';
    case 'media_invalid_request': case 'media_ai_invalid_input': return 'Escolha uma foto válida do modelo para continuar.';
    case 'media_ai_input_too_large': return 'Escolha uma foto de até 2 MB.';
    case 'media_storage_unavailable': return 'Não foi possível guardar ou recuperar o arquivo. Tente recuperar a geração pelo histórico.';
    case 'media_origin': return 'Abra o estúdio na ImobFlow para continuar.';
    case 'media_not_ready': return 'O arquivo ainda não está pronto.';
    default: return 'Não foi possível concluir esta etapa. Confira as gerações recentes antes de tentar novamente.';
  }
}
export function jobView(row: MediaJobRow) {
  // A process killed after submission must never invite a second paid request.
  const stale = row.status === 'submitting' && Date.parse(row.updated_at) < Date.now() - 5 * 60_000;
  const status = stale ? 'unknown' : row.status;
  return { id: row.id, kind: row.kind, propertyId: row.property_id, photoIndex: row.photo_index, format: row.format,
    status, createdAt: row.created_at, expiresAt: row.expires_at,
    ...((status === 'unknown' || row.error_code) ? { error: mediaErrorMessage(status === 'unknown' ? 'media_unknown' : row.error_code) } : {}),
    resultAvailable: status === 'completed' && Boolean(row.result_path) && !row.purged_at && Date.parse(row.expires_at) > Date.now() };
}
export function parseMediaRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MediaError('media_invalid_request');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'format,imageDataUrl,kind,photoIndex,propertyId,requestId') throw new MediaError('media_invalid_request');
  const { requestId, kind, propertyId, photoIndex, format } = data;
  if (typeof requestId !== 'string' || !UUID.test(requestId) || (kind !== 'photo' && kind !== 'video') ||
    typeof propertyId !== 'string' || !Object.hasOwn(photoCounts, propertyId) || !Number.isInteger(photoIndex) ||
    (photoIndex as number) < 0 || (photoIndex as number) >= photoCounts[propertyId] || (format !== 'landscape' && format !== 'portrait')) throw new MediaError('media_invalid_request');
  let image: ReturnType<typeof decodeWebsiteImage>;
  try { image = decodeWebsiteImage(data.imageDataUrl); } catch { throw new MediaError('media_ai_invalid_input'); }
  const hash = createHash('sha256').update(JSON.stringify([kind, propertyId, photoIndex, format])).update(image.bytes).digest('hex');
  return { requestId: requestId.toLowerCase(), kind: kind as MediaKind, propertyId, photoIndex: photoIndex as number, format: format as 'landscape' | 'portrait', image, hash };
}
export async function normalizeMediaImage(bytes: Uint8Array, output = false) {
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 16_000_000, animated: false });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width < 64 || meta.height < 64 || (meta.pages || 1) !== 1 || !['jpeg', 'png', 'webp'].includes(meta.format || '')) throw new Error('image');
    const normalized = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    if (!normalized.length || normalized.length > MEDIA_INPUT_LIMIT) throw new Error('size');
    return { bytes: new Uint8Array(normalized), contentType: 'image/jpeg' as const };
  } catch { throw new MediaError(output ? 'media_ai_invalid_output' : 'media_ai_invalid_input'); }
}
export async function readMediaJson(request: Request, maximum = MEDIA_BODY_LIMIT): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new MediaError('media_invalid_request', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > maximum) throw new MediaError('media_ai_input_too_large', 413);
  if (!request.body) throw new MediaError('media_invalid_request');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maximum) { await reader.cancel(); throw new MediaError('media_ai_input_too_large', 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof MediaError) throw error; throw new MediaError('media_invalid_request'); }
  finally { reader.releaseLock(); }
}
