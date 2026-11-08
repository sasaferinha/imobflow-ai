import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { handoffSocialThread } from '@/lib/social-messaging';
import { socialBody,socialFailure } from '@/lib/social-http';
import { SocialError,type SocialMode } from '@/lib/social-model';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=protectedRoute(async(request:NextRequest)=>{
 try {const b=await socialBody(request,['threadId','mode']);if(typeof b.threadId!=='string'||typeof b.mode!=='string')throw new SocialError('Atendimento inválido.',400);await handoffSocialThread(b.threadId,b.mode as SocialMode);return NextResponse.json({ok:true});}catch(error){return socialFailure(error);}
});
