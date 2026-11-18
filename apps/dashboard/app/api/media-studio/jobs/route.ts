import { protectedRoute } from '@/lib/accounts';
import { mediaResponse, requireMediaOrigin } from '@/lib/media-studio/http';
import { jobView, readMediaJson } from '@/lib/media-studio/model';
import { createMediaJob } from '@/lib/media-studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const POST = protectedRoute(async request => mediaResponse(async () => {
  requireMediaOrigin(request);
  return { job: jobView(await createMediaJob(await readMediaJson(request))) };
}));
