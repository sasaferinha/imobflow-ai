import { supabaseServiceRequest } from "./supabase";
import { loadMetaWhatsAppConnectionForCompany } from "./meta-whatsapp-connections";
import type { PropertyImageAttachment } from './property-whatsapp-media';

const MAX_SEND_ATTEMPTS = 3;
const BASE_RETRY_MS = 30_000;

const db = <T>(path: string, options: Parameters<typeof supabaseServiceRequest>[1] = {}) =>
  supabaseServiceRequest<T>(path, { ...options, timeoutMs: 4000 });

function scheduleRetry(attempts: number) {
  const boundedAttempts = Math.max(0, Math.min(attempts, MAX_SEND_ATTEMPTS));
  return new Date(Date.now() + BASE_RETRY_MS * 2 ** boundedAttempts).toISOString();
}

export function retryableDelivery(status: number, code: number | null) {
  return (
    ![130497, 190, 131047, 131026, 131031].includes(code || 0) &&
    (status === 429 || (status >= 500 && status <= 599))
  );
}

export async function sendQueuedMessage(companyId: string, id: string, deadline = Date.now() + 45000) {
  if (Date.now() + 24000 > deadline) return; // Do not acquire a lease without a safe send/receipt budget.
  const claimed = await db<boolean>("rpc/claim_outbox_message_v2", {
    method: "POST",
    body: { p_company_id: companyId, p_id: id },
  });
  if (!claimed) return;
  const filter = `company_id=eq.${companyId}&id=eq.${id}`;
  let state = "uncertain";
  let errorCode: number | null = null;
  let providerId: string | null = null;
  let retryAt: string | null = null;
  let attempts = 0;
  let providerAttempted = false;

  try {
    const [outbox] = await db<
      Array<{
        conversation_id: string;
        attempts: number;
        property_image?: PropertyImageAttachment | null;
        template_payload: {
          name: string;
          language: string;
          parameters: string[];
        } | null;
      }>
    >(
      `message_outbox?${filter}&select=conversation_id,attempts,template_payload,property_image&limit=1`,
    );
    attempts = outbox.attempts;

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

    const connections = await loadMetaWhatsAppConnectionForCompany(companyId);
    const activeConnections = connections.filter((connection) => connection.enabled);
    const connection = conversation.phone_number_id
      ? activeConnections.find((c) => c.phoneNumberId === conversation.phone_number_id)
      : activeConnections.length === 1
        ? activeConnections[0]
        : undefined;

    const phone = conversation.external_conversation_id.replace(/^whatsapp:/, "");
    if (!connection?.accessToken || !/^\d{5,20}$/.test(phone)) {
      state = "failed";
      errorCode = 190;
    } else {
      const tpl = outbox.template_payload;
      // Loading/converting/uploading is safe to retry: only the /messages POST
      // sends to a recipient and receives the provider-attempt marker below.
      const imageId = outbox.property_image
        ? await (await import('./property-whatsapp-media')).uploadPropertyWhatsAppImage(companyId, outbox.property_image, connection, deadline) : null;
      const payload = imageId ? { type: 'image', image: { id: imageId, caption: message.content.slice(0, 1024) } } : tpl
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

      // Leave time for the provider timeout and both receipt persistence tries.
      if (Date.now() + 24000 > deadline) throw new Error("Orçamento de envio esgotado.");
      const marked = await db<boolean>("rpc/mark_outbox_provider_attempt", {
        method: "POST",
        body: { p_company_id: companyId, p_id: id, p_attempt: attempts },
      });
      if (!marked) return;
      providerAttempted = true;
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
        error?: { code?: number; error_subcode?: number; fbtrace_id?: string };
      };

      const responseErrorCode = Number.isSafeInteger(receipt.error?.code)
        ? receipt.error!.code!
        : null;

      if (
        response.ok &&
        typeof receipt.messages?.[0]?.id === "string" &&
        receipt.messages[0].id.trim() &&
        receipt.messages[0].id.length <= 500
      ) {
        providerId = receipt.messages[0].id;
        state = "sent";
      } else if (!response.ok) {
        errorCode = responseErrorCode;
        console.error("whatsapp_send_failed", {
          status: response.status,
          code: errorCode,
          subcode: Number.isSafeInteger(receipt.error?.error_subcode)
            ? receipt.error!.error_subcode
            : null,
          trace: typeof receipt.error?.fbtrace_id === "string"
            ? receipt.error.fbtrace_id.slice(0, 80)
            : null,
        });
        state =
          retryableDelivery(response.status, errorCode) &&
          (response.status === 429 || errorCode !== null) &&
          attempts < MAX_SEND_ATTEMPTS
            ? "pending"
            : response.status >= 500 && errorCode === null ? "uncertain" : "failed";
        if (state === "pending") retryAt = scheduleRetry(attempts);
      } else if (responseErrorCode) {
        errorCode = responseErrorCode;
        console.error("whatsapp_send_failed", { status: response.status, code: errorCode, subcode: null, trace: null });
        state = "failed";
      } else {
        console.error("whatsapp_send_no_receipt", { status: response.status });
        // A success without a receipt may already have delivered. Never send twice.
        state = "uncertain";
      }
    }
  } catch {
    state = providerAttempted ? "uncertain" : attempts < MAX_SEND_ATTEMPTS ? "pending" : "failed";
    if (state === "pending") retryAt = scheduleRetry(attempts);
  }

  // Persist the receipt and queue state in one transaction. Retrying this RPC
  // is idempotent; retrying the provider POST after a timeout is not.
  for (let persistenceAttempt = 0; persistenceAttempt < 2; persistenceAttempt++) {
    try {
      await db("rpc/finish_outbox_attempt", {
        method: "POST",
        body: { p_company_id: companyId, p_id: id, p_attempt: attempts,
          p_state: state, p_error: errorCode, p_provider_id: providerId, p_retry_at: retryAt },
      });
      return;
    } catch {
      if (persistenceAttempt === 1) throw new Error("Não foi possível registrar o resultado do envio.");
    }
  }
}

export async function sweepMessageOutbox(companyId: string, deadline: number) {
  await db("rpc/recover_stale_outbox", { method: "POST", body: { p_company_id: companyId } });

  const rows = await db<Array<{ id: string }>>(
    `message_outbox?company_id=eq.${companyId}&state=eq.pending&next_attempt_at=lte.${new Date().toISOString()}&order=next_attempt_at.asc&select=id&limit=20`,
  );
  for (const row of rows) {
    if (Date.now() + 44000 > deadline) break;
    await sendQueuedMessage(companyId, row.id, deadline);
  }
}

/** Scheduled server worker only. Tenant identity always comes from trusted queue rows. */
export async function recoverMessageOutbox(deadline: number) {
  const recovered = await db<number>("rpc/recover_stale_outbox", { method: "POST", body: { p_company_id: null } });
  const rows = await db<Array<{ id: string; company_id: string }>>(
    `message_outbox?state=eq.pending&next_attempt_at=lte.${new Date().toISOString()}&order=next_attempt_at.asc,id.asc&select=id,company_id&limit=20`,
  );
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    if (Date.now() + 44000 > deadline) break;
    try { await sendQueuedMessage(row.company_id, row.id, deadline); processed++; }
    catch { failed++; }
  }
  return { recovered, processed, failed, remaining: rows.length - processed - failed };
}
