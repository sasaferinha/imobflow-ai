import { NextResponse } from 'next/server';
import { getPublicWebsite } from '@/lib/website/server';
import { assertPublicWebsiteHost } from '@/lib/website/domains-routing';
import { WebsiteError } from '@/lib/website/model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex' };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    await assertPublicWebsiteHost(request.headers, slug);
    const site = await getPublicWebsite(slug);
    if (!site) return NextResponse.json({ error: 'Site indisponível.' }, { status: 404, headers });
    return NextResponse.json({ content: site.content, properties: site.properties }, { headers });
  } catch (error) {
    if (error instanceof WebsiteError && error.status === 404) return NextResponse.json({ error: 'Site indisponível.' }, { status: 404, headers });
    console.error('public_website_refresh_failed');
    return NextResponse.json({ error: 'Não foi possível atualizar o catálogo.' }, { status: 503, headers });
  }
}
