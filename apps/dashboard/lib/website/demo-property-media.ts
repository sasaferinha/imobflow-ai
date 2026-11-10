import { demoProperties } from './demo';

/** Browser-only demo assets. Never written to a company, CRM catalogue or server. */
export const DEMO_PROPERTY_MEDIA_DATABASE = 'imobflow-property-media-demo';
export const DEMO_PROPERTY_MEDIA_EVENT = 'imobflow:property-media-demo';
export const DEMO_PROPERTY_MEDIA_PING = 'imobflow.property-media-demo.ping.v1';
export const DEMO_PROPERTY_PHOTO_MAX_BYTES = 2_000_000;
export const DEMO_PROPERTY_VIDEO_MAX_BYTES = 30_000_000;
const STORE = 'properties';
export type DemoPropertyMedia = { photos: Record<string, string>; video: Blob | null };
export type DemoPropertyMediaMap = Record<string, DemoPropertyMedia>;
type StoredMedia = DemoPropertyMedia & { propertyId: string };

function propertyFor(id: unknown) {
  const property = typeof id === 'string' && demoProperties.find(item => item.id === id);
  if (!property) throw new Error('Escolha um imóvel da demonstração. Nenhum imóvel real pode ser alterado aqui.');
  return property;
}
function photoIndex(propertyId: string, index: unknown): string {
  const property = propertyFor(propertyId);
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= property.images.length) throw new Error('Escolha uma foto válida deste imóvel de demonstração.');
  return String(index);
}
function validPhoto(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > Math.ceil(DEMO_PROPERTY_PHOTO_MAX_BYTES / 3) * 4 + 40) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match?.[2] || match[2].length % 4 !== 0) return false;
  const bytes = match[2].length / 4 * 3 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (bytes > DEMO_PROPERTY_PHOTO_MAX_BYTES || bytes < 12) return false;
  try {
    const head = atob(match[2].slice(0, 24));
    if (match[1] === 'jpeg') return head.charCodeAt(0) === 255 && head.charCodeAt(1) === 216 && head.charCodeAt(2) === 255;
    if (match[1] === 'png') return head.slice(0, 8) === '\x89PNG\r\n\x1a\n';
    return head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  } catch { return false; }
}
function videoShape(input: unknown): input is Blob {
  return typeof Blob !== 'undefined' && input instanceof Blob && input.size >= 12 && input.size <= DEMO_PROPERTY_VIDEO_MAX_BYTES && /^video\/(?:webm|mp4)(?:;\s*codecs=[\w.," -]+)?$/i.test(input.type);
}
async function validVideo(input: unknown): Promise<boolean> {
  if (!videoShape(input)) return false;
  try {
    const head = new Uint8Array(await input.slice(0, 12).arrayBuffer());
    if (input.type.toLowerCase().startsWith('video/webm')) return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    return String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
  } catch { return false; }
}
function normalizedRow(input: unknown, propertyId: string): StoredMedia {
  const value = input && typeof input === 'object' ? input as Partial<StoredMedia> : {};
  const photos: Record<string, string> = {};
  if (value.photos && typeof value.photos === 'object' && !Array.isArray(value.photos)) {
    for (const [key, photo] of Object.entries(value.photos)) {
      try { if (photoIndex(propertyId, Number(key)) === key && validPhoto(photo)) photos[key] = photo; } catch { /* Ignore untrusted/obsolete demo slots. */ }
    }
  }
  return { propertyId, photos, video: videoShape(value.video) ? value.video : null };
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Este navegador não permite guardar as mídias da demonstração.')); return; }
    const request = indexedDB.open(DEMO_PROPERTY_MEDIA_DATABASE, 1);
    let rejected = false;
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'propertyId' }); };
    request.onsuccess = () => { if (rejected) { request.result.close(); return; } resolve(request.result); };
    request.onerror = () => reject(new Error('Não foi possível abrir as mídias salvas neste navegador.'));
    request.onblocked = () => { rejected = true; reject(new Error('Feche outras abas da demonstração e tente novamente.')); };
  });
}
function changed() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(DEMO_PROPERTY_MEDIA_EVENT));
  // A nonce only: never copy image bytes, video URLs or CRM data into localStorage.
  try { window.localStorage.setItem(DEMO_PROPERTY_MEDIA_PING, `${Date.now()}:${Math.random().toString(36).slice(2)}`); } catch { /* Same-tab events still work if localStorage is unavailable. */ }
}
async function update(propertyId: string, mutate: (row: StoredMedia) => StoredMedia | null) {
  propertyFor(propertyId);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('Não foi possível salvar a mídia. Confira o espaço disponível no navegador.'));
      const store = transaction.objectStore(STORE);
      const request = store.get(propertyId);
      request.onsuccess = () => {
        try {
          const next = mutate(normalizedRow(request.result, propertyId));
          if (next) store.put(next); else store.delete(propertyId);
        } catch { transaction.abort(); }
      };
    });
  } finally { database.close(); }
  changed();
}

export async function loadDemoPropertyMedia(): Promise<DemoPropertyMediaMap> {
  const database = await openDatabase();
  let rows: unknown[];
  try {
    rows = await new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly');
      let values: unknown[] = [];
      transaction.oncomplete = () => resolve(values);
      transaction.onerror = transaction.onabort = () => reject(new Error('Não foi possível ler as mídias desta demonstração.'));
      const request = transaction.objectStore(STORE).getAll();
      request.onsuccess = () => { if (Array.isArray(request.result)) values = request.result; };
    });
  } finally { database.close(); }
  const result: DemoPropertyMediaMap = {};
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !('propertyId' in row)) continue;
    try {
      const property = propertyFor(row.propertyId), value = normalizedRow(row, property.id);
      result[property.id] = { photos: value.photos, video: await validVideo(value.video) ? value.video : null };
    } catch { /* Storage is untrusted; only known fictional properties are displayed. */ }
  }
  return result;
}
export async function saveDemoPropertyPhoto(propertyId: string, index: number, dataUrl: string | null): Promise<void> {
  const key = photoIndex(propertyId, index);
  if (dataUrl !== null && !validPhoto(dataUrl)) throw new Error('Use uma foto JPEG, PNG ou WebP válida de até 2 MB.');
  await update(propertyId, row => {
    if (dataUrl === null) delete row.photos[key]; else row.photos[key] = dataUrl;
    return row;
  });
}
export async function saveDemoPropertyVideo(propertyId: string, blob: Blob | null): Promise<void> {
  propertyFor(propertyId);
  if (blob !== null && !await validVideo(blob)) throw new Error('Use um vídeo WebM ou MP4 válido de até 30 MB.');
  await update(propertyId, row => ({ ...row, video: blob }));
}
export async function clearDemoPropertyMedia(propertyId: string): Promise<void> {
  await update(propertyId, () => null);
}
