/** Public OAuth guidance is a fixed allowlist, never provider text or identifiers. */
const feedback = {
  authorization_cancelled: 'A autorização foi cancelada. Volte à conexão do Instagram e tente novamente quando quiser.',
  oauth_expired: 'Esta tentativa expirou. Volte à conexão do Instagram e inicie novamente no mesmo navegador.',
  permissions_missing: 'Autorize o acesso às mensagens na tela oficial do Instagram para concluir a conexão.',
  account_not_professional: 'Use uma conta profissional do Instagram, do tipo empresa ou criador, e tente novamente.',
  account_bound: 'Esta conta já possui outro vínculo na ImobFlow. Peça ajuda ao suporte para conferir o vínculo antes de tentar novamente.',
  account_disconnect_required: 'Desconecte o Instagram atual no painel antes de conectar outra conta. O histórico será preservado.',
  provider_unavailable: 'O Instagram não respondeu a tempo. Aguarde um pouco e inicie uma nova tentativa pelo painel.',
  provider_rejected: 'O Instagram não autorizou a conexão. Confira se a conta é profissional e se o aplicativo tem acesso às mensagens.',
  provider_rate_limit: 'O Instagram limitou as tentativas. Aguarde alguns minutos antes de tentar novamente.',
  instagram_unavailable: 'A conexão do Instagram precisa ser habilitada pela equipe da ImobFlow. Seus dados de acesso não são necessários para essa configuração.',
  owner_required: 'Entre na ImobFlow como administrador da imobiliária e inicie uma nova conexão do Instagram.',
  subscription_failed: 'O Instagram não confirmou o recebimento de mensagens. Tente novamente; se continuar, peça ajuda ao suporte da ImobFlow.',
  connection_failed: 'Não foi possível concluir a conexão do Instagram. Volte ao painel e tente novamente; se continuar, peça ajuda ao suporte da ImobFlow.',
} as const;

export type InstagramConnectionIssue = keyof typeof feedback;
export function instagramConnectionIssue(value: unknown): InstagramConnectionIssue {
  return typeof value === 'string' && Object.hasOwn(feedback, value) ? value as InstagramConnectionIssue : 'connection_failed';
}
export function instagramConnectionFeedback(value: unknown) {
  return feedback[instagramConnectionIssue(value)];
}
