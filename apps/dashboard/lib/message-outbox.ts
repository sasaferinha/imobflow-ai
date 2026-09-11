import { supabaseServiceRequest as db } from "./supabase";
import { configuredMetaWhatsAppConnections } from "./meta-whatsapp";
export function retryableDelivery(status: number, code: number | null) {
  return (
    ![130497, 190, 131047, 131026, 131031].includes(code || 0) &&
    (status === 429 || (status >= 500 && status <= 599))
  );
}
export async function sendQueuedMessage(companyId: string, id: string) {
  const claimed = await db<boolean>("rpc/claim_outbox_message", {
    method: "POST",
    body: { p_company_id: companyId, p_id: id },
  });
  if (!claimed) return;
  const filter = `company_id=eq.${companyId}&id=eq.${id}`;
  let state = "uncertain";
  let errorCode: number | null = null;
  let providerId: string | null = null;
  let retryAt: string | null = null;
  try {
    const [outbox] = await db<
      Array<{
        conversation_id: string;
        attempts: number;
        template_payload: {
          name: string;
          language: string;
          parameters: string[];
        } | null;
      }>
    >(
      `message_outbox?${filter}&select=conversation_id,attempts,template_payload&limit=1`,
    );
    const [message] = await db<Array<{ content: string }>>(
      `messages?${filter}&select=content&limit=1`,
    );
    const [conversation] = await db<
      Array<{
        external_conversation_id: string;
        phone_number_id: string | null;
      }>
    >(
      `conversations?company_id=eq.${companyId}&id=eq.${outbox.conversation_id}&select=external_conversation_id,phone_number_id&limit=1`,
    );
    const connections = configuredMetaWhatsAppConnections().filter(
      (c) => c.enabled && c.companyId === companyId,
    );
    const connection = conversation.phone_number_id
      ? connections.find(
          (c) => c.phoneNumberId === conversation.phone_number_id,
        )
      : connections.length === 1
        ? connections[0]
        : undefined;
    const phone = conversation.external_conversation_id.replace(
      /^whatsapp:/,
      "",
    );
    if (!connection?.accessToken || !/^\d{5,20}$/.test(phone)) {
      state = "failed";
      errorCode = 190;
    } else {
      const tpl = outbox.template_payload;
      const payload = tpl
        ? {
            type: "template",
            template: {
              name: tpl.name,
              language: { code: tpl.language },
              ...(tpl.parameters.length
                ? {
                    components: [
                      {
                        type: "body",
                        parameters: tpl.parameters.map((text) => ({
                          type: "text",
                          text,
                        })),
                      },
                    ],
                  }
                : {}),
            },
          }
        : { type: "text", text: { body: message.content, preview_url: false } };
      const response = await fetch(
        `https://graph.facebook.com/${connection.apiVersion}/${connection.phoneNumberId}/messages`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            ...payload,
          }),
        },
      );
      const receipt = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { code?: number };
      };
      if (
        response.ok &&
        typeof receipt.messages?.[0]?.id === "string" &&
        receipt.messages[0].id.trim() &&
        receipt.messages[0].id.length <= 500
      ) {
        providerId = receipt.messages[0].id;
        state = "sent";
      } else if (!response.ok) {
        errorCode = Number.isSafeInteger(receipt.error?.code)
          ? receipt.error!.code!
          : null;
        state =
          retryableDelivery(response.status, errorCode) && outbox.attempts < 3
            ? "pending"
            : "failed";
        if (state === "pending")
          retryAt = new Date(
            Date.now() + 30000 * 2 ** (outbox.attempts - 1),
          ).toISOString();
      }
    }
  } catch {
    /* Ambiguous network outcome is never resent automatically. */
  }
  await db(`messages?${filter}`, {
    method: "PATCH",
    body: {
      delivery_status:
        state === "sent" ? "sent" : state === "pending" ? "pending" : "failed",
      delivery_error_code: errorCode,
      ...(providerId ? { external_message_id: providerId } : {}),
    },
  });
  await db(`message_outbox?${filter}`, {
    method: "PATCH",
    body: {
      state,
      updated_at: new Date().toISOString(),
      ...(retryAt ? { next_attempt_at: retryAt } : {}),
    },
  });
}
export async function sweepMessageOutbox(companyId: string, deadline: number) {
  const stale = await db<Array<{ id: string }>>(
    `message_outbox?company_id=eq.${companyId}&state=eq.sending&updated_at=lt.${new Date(Date.now() - 120000).toISOString()}&select=id&limit=100`,
  );
  for (const row of stale) {
    await db(
      `message_outbox?company_id=eq.${companyId}&id=eq.${row.id}&state=eq.sending`,
      { method: "PATCH", body: { state: "uncertain" } },
    );
    await db(
      `messages?company_id=eq.${companyId}&id=eq.${row.id}&delivery_status=eq.pending`,
      { method: "PATCH", body: { delivery_status: "failed" } },
    );
  }
  const rows = await db<Array<{ id: string }>>(
    `message_outbox?company_id=eq.${companyId}&state=eq.pending&next_attempt_at=lte.${new Date().toISOString()}&order=next_attempt_at.asc&select=id&limit=20`,
  );
  for (const row of rows) {
    if (Date.now() + 13000 > deadline) break;
    await sendQueuedMessage(companyId, row.id);
  }
}
