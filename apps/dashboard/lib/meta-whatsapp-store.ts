import type { IncomingWhatsAppMessage } from "./meta-whatsapp";
import { supabaseServiceRequest as db } from "./supabase";
import { persistIncomingWhatsAppImage } from "./whatsapp-media";

export async function saveIncomingWhatsAppMessage(
  input: IncomingWhatsAppMessage,
) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const result = await db<
    | { saved: false }
    | { saved: true; leadId: string; conversationId: string; messageId: string }
  >("rpc/receive_conversation_message", {
    method: "POST",
    body: {
      p_company_id: input.companyId,
      p_phone: input.phone,
      p_phone_number_id: input.phoneNumberId,
      p_external_id: input.externalMessageId,
      p_content: input.text,
      p_name: input.contactName,
      p_occurred_at: occurredAt,
    },
  });
  if (!result.saved) return { saved: false as const };
  if (input.media) {
    let mediaUrls: string[] = [];
    let content = input.text;
    try {
      mediaUrls = [
        await persistIncomingWhatsAppImage({
          companyId: input.companyId,
          mediaId: input.media.id,
          mimeType: input.media.mimeType,
          accessToken: input.accessToken,
          apiVersion: input.apiVersion,
        }),
      ];
    } catch {
      content =
        input.text.slice(0, 3900) +
        "\n[Foto indisponível: não foi possível receber a mídia.]";
    }
    try {
      await db(
        "messages?company_id=eq." +
          input.companyId +
          "&id=eq." +
          result.messageId,
        { method: "PATCH", body: { media_urls: mediaUrls, content } },
      );
    } catch {
      console.error("conversation_media_update_failed");
    }
  }
  return {
    saved: true as const,
    companyId: input.companyId,
    leadId: result.leadId,
    conversationId: result.conversationId,
    incomingExternalMessageId: input.externalMessageId,
    message: input.text,
    hasImage: Boolean(input.media),
    recipientPhone: input.phone,
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
    apiVersion: input.apiVersion,
    occurredAt,
  };
}
