import { NextRequest, NextResponse } from "next/server";
import { protectedRoute } from "@/lib/accounts";
import { currentAccount, requireCompanyId } from "@/lib/tenant-context";
import { hasSameOrigin } from "@/lib/request-security";
import { supabaseServiceRequest as db } from "@/lib/supabase";
export const GET = protectedRoute(async () => {
  try {
    const rows = await db<Array<{ templates: unknown }>>(
      `conversation_settings?company_id=eq.${requireCompanyId()}&select=templates&limit=1`,
    );
    return NextResponse.json({ data: rows[0]?.templates || [] });
  } catch {
    return NextResponse.json(
      { error: "Modelos indisponíveis." },
      { status: 503 },
    );
  }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request) || currentAccount()?.role !== "owner")
    return NextResponse.json(
      { error: "Somente o administrador pode configurar modelos." },
      { status: 403 },
    );
  try {
    const raw = await request.text();
    if (raw.length > 20000) throw Error();
    const rows = JSON.parse(raw);
    if (
      !Array.isArray(rows) ||
      rows.length > 20 ||
      rows.some(
        (t) =>
          !t ||
          typeof t.name !== "string" ||
          !/^[a-z0-9_]{1,100}$/.test(t.name) ||
          typeof t.language !== "string" ||
          !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(t.language) ||
          typeof t.purpose !== "string" ||
          !t.purpose.trim() ||
          t.purpose.length > 200 ||
          typeof t.approved !== "boolean" ||
          !Array.isArray(t.parameters) ||
          t.parameters.length > 20 ||
          t.parameters.some(
            (p: unknown) => typeof p !== "string" || p.length > 1000,
          ),
      )
    )
      throw Error();
    if (new Set(rows.map((t) => t.name)).size !== rows.length) throw Error();
    const templates = rows.map(
      ({ name, language, purpose, approved, parameters }) => ({
        name,
        language,
        purpose,
        approved,
        parameters,
      }),
    );
    await db("conversation_settings?on_conflict=company_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates",
      body: { company_id: requireCompanyId(), templates },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Revise os modelos e tente novamente." },
      { status: 400 },
    );
  }
});
