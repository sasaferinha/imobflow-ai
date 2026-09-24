import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { deleteSale } from '@/lib/database';
import { hasSameOrigin } from '@/lib/request-security';
import { currentAccount } from '@/lib/tenant-context';

export const runtime = 'nodejs';

async function handleDELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (currentAccount()?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode excluir negócios.' }, { status: 403 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  try {
    return await deleteSale((await context.params).id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404 });
  } catch (error) {
    console.error('sale_delete_failed', error);
    return NextResponse.json({ error: 'Não foi possível excluir a venda.' }, { status: 500 });
  }
}

export const DELETE = protectedRoute(handleDELETE);
