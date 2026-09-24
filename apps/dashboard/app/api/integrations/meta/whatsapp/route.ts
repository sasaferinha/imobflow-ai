import { after, NextRequest, NextResponse } from "next/server";
import {
  parseIncomingWhatsAppMessages,
  verifyMetaWebhookSignature,
  verifyMetaWebhookToken,
} from "@/lib/meta-whatsapp";
import { loadMetaWhatsAppConnections } from "@/lib/meta-whatsapp-connections";
import { saveIncomingWhatsAppMessage } from "@/lib/meta-whatsapp-store";
import { respondToIncomingMessage } from "@/lib/attendance";
import { parseDeliveryEvents, saveDeliveryEvents } from "@/lib/message-delivery";
import { parseBusinessAppMessages, saveBusinessAppMessage } from "@/lib/whatsapp-business-echo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_WEBHOOK_BYTES = 512 * 1024;

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  if (mode !== "subscribe" || !challenge || !verifyMetaWebhookToken(token)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_WEBHOOK_BYTES)
    return NextResponse.json(
      { error: "Payload muito grande." },
      { status: 413 },
    );

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES)
    return NextResponse.json({ error: "Payload muito grande." }, { status: 413 });

  if (!verifyMetaWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    console.warn("meta_whatsapp_webhook_signature_invalid");
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  try {
    const connections = await loadMetaWhatsAppConnections();
    const deliveryEvents = parseDeliveryEvents(payload, connections);
    const businessMessages = parseBusinessAppMessages(payload, connections);
    const messages = parseIncomingWhatsAppMessages(payload, connections);
    console.info("meta_whatsapp_webhook_received", {
      deliveryEvents: deliveryEvents.length,
      businessMessages: businessMessages.length,
      inboundMessages: messages.length,
    });
    await saveDeliveryEvents(deliveryEvents);
    // Apply human activity before inbound messages in the same webhook batch.
    for (const message of businessMessages) {
      await saveBusinessAppMessage(message);
    }
    const results = await Promise.allSettled(
      messages.map(async (message) => {
        const saved = await saveIncomingWhatsAppMessage(message);
        if (!saved.saved) return;
        after(async () => {
          try {
            await respondToIncomingMessage(saved);
          } catch {
            console.error("attendance_delivery_failed");
          }
        });
      }),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) {
      console.error("meta_whatsapp_message_import_failed", { count: failed, messages: messages.length });
      return NextResponse.json({ error: "Não foi possível processar todas as mensagens do webhook." }, { status: 500 });
    }
    return NextResponse.json(
      { received: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("meta_whatsapp_webhook_processing_failed");
    return NextResponse.json(
      { error: "Não foi possível processar o webhook." },
      { status: 500 },
    );
  }
}
