import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { supabaseServiceRequest } from '@/lib/supabase';
import { verifyMetaWebhookSignature, verifyMetaWebhookToken } from '@/lib/meta-whatsapp';
import { parseSocialEvents, saveSocialEvent, socialConnections } from '@/lib/meta-social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const status = protectedRoute(async () => {
  const actor=currentAccount()!;
  if(actor.role!=='owner') return NextResponse.json({error:'Somente o administrador pode consultar os canais.'},{status:403});
  try {
    const connections=socialConnections().filter(c=>c.companyId===actor.companyId);
    const leads=await supabaseServiceRequest<Array<{id:string;name:string;source:string;created_at:string;details:string;interest_profile:Record<string,unknown>}>>(`leads?company_id=eq.${encodeURIComponent(actor.companyId)}&source=in.(Facebook%20Lead%20Ads,Instagram%20Direct)&select=id,name,source,created_at,details,interest_profile&order=created_at.desc&limit=30`);
    return NextResponse.json({data:{
      facebook:connections.some(c=>c.enabled&&c.pageId&&c.accessToken), instagram:connections.some(c=>c.enabled&&c.instagramId),
      webhookConfigured:Boolean(process.env.META_APP_SECRET&&process.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN),
      inbox:leads.map(l=>({id:l.id,name:l.name,source:l.source,createdAt:l.created_at,details:l.details,messages:Array.isArray(l.interest_profile?.socialMessages)?l.interest_profile.socialMessages:[]})),
    }},{headers:{'Cache-Control':'no-store'}});
  } catch { return NextResponse.json({error:'Não foi possível consultar os canais sociais.'},{status:503}); }
});
export async function GET(request:NextRequest) {
  if(request.nextUrl.searchParams.has('hub.mode')) {
    const challenge=request.nextUrl.searchParams.get('hub.challenge');
    if(request.nextUrl.searchParams.get('hub.mode')!=='subscribe'||!challenge||!verifyMetaWebhookToken(request.nextUrl.searchParams.get('hub.verify_token'),process.env.META_SOCIAL_WEBHOOK_VERIFY_TOKEN || ''))return new NextResponse('Forbidden',{status:403});
    return new NextResponse(challenge,{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
  }
  return status(request, undefined);
}
export async function POST(request:NextRequest) {
  if(Number(request.headers.get('content-length')||0)>262144)return NextResponse.json({error:'Payload muito grande.'},{status:413});
  const raw=await request.text();
  if(Buffer.byteLength(raw)>262144)return NextResponse.json({error:'Payload muito grande.'},{status:413});
  if(!verifyMetaWebhookSignature(raw,request.headers.get('x-hub-signature-256')))return NextResponse.json({error:'Assinatura inválida.'},{status:401});
  let payload:unknown;
  try{payload=JSON.parse(raw);}catch{return NextResponse.json({error:'JSON inválido.'},{status:400});}
  try {
    const events=parseSocialEvents(payload,socialConnections());
    const deadline=Date.now()+45000;
    for(const event of events){if(Date.now()>deadline)throw Error('deadline');await saveSocialEvent(event);}
    return NextResponse.json({received:true},{headers:{'Cache-Control':'no-store'}});
  }catch{console.error('meta_social_webhook_failed');return NextResponse.json({error:'Não foi possível confirmar todos os eventos. Reenvie o webhook.'},{status:503});}
}
