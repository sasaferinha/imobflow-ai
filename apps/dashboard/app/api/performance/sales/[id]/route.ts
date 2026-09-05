import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { deleteSale } from '@/lib/database';

export const runtime = 'nodejs';

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return await deleteSale((await context.params).id)
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404 });
  } catch (error) {
    console.error('sale_delete_failed', error);
    return NextResponse.json({ error: 'Não foi possível excluir a venda.' }, { status: 500 });
  }
}
