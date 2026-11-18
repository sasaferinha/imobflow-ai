import { protectedRoute } from '@/lib/accounts';
import { mediaResponse } from '@/lib/media-studio/http';
import { mediaStudioStatus } from '@/lib/media-studio/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = protectedRoute(async () => mediaResponse(mediaStudioStatus));
