import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ version: process.env.NEXT_PUBLIC_APP_RELEASE || 'development' }, {
    headers: { 'Cache-Control': 'no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' },
  });
}
