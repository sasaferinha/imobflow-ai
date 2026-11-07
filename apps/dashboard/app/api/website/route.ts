import type { NextRequest } from 'next/server';
import { requireWebsiteActor, readWebsiteBody, websiteResponse, websiteFailure } from '@/lib/website/auth';
import { changeWebsite, readWebsiteSnapshot } from '@/lib/website/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return websiteResponse(await readWebsiteSnapshot(await requireWebsiteActor(request))); } catch (error) { return websiteFailure(error); }
}
export async function POST(request: NextRequest) {
  try { const body = await readWebsiteBody(request); return websiteResponse(await changeWebsite(await requireWebsiteActor(request), body)); } catch (error) { return websiteFailure(error); }
}
