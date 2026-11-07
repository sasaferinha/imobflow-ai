import { NextResponse } from 'next/server';
import { getPublicWebsite } from '@/lib/website/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex' };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const site = await getPublicWebsite((await params).slug);
    if (!site) return NextResponse.json({ error: 'Site indisponível.' }, { status: 404, headers });
    return NextResponse.json({ content: site.content, properties: site.properties }, { headers });
  } catch {
    console.error('public_website_refresh_failed');
    return NextResponse.json({ error: 'Não foi possível atualizar o catálogo.' }, { status: 503, headers });
  }
}
