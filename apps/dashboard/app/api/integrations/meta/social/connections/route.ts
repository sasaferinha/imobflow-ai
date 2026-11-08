import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { beginSocialOAuth,disconnectSocial,setSocialDefaultMode,selectSocialPage,socialConnectionStatus,SOCIAL_COOKIE } from '@/lib/social-connections';
import { socialBody,socialFailure } from '@/lib/social-http';
import { SocialError,type SocialChannel,type SocialMode } from '@/lib/social-model';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export const GET=protectedRoute(async(request:NextRequest)=>{
 try{const a=currentAccount()!;if(a.role!=='owner')throw new SocialError('Acesso exclusivo do administrador.',403);return NextResponse.json(await socialConnectionStatus(a.companyId,request.nextUrl.searchParams.get('action')==='pages'));}catch(error){return socialFailure(error);}
});
export const POST=protectedRoute(async(request:NextRequest)=>{
 try{
  const a=currentAccount()!;if(a.role!=='owner')throw new SocialError('Acesso exclusivo do administrador.',403);
  const b=await socialBody(request,['action','pageId','channels','channel','mode'],8192);
  if(b.action==='connect'){
   const result=await beginSocialOAuth(a.companyId,a.brokerId,new URL('/api/integrations/meta/social/callback',request.nextUrl.origin).href),response=NextResponse.json({url:result.url});
   response.cookies.set(SOCIAL_COOKIE,result.state,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/integrations/meta/social/callback',maxAge:600});return response;
  }
  if(b.action==='select-page'){
   if(typeof b.pageId!=='string'||!Array.isArray(b.channels)||b.channels.length>2||b.channels.some(c=>c!=='instagram'&&c!=='facebook'))throw new SocialError('Escolha uma Página e os canais.',400);
   await selectSocialPage(a.companyId,a.brokerId,b.pageId,b.channels as SocialChannel[]);
  }else if(b.action==='disconnect'||b.action==='mode'){
   if(b.channel!=='instagram'&&b.channel!=='facebook')throw new SocialError('Canal inválido.',400);
   if(b.action==='disconnect')await disconnectSocial(a.companyId,a.brokerId,b.channel);
   else await setSocialDefaultMode(a.companyId,a.brokerId,b.channel,b.mode as SocialMode);
  }else throw new SocialError('Operação inválida.',400);
  return NextResponse.json(await socialConnectionStatus(a.companyId));
 }catch(error){return socialFailure(error);}
});
