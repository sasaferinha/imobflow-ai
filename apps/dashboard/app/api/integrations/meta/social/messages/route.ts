import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { sendSocialMessage } from '@/lib/social-messaging';
import { socialBody,socialFailure } from '@/lib/social-http';
import { SocialError } from '@/lib/social-model';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=120;
export const POST=protectedRoute(async(request:NextRequest)=>{
 try { const b=await socialBody(request,['threadId','content','requestId','images']);
  if(typeof b.threadId!=='string'||typeof b.content!=='string'||typeof b.requestId!=='string'||b.images!==undefined&&(!Array.isArray(b.images)||!b.images.every(v=>typeof v==='string')))throw new SocialError('Mensagem inválida.',400);
  return NextResponse.json({data:await sendSocialMessage({threadId:b.threadId,content:b.content,requestId:b.requestId,images:b.images as string[]|undefined})},{status:201});
 }catch(error){return socialFailure(error);}
});
