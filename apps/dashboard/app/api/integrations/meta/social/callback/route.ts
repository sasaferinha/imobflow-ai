import { NextRequest,NextResponse } from 'next/server';
import { finishSocialOAuth,SOCIAL_COOKIE } from '@/lib/social-connections';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest){
 let status='connected';
 try{await finishSocialOAuth(request.nextUrl.searchParams.get('state')||'',request.cookies.get(SOCIAL_COOKIE)?.value,request.nextUrl.searchParams.get('code')||'');}catch{status='failed';}
 const destination=new URL('/painel',request.nextUrl.origin);destination.searchParams.set('social',status);destination.hash='conversations';
 const response=NextResponse.redirect(destination);response.cookies.set(SOCIAL_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/integrations/meta/social/callback',maxAge:0});response.headers.set('Cache-Control','no-store');return response;
}
