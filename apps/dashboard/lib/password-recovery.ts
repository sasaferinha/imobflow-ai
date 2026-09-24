import { newToken, tokenHash } from './accounts';
import { supabaseRequest } from './supabase';

type DeliveryFailure = 'credentials' | 'rejected' | 'rate_limit' | 'provider_unavailable' | 'timeout' | 'connection';
export type RecoveryAccount = { id: string; company_id: string; email: string | null; password_hash: string; active: boolean; role: 'owner' | 'broker'; auth_version: number };
type PasswordEmailConfig = { configured: boolean; apiKeySet: boolean; from: string; replyTo: string; baseUrl: string };

class PasswordEmailDeliveryError extends Error {
  constructor(readonly category: DeliveryFailure, readonly status?: number) {
    super('Password email delivery failed');
  }
}

// Never log provider response bodies, addresses, reset links or credentials.
export function passwordRecoveryFailure(error: unknown) {
  return error instanceof PasswordEmailDeliveryError
    ? { category: error.category, ...(error.status === undefined ? {} : { status: error.status }) }
    : { category: 'internal' };
}

function cleanupAddress(input: string | undefined) {
  return (input || '').trim();
}

function getTextReplyTo() {
  return cleanupAddress(process.env.PASSWORD_EMAIL_REPLY_TO) || 'imobflow.ai@gmail.com';
}

function getFromAddress() {
  return cleanupAddress(process.env.PASSWORD_EMAIL_FROM) || 'ImobFlow <noreply@resend.dev>';
}

export function passwordEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && getFromAddress());
}

export function welcomeEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && getFromAddress());
}

export function passwordEmailConfig(): PasswordEmailConfig {
  return {
    configured: passwordEmailConfigured(),
    apiKeySet: Boolean(process.env.RESEND_API_KEY),
    from: getFromAddress(),
    replyTo: getTextReplyTo(),
    baseUrl: (() => {
      try {
        return recoveryBaseUrl();
      } catch {
        return 'https://www.imobflow.net.br';
      }
    })(),
  };
}

export function recoveryBaseUrl(origin?: string) {
  let base = origin || process.env.APP_BASE_URL;
  if (!base) {
    const vercelHost = process.env.VERCEL_URL || '';
    if (vercelHost) base = `https://${vercelHost}`;
  }
  const url = new URL(base || 'https://imobflow-ai-rosy.vercel.app');
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid recovery origin');
  return url.origin;
}

export async function issuePasswordLink(
  account: RecoveryAccount,
  actor?: Pick<RecoveryAccount,'id'|'password_hash'|'auth_version'>,
  origin?: string,
) {
  const baseUrl = recoveryBaseUrl(origin);
  const token = newToken();
  const issued = actor
    ? await supabaseRequest<boolean>('rpc/issue_company_broker_password_reset', {method:'POST',body:{p_actor_id:actor.id,p_actor_hash:actor.password_hash,p_actor_auth_version:actor.auth_version,p_broker_id:account.id,p_token_hash:tokenHash(token)}})
    : await supabaseRequest<boolean>('rpc/issue_account_password_reset', {
      method:'POST',
      body: { p_broker_id: account.id, p_token_hash: tokenHash(token), p_expected_hash: account.password_hash, p_expected_email: account.email, p_expected_auth_version: account.auth_version },
    });
  if (!issued) throw new Error('Inactive or changed account');
  // Fragment is not transmitted to server/access logs or in Referer headers.
  return `${baseUrl}/painel/redefinir-senha#token=${token}`;
}

export async function sendPasswordEmail(account: RecoveryAccount, origin?: string) {
  if (!passwordEmailConfigured() || !account.email) return;
  const url = await issuePasswordLink(account, undefined, origin);
  const from = getFromAddress();
  const replyTo = getTextReplyTo();
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        reply_to: replyTo,
        to: [account.email],
        subject: 'Redefina sua senha do ImobFlow',
        text:
`Recebemos um pedido para redefinir sua senha.\n\nAcesse o link abaixo e escolha uma nova senha:\n${url}\n\nO link expira em 30 minutos e só pode ser utilizado uma vez. Se não fez este pedido, ignore este e-mail. Sua senha atual não foi alterada.`,
        html:
`<p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${url}">Clique aqui para redefinir sua senha</a></p><p>O link expira em 30 minutos e só pode ser usado uma vez. Se não fez este pedido, ignore este e-mail.</p>`,
      }),
    });
  } catch (error) {
    const timedOut = error && typeof error === 'object' && 'name' in error
      && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new PasswordEmailDeliveryError(timedOut ? 'timeout' : 'connection');
  }
  if (!response.ok) {
    const category = response.status === 401 ? 'credentials'
      : response.status === 429 ? 'rate_limit'
        : response.status >= 500 ? 'provider_unavailable'
          : 'rejected';
    throw new PasswordEmailDeliveryError(category, response.status);
  }
}

export async function sendWelcomeEmail(account: RecoveryAccount, metadata: { company: string; role: string }) {
  if (!welcomeEmailConfigured() || !account.email) return;
  const from = getFromAddress();
  const replyTo = getTextReplyTo();
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        reply_to: replyTo,
        to: [account.email],
        subject: 'Bem-vindo(a) ao ImobFlow',
        text:
`Olá, ${account.email}\n\nSua conta foi criada para a imobiliária ${metadata.company} com acesso do tipo ${metadata.role}.\n\nAcesse o painel do ImobFlow em https://www.imobflow.net.br/painel e faça login com este e-mail e a senha cadastrada.\n\nSe você não reconhece este cadastro, entre em contato com o suporte do ImobFlow.\n`,
        html:
`<p>Olá, ${account.email}</p><p>Sua conta foi criada para a imobiliária <strong>${metadata.company}</strong> com acesso do tipo <strong>${metadata.role}</strong>.</p><p><a href="https://www.imobflow.net.br/painel">Acessar painel do ImobFlow</a></p><p>Se você não reconhece este cadastro, entre em contato com o suporte do ImobFlow.</p>`,
      }),
    });
  } catch (error) {
    const timedOut = error && typeof error === 'object' && 'name' in error
      && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new PasswordEmailDeliveryError(timedOut ? 'timeout' : 'connection');
  }
  if (!response.ok) {
    const category = response.status === 401 ? 'credentials'
      : response.status === 429 ? 'rate_limit'
        : response.status >= 500 ? 'provider_unavailable'
          : 'rejected';
    throw new PasswordEmailDeliveryError(category, response.status);
  }
}
