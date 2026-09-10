import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute, verifyPassword } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSameOrigin, consumeRateLimit } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';
import { issuePasswordLink, type RecoveryAccount } from '@/lib/password-recovery';

export const runtime='nodejs';
async function handle(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const actor=currentAccount();
  if (!actor || actor.role!=='owner') return NextResponse.json({error:'Apenas o administrador pode gerenciar o acesso dos corretores.'},{status:403});
  if (!hasSameOrigin(request)) return NextResponse.json({error:'Origem não permitida.'},{status:403});
  try {
    if (!await consumeRateLimit(request,'broker-access',20,900)) return NextResponse.json({error:'Muitas alterações. Aguarde 15 minutos.'},{status:429});
    const {id}=await params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({error:'Corretor inválido.'},{status:400});
    const raw=await request.text();
    if(Buffer.byteLength(raw)>2048) return NextResponse.json({error:'Dados acima do limite.'},{status:413});
    const body=JSON.parse(raw) as Record<string,unknown>;
    if (request.method==='PATCH') {
      if(typeof body.active!=='boolean') return NextResponse.json({error:'Informe o estado do acesso.'},{status:400});
      const rows=await supabaseRequest<unknown[]>('rpc/set_company_broker_active',{method:'POST',body:{p_actor_id:actor.brokerId,p_broker_id:id,p_active:body.active}});
      return NextResponse.json({data:rows[0]});
    }
    const currentPassword=typeof body.currentPassword==='string'?body.currentPassword:'';
    if(!currentPassword || currentPassword.length>128) return NextResponse.json({error:'Confirme sua senha de administrador.'},{status:400});
    const [owner]=await supabaseRequest<RecoveryAccount[]>(`broker_accounts?id=eq.${actor.brokerId}&company_id=eq.${actor.companyId}&active=eq.true&select=password_hash,auth_version&limit=1`);
    if(!owner || !await verifyPassword(currentPassword,owner.password_hash)) return NextResponse.json({error:'Senha de administrador incorreta.'},{status:403});
    const [target]=await supabaseRequest<RecoveryAccount[]>(`broker_accounts?id=eq.${id}&company_id=eq.${actor.companyId}&role=eq.broker&active=eq.true&select=id,company_id,email,password_hash,active,role,auth_version&limit=1`);
    if(!target) return NextResponse.json({error:'Corretor ativo não encontrado nesta empresa.'},{status:404});
    return NextResponse.json({url:await issuePasswordLink(target,{id:actor.brokerId,password_hash:owner.password_hash,auth_version:owner.auth_version}),expiresInMinutes:30},{headers:{'Cache-Control':'private, no-store'}});
  } catch { return NextResponse.json({error:'Não foi possível alterar este acesso. Confira o corretor e o limite de três vagas ativas.'},{status:409}); }
}
export const PATCH=protectedRoute(handle);
export const POST=protectedRoute(handle);
