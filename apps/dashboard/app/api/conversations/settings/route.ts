import { NextRequest, NextResponse } from "next/server";
import { protectedRoute } from "@/lib/accounts";
import { currentAccount, requireCompanyId } from "@/lib/tenant-context";
import { hasSameOrigin } from "@/lib/request-security";
import { readBusinessHours } from "@/lib/conversation-settings";
import { validateBusinessHours } from "@/lib/business-hours";
import { supabaseServiceRequest } from "@/lib/supabase";
export const GET = protectedRoute(async () => {
  try {
    return NextResponse.json(
      { data: await readBusinessHours(requireCompanyId()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Configurações indisponíveis. A atualização do banco pode estar pendente.",
      },
      { status: 503 },
    );
  }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (currentAccount()?.role !== "owner")
    return NextResponse.json(
      { error: "Somente o administrador pode alterar horários." },
      { status: 403 },
    );
  if (!hasSameOrigin(request))
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  let settings;
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw Error();
    settings = validateBusinessHours(JSON.parse(raw));
  } catch {
    return NextResponse.json(
      { error: "Revise os horários, dias, fuso e datas informados." },
      { status: 400 },
    );
  }
  try {
    await supabaseServiceRequest(
      "conversation_settings?on_conflict=company_id",
      {
        method: "POST",
        prefer: "resolution=merge-duplicates",
        body: { company_id: requireCompanyId(), business_hours: settings },
      },
    );
    return NextResponse.json({ data: settings });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível salvar os horários." },
      { status: 503 },
    );
  }
});
