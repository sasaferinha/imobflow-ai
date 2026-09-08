import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !publishableKey || !secretKey) {
    return NextResponse.json(
      {
        configured: false,
        connected: false,
        companyFound: false,
      },
      { status: 503 },
    );
  }

  try {
    if (request.nextUrl.searchParams.get("schema") === "full") {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: { Accept: "application/openapi+json", apikey: secretKey, Authorization: `Bearer ${secretKey}` },
        cache: "no-store",
      });
      const specification = await response.json() as { definitions?: Record<string, unknown> };
      const names = ["leads", "properties", "conversations", "messages", "lead_property_events", "appointments"];
      return NextResponse.json(Object.fromEntries(names.map((name) => [name, specification.definitions?.[name] || null])));
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/companies?select=id&limit=1`,
      {
        headers: {
          Accept: "application/json",
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          configured: true,
          connected: false,
          companyFound: false,
          upstreamStatus: response.status,
        },
        { status: 502 },
      );
    }

    const companies = (await response.json()) as Array<{ id: string }>;

    return NextResponse.json({
      configured: true,
      connected: true,
      companyFound: companies.length > 0,
    });
  } catch {
    return NextResponse.json(
      {
        configured: true,
        connected: false,
        companyFound: false,
      },
      { status: 502 },
    );
  }
}
