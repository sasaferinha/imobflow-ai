import type { MetaWhatsAppConnection } from "./meta-whatsapp";
import { supabaseServiceRequest } from "./supabase";
export type DeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";
export function deliveryError(code: number | null) {
  if (code === 0)
    return "Envio cancelado porque o responsável pelo atendimento mudou.";
  if (code === 130497)
    return "A Meta restringiu o envio para o país do destinatário.";
  if (code === 190)
    return "A conexão do WhatsApp precisa ser renovada pelo administrador.";
  if (code === 131047)
    return "A janela de atendimento encerrou. É necessário um modelo aprovado.";
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
      const connection = connections.find(
        (c) =>
          c.enabled && c.phoneNumberId === value?.metadata?.phone_number_id,
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
          /^\d{1,12}$/.test(event.timestamp)
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
