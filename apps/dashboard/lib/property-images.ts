import { randomUUID } from 'node:crypto';
import { supabaseCompanyId } from './supabase';

const BUCKET = 'property-images';

function configuration() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!baseUrl || !secretKey) throw new Error('Supabase não configurado');
  return { baseUrl, secretKey };
}

function isManagedUrl(value: string, baseUrl: string) {
  return value.startsWith(`${baseUrl}/storage/v1/object/public/${BUCKET}/`);
}

export async function persistPropertyImages(images: string[]) {
  const { baseUrl, secretKey } = configuration();
  const stored: string[] = [];

  for (const image of images.slice(0, 5)) {
    if (isManagedUrl(image, baseUrl)) {
      stored.push(image);
      continue;
    }

    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match) continue;
    const contentType = `image/${match[1]}`;
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 800_000) throw new Error('Uma das imagens ultrapassa o limite permitido.');
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
    const objectPath = `${supabaseCompanyId()}/${randomUUID()}.${extension}`;
    const response = await fetch(`${baseUrl}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body: bytes,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Não foi possível armazenar uma das fotos (${response.status}).`);
    stored.push(`${baseUrl}/storage/v1/object/public/${BUCKET}/${objectPath}`);
  }

  return stored;
}

