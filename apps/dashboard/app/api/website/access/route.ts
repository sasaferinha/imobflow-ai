import type { NextRequest } from 'next/server';
import { requireWebsiteActor, readWebsiteBody, websiteResponse, websiteFailure } from '@/lib/website/auth';
import { listWebsiteMarketing, manageWebsiteMarketing } from '@/lib/website/server';
import { consumeRateLimit } from '@/lib/request-security';
import { WebsiteError } from '@/lib/website/model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return websiteResponse({ marketingAccounts: await listWebsiteMarketing(await requireWebsiteActor(request, true)) }); } catch (error) { return websiteFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await readWebsiteBody(request, 8192), actor = await requireWebsiteActor(request, true);
    if (!await consumeRateLimit(request, 'website-manage-access', 30, 3600)) throw new WebsiteError('Muitas alterações de acesso. Tente novamente mais tarde.', 429);
    return websiteResponse({ marketingAccounts: await manageWebsiteMarketing(actor, body) });
  } catch (error) { return websiteFailure(error); }
}
