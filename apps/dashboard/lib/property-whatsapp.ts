import { currentAccount } from './tenant-context';
import { supabaseServiceRequest as db } from './supabase';
import { loadMetaWhatsAppConnectionForCompany } from './meta-whatsapp-connections';
import { sendQueuedMessage } from './message-outbox';

export async function propertyWhatsAppContext(opportunityId: string) {
  const actor = currentAccount();
  if (!actor) throw new Error('unauthorized');
  const context = await db<{ conversationId: string; phoneNumberId: string | null; recipient: string; phone: string }>('rpc/property_whatsapp_context', { method: 'POST', body: { p_company_id: actor.companyId, p_broker_id: actor.brokerId, p_opportunity_id: opportunityId } });
  const connections = (await loadMetaWhatsAppConnectionForCompany(actor.companyId)).filter(item => item.enabled && item.accessToken);
  const connection = context.phoneNumberId ? connections.find(item => item.phoneNumberId === context.phoneNumberId) : connections.length === 1 ? connections[0] : undefined;
  if (!connection) throw new Error('whatsapp_connection_required');
  return { ...context, phoneNumberId: connection.phoneNumberId };
}

export async function queuePropertyOffer(input: { opportunityId: string; requestId: string; content: string; images: string[] }) {
  const actor = currentAccount();
  if (!actor) throw new Error('unauthorized');
  const context = await propertyWhatsAppContext(input.opportunityId);
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  if (input.images.some(image => !base || !image.startsWith(`${base}/storage/v1/object/public/property-images/${actor.companyId}/`) || !/\.(jpe?g|png)$/.test(image))) throw new Error('invalid_offer_images');
  const ids = await db<string[]>('rpc/enqueue_property_whatsapp_offer', { method: 'POST', body: { p_company_id: actor.companyId, p_broker_id: actor.brokerId, p_opportunity_id: input.opportunityId, p_request_id: input.requestId, p_content: input.content, p_images: input.images, p_phone_number_id: context.phoneNumberId } });
  return { ids, companyId: actor.companyId };
}

export async function sendPropertyOffer(companyId: string, ids: string[]) {
  // Each message keeps its own durable receipt. The regular worker recovers pending items.
  const deadline = Date.now() + 45000;
  for (const id of ids) {
    if (Date.now() + 24000 > deadline) break;
    await sendQueuedMessage(companyId, id, deadline);
  }
}

export async function propertyOfferStatus(requestId: string) {
  const actor = currentAccount();
  if (!actor) throw new Error('unauthorized');
  const rows = await db<Array<{ message_ids: string[] }>>(`property_whatsapp_batches?company_id=eq.${actor.companyId}&broker_id=eq.${actor.brokerId}&request_id=eq.${requestId}&select=message_ids&limit=1`);
  if (!rows[0]) return [];
  const messages = await db<Array<{ id: string; delivery_status: string; delivery_error_code: number | null }>>(`messages?company_id=eq.${actor.companyId}&id=in.(${rows[0].message_ids.join(',')})&select=id,delivery_status,delivery_error_code&order=created_at.asc`);
  return rows[0].message_ids.flatMap(id => messages.filter(message => message.id === id));
}

export function propertyOfferError(reason: unknown) {
  const text = reason instanceof Error ? reason.message : '';
  if (text.includes('template_required')) return 'Este cliente está fora da janela de 24 horas. Retome o contato com um modelo aprovado e aguarde a resposta antes de enviar as fotos.';
  if (text.includes('claim_required')) return 'Assuma este atendimento na aba Conversas antes de enviar.';
  if (text.includes('whatsapp_conversation_required')) return 'É necessária uma conversa WhatsApp recebida deste cliente na ImobFlow.';
  if (text.includes('whatsapp_connection')) return 'O administrador precisa conferir a conexão WhatsApp da imobiliária.';
  if (text.includes('invalid_offer_images')) return 'As fotos precisam estar no catálogo deste imóvel em JPG ou PNG. Atualize as imagens e tente novamente.';
  if (text.includes('opportunity_')) return 'A oportunidade mudou ou não está disponível para seu usuário. Atualize a lista.';
  if (text.includes('offer_request_conflict')) return 'O conteúdo deste envio mudou. Atualize a página e confira o envio anterior em Conversas.';
  return 'O envio direto ainda não está disponível. Confira a ativação do banco e a conexão WhatsApp com o administrador.';
}
