import { NextRequest, NextResponse } from "next/server";
import { protectedRoute } from "@/lib/accounts";
import { currentAccount } from "@/lib/tenant-context";
import { hasSameOrigin } from "@/lib/request-security";
import { supabaseServiceRequest as db } from "@/lib/supabase";
import { sendQueuedMessage } from "@/lib/message-outbox";
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  try {
    const body = (await request.json()) as { id?: string };
    if (!/^[0-9a-f-]{36}$/i.test(body.id || "")) throw Error();
    const account = currentAccount()!;
    const [row] = await db<
      Array<{
        state: string;
        attempts: number;
        broker_id: string | null;
        next_attempt_at: string;
      }>
    >(
      `message_outbox?company_id=eq.${account.companyId}&id=eq.${body.id}&select=state,attempts,broker_id,next_attempt_at&limit=1`,
    );
    if (
      !row ||
      row.state !== "pending" ||
      row.attempts < 1 ||
      row.attempts >= 3 ||
      Date.parse(row.next_attempt_at) > Date.now() ||
      (account.role !== "owner" && row.broker_id !== account.brokerId)
    )
      return NextResponse.json(
        { error: "Este envio não pode ser repetido agora." },
        { status: 409 },
      );
    await sendQueuedMessage(account.companyId, body.id!);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível repetir o envio." },
      { status: 503 },
    );
  }
});
