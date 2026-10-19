import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, protectedRoute, tokenHash } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { supabaseRequest as db } from '@/lib/supabase';
import { hasSafeRequestSize } from '@/lib/request-security';
import { pushEndpointHash, validPushEndpoint, validatePushSubscription, webPushConfig, WebPushInputError } from '@/lib/web-push';
import { readUrgentAlertWindow, requireUrgentAlertPolicy } from '@/lib/urgent-alert-hours';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const sessionHash = (request: NextRequest) => tokenHash(request.cookies.get(ACCOUNT_COOKIE)!.value);
// Browser opt-in mutations require an actual Origin; absence is not consent.
const sameOrigin = (request: NextRequest) => request.headers.get('origin') === request.nextUrl.origin;
export const GET = protectedRoute(async (request: NextRequest) => {
  const actor = currentAccount()!, config = webPushConfig();
  const endpointHash = request.nextUrl.searchParams.get('endpointHash');
  if (endpointHash !== null && !/^[a-f0-9]{64}$/.test(endpointHash)) return NextResponse.json({error:'Inscrição inválida.'},{status:400});
  try {
    await requireUrgentAlertPolicy();
    const activeUntil = await readUrgentAlertWindow(actor.companyId);
    const rows = await db<Array<{id:string}>>(`web_push_subscriptions?company_id=eq.${actor.companyId}&broker_id=eq.${actor.brokerId}&session_hash=eq.${sessionHash(request)}${endpointHash ? `&endpoint_hash=eq.${endpointHash}` : ''}&select=id&limit=10`);
    return NextResponse.json({configured:Boolean(config),publicKey:config?.publicKey || null,subscribed:rows.length>0,bindingIds:rows.map(row=>row.id),schedulerConfigured:config?.schedulerConfigured || false,
      businessHoursOpen: activeUntil !== null && Date.now() < activeUntil, activeUntil}, {headers:{'Cache-Control':'private, no-store'}});
  } catch { return NextResponse.json({configured:false,publicKey:null,subscribed:false,bindingIds:[],schedulerConfigured:false,businessHoursOpen:false,activeUntil:null}, {headers:{'Cache-Control':'private, no-store'}}); }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!sameOrigin(request)) return NextResponse.json({error:'Origem não permitida.'},{status:403});
  if (!webPushConfig()) return NextResponse.json({error:'As notificações móveis ainda não estão configuradas.'},{status:503});
  if (!hasSafeRequestSize(request,8192)) return NextResponse.json({error:'Inscrição inválida.'},{status:413});
  try {
    await requireUrgentAlertPolicy();
    const raw=await request.text(); if(Buffer.byteLength(raw)>8192)return NextResponse.json({error:'Inscrição inválida.'},{status:413});
    const subscription=validatePushSubscription(JSON.parse(raw)?.subscription), actor=currentAccount()!;
    const bindingId=await db<string>('rpc/register_web_push',{method:'POST',body:{p_company_id:actor.companyId,p_broker_id:actor.brokerId,p_session_hash:sessionHash(request),p_endpoint_hash:pushEndpointHash(subscription.endpoint),p_subscription:subscription}});
    return NextResponse.json({ok:true,bindingId});
  } catch(error) { return NextResponse.json({error:error instanceof WebPushInputError?'Inscrição de notificações inválida.':'Não foi possível ativar as notificações.'},{status:error instanceof WebPushInputError || error instanceof SyntaxError?400:503}); }
});
export const DELETE = protectedRoute(async (request: NextRequest) => {
  if (!sameOrigin(request)) return NextResponse.json({error:'Origem não permitida.'},{status:403});
  if (!hasSafeRequestSize(request,8192)) return NextResponse.json({error:'Inscrição inválida.'},{status:413});
  try {
    const raw=await request.text(); if(Buffer.byteLength(raw)>8192)return NextResponse.json({error:'Inscrição inválida.'},{status:413});
    const endpoint=validPushEndpoint(JSON.parse(raw)?.endpoint), actor=currentAccount()!;
    await db(`web_push_subscriptions?company_id=eq.${actor.companyId}&broker_id=eq.${actor.brokerId}&session_hash=eq.${sessionHash(request)}&endpoint_hash=eq.${pushEndpointHash(endpoint)}`,{method:'DELETE'});
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({error:'Não foi possível desativar as notificações.'},{status:400}); }
});
