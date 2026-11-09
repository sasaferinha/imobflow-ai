import { NextRequest,NextResponse } from 'next/server';
import { finishSocialOAuth,SOCIAL_COOKIE } from '@/lib/social-connections';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest){
 let status='connected';
 try{await finishSocialOAuth(request.nextUrl.searchParams.get('state')||'',request.cookies.get(SOCIAL_COOKIE)?.value,request.nextUrl.searchParams.get('code')||'');}catch{status='failed';}
 // The CRM session is SameSite=Strict. End the cross-site redirect chain on
 // a public page before the user starts a new same-site navigation to the CRM.
 const destination=new URL('/integracoes/retorno',request.nextUrl.origin);destination.searchParams.set('fluxo','social');destination.searchParams.set('resultado',status);
 const response=NextResponse.redirect(destination);response.cookies.set(SOCIAL_COOKIE,'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/integrations/meta/social/callback',maxAge:0});response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response;
}
