import { timingSafeEqual } from "node:crypto";
import { recoverMessageOutbox } from "../../../../lib/message-outbox";
import { recoverInboundReply } from "../../../../lib/inbound-recovery";

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
    const inbound = await recoverInboundReply(deadline);
    const outbox = await recoverMessageOutbox(deadline);
    const result = { ...outbox, failed: outbox.failed + inbound.failed, inboundProcessed: inbound.processed };
    if (result.failed) console.error("message_recovery_partial_failure", { failed: result.failed });
    return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 503 : 200 });
  } catch {
    console.error("message_recovery_unavailable");
    return Response.json({ error: "Recuperação temporariamente indisponível." }, { status: 503 });
  }
}
