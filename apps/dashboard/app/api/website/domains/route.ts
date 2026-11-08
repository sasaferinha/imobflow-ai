import type { NextRequest } from 'next/server';
import { requireWebsiteActor, readWebsiteBody, websiteResponse, websiteFailure } from '@/lib/website/auth';
import { changeWebsiteDomain, domainFailure, readWebsiteDomains } from '@/lib/website/domains';
import { assertCoreWebsiteHost } from '@/lib/website/domains-routing';
import { consumeRateLimit } from '@/lib/request-security';
import { WebsiteError } from '@/lib/website/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try { assertCoreWebsiteHost(request.headers); return websiteResponse(await readWebsiteDomains(await requireWebsiteActor(request, true))); }
  catch (error) { return websiteFailure(domainFailure(error)); }
}
export async function POST(request: NextRequest) {
  try {
    assertCoreWebsiteHost(request.headers);
    const actor = await requireWebsiteActor(request, true);
    const body = await readWebsiteBody(request, 4096);
    if (!await consumeRateLimit(request, `website-domain-${actor.companyId}`, 30, 3600)) throw new WebsiteError('Muitas verificações. Aguarde antes de tentar novamente.', 429);
    return websiteResponse(await changeWebsiteDomain(actor, body));
  } catch (error) { return websiteFailure(domainFailure(error)); }
}
