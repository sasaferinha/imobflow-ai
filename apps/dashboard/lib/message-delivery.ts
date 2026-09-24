import type { MetaWhatsAppConnection } from "./meta-whatsapp";
import { normalizePhone } from "./meta-whatsapp";
import { supabaseServiceRequest } from "./supabase";
export type DeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";
export function deliveryError(code: number | null) {
  if (code === 131053)
    return "A foto não foi enviada ou uma mensagem anterior da oferta falhou. Confira o envio e as fotos cadastradas.";
  if (code === 0)
    return "Envio cancelado porque o responsável pelo atendimento mudou.";
  if (code === 130497)
    return "A Meta restringiu o envio para o país do destinatário.";
  if (code === 190)
    return "A conexão do WhatsApp precisa ser renovada pelo administrador.";
  if (code === 131047)
    return "A janela de 24 horas expirou. Para iniciar nova conversa, use um modelo aprovado pela Meta.";
  if (code === 131026)
    return "A Meta não conseguiu entregar ao número. Confira se o destinatário usa WhatsApp e pode receber mensagens.";
  if (code === 131030)
    return "Este destinatário ainda não está liberado para teste/envio nesta conta da Meta.";
  if (code === 131031)
    return "A conta WhatsApp está com restrição na Meta. Revise o Gerenciador do WhatsApp.";
  return "O WhatsApp não confirmou a entrega. Consulte o responsável pela integração.";
}
type StatusEvent = {
  company_id: string;
  external_message_id: string;
  status: Exclude<DeliveryStatus, "pending">;
  occurred_at: string;
  error_code: number | null;
};
export function parseDeliveryEvents(
  payload: unknown,
  connections: MetaWhatsAppConnection[],
): StatusEvent[] {
  const output: StatusEvent[] = [];
  if (!payload || typeof payload !== "object") return output;
  const root = payload as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account" || !Array.isArray(root.entry))
    return output;
  for (const entry of root.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== "messages") continue;
      const value = change.value;
      const phoneNumberId = normalizePhone(String(value?.metadata?.phone_number_id || ""));
      const connection = connections.find(
        (c) => c.enabled && c.phoneNumberId === phoneNumberId,
      );
      if (!connection || !Array.isArray(value?.statuses)) continue;
      for (const event of value.statuses) {
        if (
          !event ||
          typeof event.id !== "string" ||
          !event.id ||
          event.id.length > 500 ||
          !["sent", "delivered", "read", "failed"].includes(event.status)
        )
          continue;
        const timestamp =
          typeof event.timestamp === "string" &&
          /^\d{1,13}$/.test(event.timestamp)
            ? Number(event.timestamp) * 1000
            : NaN;
        if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000)
          continue;
        const code = event.errors?.[0]?.code;
        output.push({
          company_id: connection.companyId,
          external_message_id: event.id,
          status: event.status,
          occurred_at: new Date(timestamp).toISOString(),
          error_code: Number.isSafeInteger(code) ? code : null,
        });
      }
    }
  }
  return output;
}
export async function saveDeliveryEvents(events: StatusEvent[]) {
  if (events.length)
    await supabaseServiceRequest(
      "message_delivery_events?on_conflict=company_id,external_message_id,status",
      { method: "POST", prefer: "resolution=ignore-duplicates", body: events },
    );
}
