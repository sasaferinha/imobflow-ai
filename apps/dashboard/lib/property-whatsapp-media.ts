import sharp from 'sharp';
import { supabaseServiceRequest } from './supabase';
import type { MetaWhatsAppConnection } from './meta-whatsapp';
import { matchesImageSignature } from './whatsapp-media';

const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f-]{36}$/i;
export type PropertyImageAttachment = { propertyId: string; url: string; path: string };

/** Only stored objects belonging to this company are allowed, never arbitrary remote URLs. */
export function propertyImageAttachment(url: string, companyId: string, propertyId: string): PropertyImageAttachment {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  if (!base || !UUID.test(companyId) || !UUID.test(propertyId)) throw new Error('Foto do imóvel inválida.');
  const prefix = `${base}/storage/v1/object/public/property-images/${companyId}/`;
  const filename = url.startsWith(prefix) ? url.slice(prefix.length) : '';
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) throw new Error('Cadastre novamente a foto do imóvel para enviá-la pelo WhatsApp.');
  return { propertyId, url, path: `property-images/${companyId}/${filename}` };
}

export async function uploadPropertyWhatsAppImage(companyId: string, attachment: PropertyImageAttachment, connection: MetaWhatsAppConnection, deadline = Date.now() + 45000) {
  const timeout = (maximum: number) => {
    const remaining = deadline - Date.now() - 24000; // Reserve the message POST and receipt persistence.
    if (remaining <= 0) throw new Error('Orçamento de preparação da foto esgotado.');
    return Math.min(maximum, remaining);
  };
  const checked = propertyImageAttachment(attachment.url, companyId, attachment.propertyId);
  if (checked.path !== attachment.path) throw new Error('Foto do imóvel inválida.');
  const [property] = await supabaseServiceRequest<Array<{ images: unknown; status: string }>>(
    `properties?company_id=eq.${companyId}&id=eq.${checked.propertyId}&select=images,status&limit=1`, { timeoutMs: timeout(4000) },
  );
  if (!property || ['Vendido', 'Alugado'].includes(property.status) || !Array.isArray(property.images) || !property.images.includes(checked.url)) {
    throw new Error('A foto não pertence a um imóvel disponível nesta imobiliária.');
  }
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret || !connection.accessToken || !/^v\d+\.\d+$/.test(connection.apiVersion) || !/^\d+$/.test(connection.phoneNumberId)) throw new Error('Integração de mídia indisponível.');
  // Read through the authenticated object endpoint. Credentials never go to the stored URL.
  const response = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, '')}/storage/v1/object/authenticated/${checked.path}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` }, redirect: 'error',
    cache: 'no-store', signal: AbortSignal.timeout(timeout(8000)),
  });
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type) || Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Foto indisponível ou fora do limite de 5 MB.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Foto vazia.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_BYTES) throw new Error('Foto maior que 5 MB.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const original = Buffer.concat(chunks);
  if (!size || !matchesImageSignature(original, type)) throw new Error('Conteúdo da foto inválido.');
  // The dashboard stores WebP; Meta photo messages accept JPEG/PNG. Strip metadata,
  // bound decoded pixels and dimensions, and upload a real JPEG (not a renamed WebP).
  const jpeg = await sharp(original, { limitInputPixels: 24_000_000, failOn: 'error' }).rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  if (jpeg.length > MAX_BYTES) throw new Error('Foto maior que 5 MB.');
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', 'image/jpeg');
  form.set('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'imovel.jpg');
  // Uploading creates an asset, not a message. Retrying this step cannot message the client twice.
  const uploaded = await fetch(`https://graph.facebook.com/${connection.apiVersion}/${connection.phoneNumberId}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${connection.accessToken}` }, body: form,
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeout(10000)),
  });
  const result = await uploaded.json().catch(() => ({})) as { id?: unknown };
  if (!uploaded.ok || typeof result.id !== 'string' || !/^\d{1,100}$/.test(result.id)) throw new Error('Não foi possível preparar a foto no WhatsApp.');
  return result.id;
}
