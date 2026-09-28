import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';
import type { ConversationInboxItem } from '@/lib/conversation-inbox';

export const runtime = 'nodejs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const GET = protectedRoute(async (request: NextRequest) => {
  const actor = currentAccount()!;
  const leadId = new URL(request.url).searchParams.get('leadId');
  if (leadId && !uuid.test(leadId)) return NextResponse.json({error:'Conversa inválida.'},{status:400});
  try {
    const data = await supabaseRequest<ConversationInboxItem[]>('rpc/get_conversation_inbox', {method:'POST',body:{p_company_id:actor.companyId,p_broker_id:actor.brokerId,p_lead_id:leadId || null}});
    return NextResponse.json({data}, {headers:{'Cache-Control':'private, no-store'}});
  } catch { return NextResponse.json({error:'Não foi possível atualizar as mensagens não lidas.'},{status:503}); }
});

export const POST = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({error:'Origem inválida.'},{status:403});
  const actor = currentAccount()!;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw)>16000) return NextResponse.json({error:'Dados acima do limite.'},{status:413});
    let body;
    try { body=JSON.parse(raw); } catch { return NextResponse.json({error:'Dados inválidos.'},{status:400}); }
    if (!body || !uuid.test(body.leadId || '') || !Array.isArray(body.positions) || !body.positions.length || body.positions.length>100
      || body.positions.some((item: {conversationId?:string;position?:number} | null)=>!item || !uuid.test(item.conversationId || '') || !Number.isSafeInteger(item.position) || (item.position ?? -1)<0)) {
      return NextResponse.json({error:'Leitura inválida.'},{status:400});
    }
    await supabaseRequest('rpc/mark_conversation_read',{method:'POST',body:{p_company_id:actor.companyId,p_broker_id:actor.brokerId,p_lead_id:body.leadId,p_positions:body.positions}});
    return NextResponse.json({ok:true});
  } catch { return NextResponse.json({error:'Não foi possível salvar a leitura.'},{status:409}); }
});
