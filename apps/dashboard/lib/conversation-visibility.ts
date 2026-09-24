import { currentAccount } from './tenant-context';
import { supabaseCompanyId, supabaseRequest } from './supabase';

export async function hideConversationMessage(messageId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) throw new Error('invalid_message');
  const account = currentAccount();
  if (!account) throw new Error('invalid_broker');
  // The RPC checks the active account and locks conversation ownership. Never DELETE
  // a messages row: that would cascade to the outbox and break webhook deduplication.
  await supabaseRequest('rpc/hide_dashboard_message', { method: 'POST', body: {
    p_company_id: supabaseCompanyId(), p_broker_id: account.brokerId, p_message_id: messageId,
  } });
}

export function messageVisibilityError(error: unknown): { error: string; status: number } {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('message_missing')) return { error: 'Mensagem não encontrada nesta imobiliária.', status: 404 };
  if (code.includes('invalid_message')) return { error: 'Mensagem inválida.', status: 400 };
  if (code.includes('visibility_forbidden') || code.includes('invalid_broker')) return { error: 'Somente o administrador ou o corretor responsável pode remover esta mensagem do painel.', status: 403 };
  if (code.includes('message_in_flight')) return { error: 'Esta mensagem tem um envio pendente ou sem confirmação. Aguarde a conclusão; remover do painel não cancela o envio.', status: 409 };
  if (code.includes('demo_claim_required')) return { error: 'Assuma este atendimento de demonstração antes de remover mensagens.', status: 409 };
  return { error: 'Não foi possível remover a mensagem do painel. Tente novamente.', status: 503 };
}
