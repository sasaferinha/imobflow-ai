import { NextRequest, NextResponse } from 'next/server';
import { isValidAdminPassword } from '@/lib/admin-auth';
import { newToken, normalizeName, tokenHash } from '@/lib/accounts';
import { consumeRateLimit, hasSameOrigin } from '@/lib/request-security';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    if (!await consumeRateLimit(request, 'license-create', 5, 900)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, { status: 429 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2048) return NextResponse.json({ error: 'Dados acima do limite.' }, { status: 413 });
    const body = JSON.parse(raw) as Record<string, unknown>;
    const managementPassword = typeof body.managementPassword === 'string' ? body.managementPassword : '';
    if (!isValidAdminPassword(managementPassword)) return NextResponse.json({ error: 'Senha administrativa incorreta.' }, { status: 401 });
    const seatLimit = Number(body.seatLimit);
    if (!Number.isInteger(seatLimit) || seatLimit < 1 || seatLimit > 500) return NextResponse.json({ error: 'Informe um limite entre 1 e 500 corretores.' }, { status: 400 });
    const company = typeof body.company === 'string' ? body.company.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
    if (company && (company.length < 2 || company.length > 120)) return NextResponse.json({ error: 'Nome da empresa inválido.' }, { status: 400 });
    const key = `IMF-${newToken()}`;
    await supabaseRequest('rpc/create_access_license', { method: 'POST', body: {
      p_key_hash: tokenHash(key), p_seat_limit: seatLimit, p_company_key: company ? normalizeName(company) : null,
    } });
    return NextResponse.json({ key, seatLimit });
  } catch {
    return NextResponse.json({ error: 'Não foi possível gerar a chave. Confira a empresa e tente novamente.' }, { status: 503 });
  }
}
