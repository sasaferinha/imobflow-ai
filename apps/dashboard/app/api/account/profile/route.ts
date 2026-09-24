import { NextRequest, NextResponse } from 'next/server';
import { normalizeName, protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';

function clean(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
}

export const GET = protectedRoute(async () => {
  const account = currentAccount()!;
  return NextResponse.json({ data: { brokerId: account.brokerId, name: account.name, company: account.company, role: account.role } });
});

export const PATCH = protectedRoute(async (request: NextRequest) => {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  const account = currentAccount()!;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return NextResponse.json({ error: 'Dados acima do limite.' }, { status: 413 });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    const name = clean(body.name);
    const company = clean(body.company);
    const expectedName = clean(body.expectedName);
    const expectedCompany = clean(body.expectedCompany);
    if ([name, company, expectedName, expectedCompany].some(value => value.length < 2 || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))) {
      return NextResponse.json({ error: 'Nome e imobiliária devem ter de 2 a 120 caracteres.' }, { status: 400 });
    }
    if (account.role !== 'owner' && company !== account.company) {
      return NextResponse.json({ error: 'Somente o administrador pode alterar o nome da imobiliária.' }, { status: 403 });
    }
    const [updated] = await supabaseRequest<Array<{ broker_id: string; name: string; company: string; role: 'owner' | 'broker' }>>('rpc/update_account_profile', {
      method: 'POST', body: {
        p_company_id: account.companyId, p_broker_id: account.brokerId,
        p_name: name, p_name_key: normalizeName(name), p_company: company, p_company_key: normalizeName(company),
        p_expected_name: expectedName, p_expected_company: expectedCompany,
      },
    });
    if (!updated) return NextResponse.json({ error: 'Seu perfil foi alterado em outra sessão. Feche e abra novamente antes de salvar.' }, { status: 409 });
    return NextResponse.json({ data: { brokerId: updated.broker_id, name: updated.name, company: updated.company, role: updated.role } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/23505|unique_violation/.test(message)) return NextResponse.json({ error: 'Esse nome já está em uso. Escolha outro nome para salvar o perfil.' }, { status: 409 });
    return NextResponse.json({ error: 'Não foi possível salvar o perfil. Nenhuma alteração foi confirmada; tente novamente.' }, { status: 503 });
  }
});
