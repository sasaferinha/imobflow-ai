import { after, NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, cookieOptions, hashPassword, normalizeEmail, readAccount, tokenHash, verifyPassword } from '@/lib/accounts';
import { hasSameOrigin, consumeRateLimit } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';
import { passwordEmailConfigured, passwordRecoveryFailure, sendPasswordEmail, type RecoveryAccount } from '@/lib/password-recovery';

export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403);
  try {
    if (!await consumeRateLimit(request,'password-access',8,900)) return json({ error: 'Muitas tentativas. Aguarde 15 minutos.' },429);
    const raw = await request.text();
    if (Buffer.byteLength(raw)>4096) return json({ error: 'Dados acima do limite.' },413);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return json({ error: 'Dados inválidos.' },400); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' },400);
    const body = parsed as Record<string, unknown>;
    if (body.action === 'request') {
      if (!passwordEmailConfigured()) return json({ error: 'Recuperação por e-mail ainda não configurada. Se você é corretor, peça ao administrador um link de recuperação. Administradores devem contatar o responsável pelo ImobFlow.' },503);
      const role = body.role;
      const email = typeof body.email==='string' ? normalizeEmail(body.email) : '';
      if ((role !== 'owner' && role !== 'broker') || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe seu e-mail e selecione o tipo de acesso.' },400);
      // Same response/timing for existing/missing accounts. Email work occurs later.
      after(async () => {
        try {
          const allowed = await supabaseRequest<boolean>('rpc/consume_rate_limit',{method:'POST',body:{p_bucket:'password-email',p_identifier_hash:tokenHash(role+'\0'+email),p_window_seconds:3600,p_limit:3}});
          if (!allowed) return;
          const accounts = await supabaseRequest<RecoveryAccount[]>(`broker_accounts?email_key=eq.${encodeURIComponent(email)}&role=eq.${role}&active=eq.true&select=id,company_id,email,password_hash,active,role,auth_version&limit=2`);
          if (accounts.length === 1) await sendPasswordEmail(accounts[0]);
        } catch (error) { console.error('password_recovery_email_failed', passwordRecoveryFailure(error)); }
      });
      return json({ message: 'Se houver uma conta ativa com esses dados, você receberá um link de recuperação por e-mail.' });
    }
    const password = typeof body.password==='string' ? body.password : '';
    if (password.length<8 || password.length>128 || password!==body.confirmPassword) return json({ error: 'Confirme uma senha com pelo menos 8 caracteres.' },400);
    let changed = false;
    if (body.action === 'reset') {
      const token = typeof body.token==='string' ? body.token : '';
      if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: 'Link inválido ou expirado.' },400);
      changed = await supabaseRequest<boolean>('rpc/consume_account_password_reset',{method:'POST',body:{p_token_hash:tokenHash(token),p_new_hash:await hashPassword(password)}});
    } else if (body.action === 'change') {
      const account = await readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value);
      if (!account) return json({ error:'Entre na sua conta.' },401);
      const currentPassword = typeof body.currentPassword==='string' ? body.currentPassword : '';
      if (!currentPassword || currentPassword.length>128) return json({ error:'Informe a senha atual.' },400);
      const [row] = await supabaseRequest<RecoveryAccount[]>(`broker_accounts?id=eq.${account.brokerId}&company_id=eq.${account.companyId}&active=eq.true&select=password_hash,auth_version&limit=1`);
      if (!row || !await verifyPassword(currentPassword,row.password_hash)) return json({ error:'Senha atual incorreta.' },403);
      changed = await supabaseRequest<boolean>('rpc/change_account_password',{method:'POST',body:{p_broker_id:account.brokerId,p_expected_hash:row.password_hash,p_new_hash:await hashPassword(password),p_expected_auth_version:row.auth_version}});
    } else return json({ error:'Ação inválida.' },400);
    if (!changed) return json({ error:'Link inválido, expirado ou já utilizado. Solicite outro link.' },400);
    const response = json({ message:'Senha alterada. Todas as sessões anteriores foram encerradas. Entre com sua nova senha.' });
    response.cookies.set(ACCOUNT_COOKIE,'',{...cookieOptions,maxAge:0});
    return response;
  } catch { return json({ error:'Não foi possível alterar o acesso. Tente novamente.' },503); }
}
