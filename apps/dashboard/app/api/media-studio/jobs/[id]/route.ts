import { protectedRoute } from '@/lib/accounts';
import { mediaResponse, requireMediaOrigin } from '@/lib/media-studio/http';
import { jobView, MediaError, readMediaJson } from '@/lib/media-studio/model';
import { readMediaJob, refreshMediaJob } from '@/lib/media-studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;
type Context = { params: Promise<{ id: string }> };
export const GET = protectedRoute(async (_request, context: Context) => mediaResponse(async () => ({ job: jobView(await readMediaJob((await context.params).id)) })));
export const POST = protectedRoute(async (request, context: Context) => mediaResponse(async () => {
  requireMediaOrigin(request);
  const body = await readMediaJson(request, 128);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new MediaError('media_invalid_request');
  return { job: jobView(await refreshMediaJob((await context.params).id)) };
}));
