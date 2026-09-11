import { NextRequest, NextResponse } from "next/server";
import { protectedRoute } from "@/lib/accounts";
import { currentAccount } from "@/lib/tenant-context";
import { hasSameOrigin } from "@/lib/request-security";
import { supabaseServiceRequest } from "@/lib/supabase";
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const account = currentAccount()!;
  try {
    const body = (await request.json()) as {
      leadId?: string;
      release?: boolean;
    };
    if (!/^[0-9a-f-]{36}$/i.test(body.leadId || ""))
      return NextResponse.json(
        { error: "Conversa inválida." },
        { status: 400 },
      );
    const changed = await supabaseServiceRequest<boolean>(
      "rpc/change_conversation_owner",
      {
        method: "POST",
        body: {
          p_company_id: account.companyId,
          p_lead_id: body.leadId,
          p_broker_id: account.brokerId,
          p_release: body.release === true,
        },
      },
    );
    return NextResponse.json(
      changed
        ? { ok: true }
        : {
            error:
              "Conversa com outro corretor ou envio em andamento. Atualize e tente novamente.",
          },
      { status: changed ? 200 : 409 },
    );
  } catch {
    return NextResponse.json(
      { error: "Não foi possível alterar o atendimento." },
      { status: 503 },
    );
  }
});
