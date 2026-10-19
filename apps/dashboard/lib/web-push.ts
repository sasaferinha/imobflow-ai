import { createHash, createECDH, ECDH } from 'node:crypto';

export type BrowserPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export class WebPushInputError extends Error {}
const endpointHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
export function validPushEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 4096 || value !== value.trim()) throw new WebPushInputError('Inscrição de notificações inválida.');
  let url: URL;
  try { url = new URL(value); } catch { throw new WebPushInputError('Inscrição de notificações inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || url.pathname.length < 2
    || !(endpointHosts.has(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname))) throw new WebPushInputError('Serviço de notificações não permitido.');
  return url.href;
}
function keyBytes(value: unknown, length: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100) throw new WebPushInputError('Chaves de notificação inválidas.');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) throw new WebPushInputError('Chaves de notificação inválidas.');
  return bytes;
}
export function validatePushSubscription(value: unknown): BrowserPushSubscription {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WebPushInputError('Inscrição de notificações inválida.');
  const input = value as Record<string, unknown>, keys = input.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new WebPushInputError('Chaves de notificação inválidas.');
  const publicKey = keyBytes(keys.p256dh, 65); keyBytes(keys.auth, 16);
  try { ECDH.convertKey(publicKey, 'prime256v1'); } catch { throw new WebPushInputError('Chaves de notificação inválidas.'); }
  return { endpoint: validPushEndpoint(input.endpoint), keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) } };
}
export const pushEndpointHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');
export function webPushConfig(env = process.env) {
  if (env.WEB_PUSH_ENABLED !== 'true') return null;
  try {
    const publicKey = keyBytes(env.VAPID_PUBLIC_KEY, 65), privateKey = keyBytes(env.VAPID_PRIVATE_KEY, 32);
    const pair = createECDH('prime256v1'); pair.setPrivateKey(privateKey);
    if (!pair.getPublicKey().equals(publicKey)) return null;
    const subject = env.VAPID_SUBJECT || '';
    if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject)) return null;
    return { publicKey: publicKey.toString('base64url'), privateKey: privateKey.toString('base64url'), subject,
      schedulerConfigured: env.WEB_PUSH_SCHEDULER_CONFIGURED === 'true' && Boolean(env.CRON_SECRET) };
  } catch { return null; }
}
