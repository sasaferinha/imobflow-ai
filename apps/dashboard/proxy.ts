import { NextResponse, type NextRequest } from 'next/server';
import { allowedCustomPath, isCoreWebsiteHost, requestHostname } from './lib/website/domains-host';
import { activeWebsiteDomain } from './lib/website/domains-routing';

export async function proxy(request: NextRequest) {
  const hostname = requestHostname(request.headers);
  if (isCoreWebsiteHost(hostname)) return NextResponse.next();
  const denied = () => new NextResponse('Página não encontrada.', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Type': 'text/plain; charset=utf-8' } });
  try {
    const domain = hostname ? await activeWebsiteDomain(hostname) : null;
    if (!domain) return denied();
    const action = allowedCustomPath(request.nextUrl.pathname, domain.slug, request.method);
    if (!action) return denied();
    if (action === 'root') {
      const target = request.nextUrl.clone();
      target.pathname = `/imobiliaria/${domain.slug}`;
      return NextResponse.rewrite(target);
    }
    return NextResponse.next();
  } catch { return denied(); }
}

// Including assets makes unknown hosts fail closed instead of exposing the CRM shell.
export const config = { matcher: '/:path*' };
