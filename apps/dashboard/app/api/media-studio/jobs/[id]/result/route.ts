import { protectedRoute } from '@/lib/accounts';
import { mediaResponse } from '@/lib/media-studio/http';
import { mediaJobResult } from '@/lib/media-studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;
export const GET = protectedRoute(async (_request, context: { params: Promise<{ id: string }> }) => mediaResponse(() => context.params.then(({ id }) => mediaJobResult(id))));
