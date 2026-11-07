import { randomUUID } from 'node:crypto';
import { WebsiteError } from './model';

export const WEBSITE_IMAGE_LIMIT = 2 * 1024 * 1024;

/** Decode only supported raster formats; SVG and executable uploads are not accepted. */
export function decodeWebsiteImage(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_800_000) throw new WebsiteError('Escolha uma imagem JPG, PNG ou WebP de até 2 MB.', 413);
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new WebsiteError('Escolha uma imagem JPG, PNG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > WEBSITE_IMAGE_LIMIT) throw new WebsiteError('A imagem deve ter até 2 MB.', 413);
  if (bytes.toString('base64') !== match[2]) throw new WebsiteError('Não foi possível ler a imagem.');
  const format = match[1];
  const valid = format === 'jpeg' ? bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new WebsiteError('O conteúdo do arquivo não corresponde ao formato da imagem.');
  return { bytes, contentType: `image/${format}`, extension: format === 'jpeg' ? 'jpg' : format };
}

export async function storeWebsiteImage(companyId: string, value: unknown): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(companyId)) throw new WebsiteError('Empresa inválida.', 403);
  const image = decodeWebsiteImage(value);
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new WebsiteError('O armazenamento de imagens está indisponível.', 503);
  const path = `website-media/${companyId}/${randomUUID()}.${image.extension}`;
  const response = await fetch(`${base}/storage/v1/object/${path}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': image.contentType, 'x-upsert': 'false' },
    body: new Uint8Array(image.bytes), cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new WebsiteError('Não foi possível enviar a imagem. Tente novamente.', 503);
  return `${base}/storage/v1/object/public/${path}`;
}
