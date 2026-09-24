import { protectedRoute } from '@/lib/accounts';
import { NextRequest, NextResponse } from 'next/server';
import { importLeads } from '@/lib/database';
import { isAdminRequest } from '@/lib/admin-auth';
import { hasSameOrigin, hasSafeRequestSize } from '@/lib/request-security';
import { currentAccount } from '@/lib/tenant-context';
import { IMPORT_BYTES, IMPORT_LIMIT, validateImportLead } from '@/lib/lead-import';
import { supabaseRequest } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function handlePOST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const account = currentAccount();
  if (account?.role !== 'owner') return NextResponse.json({ error: 'Somente o administrador pode importar clientes.' }, { status: 403 });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!hasSafeRequestSize(request, IMPORT_BYTES)) return NextResponse.json({ error: 'Arquivo muito grande. Use até 2 MB.' }, { status: 413 });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > IMPORT_BYTES) return NextResponse.json({ error: 'Arquivo muito grande. Use até 2 MB.' }, { status: 413 });
    let leads;
    try {
      const body = JSON.parse(raw);
      if (!Array.isArray(body?.leads) || !body.leads.length || body.leads.length > IMPORT_LIMIT) throw Error('Envie de 1 a 500 clientes por importação.');
      leads = (body.leads as unknown[]).map((row, index) => {
        try { return validateImportLead(row); }
        catch (e) { throw Error(`Registro ${index + 1}: ${e instanceof Error ? e.message : 'Dados inválidos.'}`); }
      });
    } catch (e) { return NextResponse.json({ error: e instanceof SyntaxError ? 'Arquivo inválido.' : e instanceof Error ? e.message : 'Dados inválidos.' }, { status: 400 }); }
    if (leads.some(l => l.assignedTo)) {
      const brokers = await supabaseRequest<Array<{ name: string }>>(`broker_accounts?company_id=eq.${account.companyId}&active=eq.true&select=name`, { allRows: true });
      const unknown = leads.find(l => l.assignedTo && !brokers.some(b => b.name === l.assignedTo));
      if (unknown) return NextResponse.json({ error: `Corretor não encontrado: ${unknown.assignedTo}. Use um nome ativo desta empresa ou deixe em branco.` }, { status: 400 });
    }
    const data = await importLeads(leads);
    // Lead INSERT triggers generate opportunities in the same database transaction.
    // Importing contacts must never trigger outgoing messages or AI calls.
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('lead_import_failed', error);
    return NextResponse.json({ error: 'Não foi possível importar a base de leads.' }, { status: 500 });
  }
}

export const POST = protectedRoute(handlePOST);
