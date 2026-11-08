import { timingSafeEqual } from "node:crypto";
import { recoverMessageOutbox } from "../../../../lib/message-outbox";
import { recoverInboundReply } from "../../../../lib/inbound-recovery";
import { recoverSocialAI } from "../../../../lib/social-ai";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.MESSAGE_RECOVERY_SECRET;
  const received = request.headers.get("authorization") || "";
  const expected = secret ? `Bearer ${secret}` : "";
  if (!secret || secret.length < 32 || Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const deadline = Date.now() + 55000;
    // Keep WhatsApp's existing deadline and sequencing; social has an independent
    // bounded lane so neither channel consumes the other's recovery window.
    const [whatsapp, social] = await Promise.allSettled([
      (async () => { const inbound = await recoverInboundReply(deadline); const outbox = await recoverMessageOutbox(deadline); return { inbound, outbox }; })(),
      recoverSocialAI(Math.min(deadline, Date.now()+20000)),
    ]);
    if (whatsapp.status === 'rejected') throw whatsapp.reason;
    const { inbound, outbox } = whatsapp.value;
    const socialAI = social.status === 'fulfilled' ? social.value : { processed: 0, deferred: 0, failed: 1 };
    const result = { ...outbox, failed: outbox.failed + inbound.failed + socialAI.failed, inboundProcessed: inbound.processed, socialAI };
    if (result.failed) console.error("message_recovery_partial_failure", { failed: result.failed });
    return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 503 : 200 });
  } catch {
    console.error("message_recovery_unavailable");
    return Response.json({ error: "Recuperação temporariamente indisponível." }, { status: 503 });
  }
}
