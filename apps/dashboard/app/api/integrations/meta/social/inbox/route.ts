import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { readSocialInbox } from '@/lib/social-messaging';
import { socialFailure } from '@/lib/social-http';
import type { SocialChannel } from '@/lib/social-model';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=protectedRoute(async(request:NextRequest)=>{
 try { const q=request.nextUrl.searchParams; return NextResponse.json({data:await readSocialInbox({channel:q.get('channel') as SocialChannel,threadId:q.get('threadId'),before:q.get('before'),contactsBefore:q.get('contactsBefore')})}); }
 catch(error){return socialFailure(error);}
});
