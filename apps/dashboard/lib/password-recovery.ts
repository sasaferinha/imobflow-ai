import { newToken, tokenHash } from './accounts';
import { supabaseRequest } from './supabase';

export type RecoveryAccount = { id: string; company_id: string; email: string | null; password_hash: string; active: boolean; role: 'owner' | 'broker'; auth_version: number };
export function passwordEmailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_EMAIL_FROM); }
export function recoveryBaseUrl() {
  const url = new URL(process.env.APP_BASE_URL || 'https://imobflow-ai-rosy.vercel.app');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid recovery origin');
  return url.origin;
}
export async function issuePasswordLink(account: RecoveryAccount, actor?: Pick<RecoveryAccount,'id'|'password_hash'|'auth_version'>) {
  const token = newToken();
  const issued = actor ? await supabaseRequest<boolean>('rpc/issue_company_broker_password_reset', {method:'POST',body:{p_actor_id:actor.id,p_actor_hash:actor.password_hash,p_actor_auth_version:actor.auth_version,p_broker_id:account.id,p_token_hash:tokenHash(token)}}) : await supabaseRequest<boolean>('rpc/issue_account_password_reset', { method: 'POST', body: {
    p_broker_id: account.id, p_token_hash: tokenHash(token), p_expected_hash: account.password_hash, p_expected_email: account.email, p_expected_auth_version: account.auth_version,
  } });
  if (!issued) throw new Error('Inactive or changed account');
  // Fragment is not transmitted to server/access logs or in Referer headers.
  return `${recoveryBaseUrl()}/painel/redefinir-senha#token=${token}`;
}
export async function sendPasswordEmail(account: RecoveryAccount) {
  if (!passwordEmailConfigured() || !account.email) return;
  const url = await issuePasswordLink(account);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.PASSWORD_EMAIL_FROM, to: [account.email], subject: 'Redefina sua senha do ImobFlow',
      text: `Recebemos um pedido para redefinir sua senha. Abra o link abaixo e escolha uma nova senha:\n\n${url}\n\nO link expira em 30 minutos e só pode ser utilizado uma vez. Se não fez este pedido, ignore este e-mail. Sua senha atual não foi alterada.` }),
  });
  if (!response.ok) throw new Error('Password email provider failed');
}
