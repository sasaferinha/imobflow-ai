import { NextResponse } from 'next/server';

// Basic opportunities are human-in-the-loop. Keep the route explicit so a
// previously published workflow cannot continue automatic offers.
export async function POST() {
  return NextResponse.json({ error: 'Envio automático de oportunidades desativado. Revise a oportunidade no painel.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
