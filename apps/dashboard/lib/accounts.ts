import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseRequest } from './supabase';
import { type Account, withAccount } from './tenant-context';

export const ACCOUNT_COOKIE = 'imobflow_session';
export const SESSION_SECONDS = 12 * 60 * 60;
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/', maxAge: SESSION_SECONDS };
export const normalizeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
export const normalizeEmail = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [version, salt, encoded, extra] = hash.split('$');
  if (extra || version !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(encoded || '')) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(encoded, 'hex'));
}
type BrokerRow = { id: string; company_id: string; name: string; role: 'owner' | 'broker'; password_hash: string; active: boolean; auth_version: number };
export async function authenticate(company: string, email: string, password: string): Promise<(Account & { passwordVersion: string; authVersion: number }) | null> {
  const companies = await supabaseRequest<Array<{ company_id: string; name: string }>>(`account_companies?name_key=eq.${encodeURIComponent(normalizeName(company))}&select=company_id,name&limit=1`);
  const brokers = companies[0] ? await supabaseRequest<BrokerRow[]>(`broker_accounts?company_id=eq.${companies[0].company_id}&email_key=eq.${encodeURIComponent(normalizeEmail(email))}&select=*&limit=1`) : [];
  const broker = brokers[0];
  // Equivalent expensive work for missing users avoids a cheap username oracle.
  const valid = await verifyPassword(password, broker?.password_hash || `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(128)}`);
  if (!broker?.active || !valid) return null;
  return { companyId: broker.company_id, company: companies[0].name, brokerId: broker.id, name: broker.name, role: broker.role, passwordVersion: broker.password_hash, authVersion: broker.auth_version };
}
export async function readAccount(token?: string): Promise<Account | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await supabaseRequest<Array<{ broker_id: string; company_id: string; name: string; company: string; role: 'owner' | 'broker' }>>('rpc/account_session', { method: 'POST', body: { p_hash: tokenHash(token) } });
  const row = rows[0];
  return row ? { brokerId: row.broker_id, companyId: row.company_id, name: row.name, company: row.company, role: row.role } : null;
}
export async function issueSession(account: Account, expectedHash: string, expectedAuthVersion: number) {
  const token = newToken();
  const issued = await supabaseRequest<boolean>('rpc/issue_account_session', { method: 'POST', body: { p_token_hash: tokenHash(token), p_broker_id: account.brokerId, p_expected_hash: expectedHash, p_expected_auth_version: expectedAuthVersion } });
  if (!issued) throw new Error('account_changed_during_login');
  return token;
}
export function protectedRoute<C>(handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: NextRequest, context: C) => {
    try {
      const account = await readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value);
      if (!account) return NextResponse.json({ error: 'Entre na sua conta para continuar.' }, { status: 401 });
      const response = await withAccount(account, () => handler(request, context));
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      return response;
    } catch { return NextResponse.json({ error: 'Não foi possível verificar o acesso. Tente novamente.' }, { status: 503 }); }
  };
}
