import { AsyncLocalStorage } from 'node:async_hooks';

export type Account = { companyId: string; company: string; brokerId: string; name: string; role: 'owner' | 'broker' };
const context = new AsyncLocalStorage<Account>();
export const LEGACY_COMPANY_ID = process.env.SUPABASE_COMPANY_ID || '00000000-0000-4000-8000-000000000001';
export function currentAccount() { return context.getStore(); }
export function requireCompanyId() {
  const id = currentAccount()?.companyId;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error('Contexto da empresa ausente.');
  return id;
}
export function withAccount<T>(account: Account, run: () => T): T { return context.run(account, run); }
export function bindAccount<T>(run: () => T): () => T {
  const account = currentAccount();
  if (!account) throw new Error('Contexto da empresa ausente.');
  return () => withAccount(account, run);
}
