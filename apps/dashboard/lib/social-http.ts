import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimit, hasSafeRequestSize, hasSameOrigin } from './request-security';
import { SocialError, socialObject } from './social-model';

export async function socialBody(request: NextRequest, allowed: string[], limit = 32768) {
  if (!request.headers.get('origin') || !hasSameOrigin(request)) throw new SocialError('Origem não permitida.',403);
  if (!hasSafeRequestSize(request,limit)) throw new SocialError('Requisição muito grande.',413);
  if (!await consumeRateLimit(request,'social-mutation',60,60)) throw new SocialError('Aguarde um minuto antes de tentar novamente.',429);
  const raw = await request.text(); if (Buffer.byteLength(raw)>limit) throw new SocialError('Requisição muito grande.',413);
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new SocialError('Dados inválidos.',400); }
  const body = socialObject(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(body).some(k=>!allowed.includes(k))) throw new SocialError('Dados inválidos.',400);
  return body;
}
export function socialFailure(error: unknown) {
  if (error instanceof SocialError) return NextResponse.json({error:error.message,code:error.code},{status:error.status,headers:{'Cache-Control':'private, no-store'}});
  const message = error instanceof Error ? error.message : '';
  const errors: Array<[string,string,number]> = [
    ['broker_compliance_pending','Conclua os registros ou atividades pendentes antes de receber novos atendimentos.',409],
    ['duty_priority_wait','Este atendimento está reservado ao plantonista online por alguns minutos.',409],
    ['social_claim_required','Assuma o atendimento antes de enviar.',409],
    ['social_window_closed','A janela de 24 horas terminou. Aguarde uma nova mensagem do cliente neste canal.',409],
    ['social_handoff','O atendimento mudou ou chegou uma nova mensagem. Atualize a conversa.',409],
    ['social_sending','Um envio está em andamento. Aguarde a confirmação antes de mudar o atendimento.',409],
    ['social_account_bound','Esta conta Meta já está conectada a outra imobiliária.',409],
    ['social_account_change_requires_support','Para trocar a conta conectada, solicite a migração ao suporte. O histórico será preservado.',409],
    ['social_connection_unavailable','A conexão deste canal está desativada. Peça ao administrador para reconectar.',409],
    ['social_idempotency_conflict','O identificador deste envio já foi usado para outro conteúdo.',409],
    ['social_rate_limited','Muitas mensagens em sequência. Aguarde um minuto.',429],
    ['social_owner_required','Somente o administrador pode ativar o atendimento automático.',403],
    ['social_forbidden','Seu acesso não permite alterar este atendimento.',403],
  ];
  const known = errors.find(([key])=>message.includes(key));
  if (known) return NextResponse.json({error:known[1],code:known[0]},{status:known[2],headers:{'Cache-Control':'private, no-store'}});
  console.error('social_operation_failed');
  return NextResponse.json({error:'Não foi possível confirmar a operação. Atualize a tela antes de tentar novamente.'},{status:503,headers:{'Cache-Control':'private, no-store'}});
}
