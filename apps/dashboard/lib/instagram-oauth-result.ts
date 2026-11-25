import { SocialError } from './social-model';

// Public diagnostics are fixed strings. Never render a provider error, URL,
// exception message or any authorization parameter on the return page.
const messages = {
  cancelled: 'Você cancelou a autorização no Instagram. Volte ao painel e conecte novamente quando quiser.',
  expired: 'A tentativa expirou ou não corresponde a este navegador. Inicie uma nova conexão pelo painel.',
  configuration_unavailable: 'A conexão do Instagram está indisponível na ImobFlow. Peça ao suporte para conferir a configuração antes de tentar novamente.',
  permissions_missing: 'O acesso às mensagens não foi autorizado. Inicie novamente e permita os acessos solicitados pelo Instagram.',
  owner_required: 'Somente o administrador ativo da imobiliária pode concluir esta conexão. Entre com esse acesso e inicie novamente.',
  account_conflict: 'Esta conta ou imobiliária já possui outro vínculo de Instagram. Confira as conexões no painel antes de tentar novamente.',
  professional_required: 'Conecte uma conta profissional do Instagram, do tipo empresa ou criador de conteúdo.',
  provider_unavailable: 'O Instagram não respondeu à conexão. Aguarde alguns minutos e inicie novamente pelo painel.',
  provider_rate_limit: 'O Instagram limitou as tentativas de conexão. Aguarde alguns minutos antes de iniciar novamente.',
  provider_rejected: 'O Instagram recusou a autorização. Confira a conta profissional e os acessos solicitados. Se persistir, envie a referência ao suporte.',
  subscription_failed: 'O Instagram autorizou a conta, mas não foi possível ativar o recebimento de mensagens. Tente conectar novamente; se persistir, envie a referência ao suporte.',
  failed: 'Não foi possível concluir a conexão do Instagram. Tente novamente pelo painel; se persistir, envie a referência ao suporte.',
} as const;

export type InstagramOAuthFailure = keyof typeof messages;

export function instagramOAuthFailure(value: unknown): InstagramOAuthFailure | null {
  return typeof value === 'string' && Object.hasOwn(messages, value) ? value as InstagramOAuthFailure : null;
}

export function instagramOAuthFailureMessage(reason: InstagramOAuthFailure): string {
  return messages[reason];
}

export function classifyInstagramOAuthFailure(error: unknown): InstagramOAuthFailure {
  if (error instanceof SocialError) {
    const reason = instagramOAuthFailure(error.code);
    if (reason) return reason;
    if (error.status === 403) return 'owner_required';
  }
  return 'failed';
}

export function instagramOAuthReference(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f\d]{24}$/.test(value) ? value : null;
}
