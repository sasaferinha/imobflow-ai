import { WebsiteError } from './model';

/** Only Host is authoritative here. Forwarded/custom headers never select a tenant. */
export function requestHostname(headers: Pick<Headers, 'get'>): string {
  const raw = headers.get('host') || '';
  if (!raw || raw !== raw.trim() || /[\s,/@?#\\%]/u.test(raw)) return '';
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(raw);
  if (!match || match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return '';
  return match[1].toLowerCase().replace(/\.$/, '');
}

export function coreWebsiteHosts(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const hosts = new Set(['imobflow.net.br', 'www.imobflow.net.br']);
  const origins = [env.APP_BASE_URL, env.SITE_URL, ...(env.WEBSITE_TRUSTED_ORIGINS || '').split(',')];
  for (const value of origins) {
    if (!value) continue;
    try { const url = new URL(value.trim()); if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash) hosts.add(url.hostname.toLowerCase()); } catch { /* Invalid trusted origins do not broaden the allowlist. */ }
  }
  for (const value of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (value && /^[a-z0-9-]+\.vercel\.app$/i.test(value)) hosts.add(value.toLowerCase());
  }
  if (env.NODE_ENV !== 'production') { hosts.add('localhost'); hosts.add('127.0.0.1'); }
  return hosts;
}

export function isCoreWebsiteHost(hostname: string, env: NodeJS.ProcessEnv = process.env) { return coreWebsiteHosts(env).has(hostname); }

export function normalizeCustomHostname(input: unknown, env: NodeJS.ProcessEnv = process.env): string {
  if (typeof input !== 'string') throw new WebsiteError('Informe somente o domínio, sem https:// ou caminhos.');
  const hostname = input.trim().toLowerCase().replace(/\.$/, '');
  // Leave room for the independent _imobflow-domain TXT label in the DNS name.
  if (hostname.length > 237 || hostname.length < 4 || !hostname.includes('.') || hostname.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) || !/^[a-z]{2,63}$/.test(hostname.split('.').at(-1) || '') || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|arpa|corp|test|invalid|example|onion)$/.test(hostname)) throw new WebsiteError('Use um domínio público válido, sem protocolo, porta, curinga ou caminho.');
  if (isCoreWebsiteHost(hostname, env) || hostname === 'imobflow.net.br' || hostname.endsWith('.imobflow.net.br') || hostname === 'vercel.app' || hostname.endsWith('.vercel.app') || hostname === 'vercel.com' || hostname.endsWith('.vercel.com') || hostname.endsWith('.supabase.co')) throw new WebsiteError('Este endereço é reservado à plataforma. Use o domínio da sua imobiliária.');
  return hostname;
}

export function allowedCustomPath(pathname: string, slug: string, method: string): 'root' | 'site' | 'asset' | null {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug)) return null;
  if ((method === 'GET' || method === 'HEAD') && pathname === '/') return 'root';
  if ((method === 'GET' || method === 'HEAD') && pathname === `/imobiliaria/${slug}`) return 'site';
  if ((method === 'GET' || method === 'HEAD') && pathname === `/api/site/${slug}`) return 'site';
  if (method === 'POST' && pathname === `/api/site/${slug}/inquiry`) return 'site';
  if ((method === 'GET' || method === 'HEAD') && (pathname.startsWith('/_next/static/') || pathname === '/favicon.ico' || /^\/website\/[a-z0-9/_-]+\.(?:png|jpe?g|webp|svg)$/i.test(pathname))) return 'asset';
  return null;
}
