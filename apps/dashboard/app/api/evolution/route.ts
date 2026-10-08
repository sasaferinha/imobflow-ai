import { after, NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSameOrigin, hasSafeRequestSize } from '@/lib/request-security';
import { CrmError, type CrmCommand } from '@/lib/evolution/model';
import { EvolutionServerError, executeEvolutionCommand, getEvolutionSnapshot } from '@/lib/evolution/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAXIMUM_BODY_BYTES = 65_536;

function failure(error: unknown) {
  if (error instanceof CrmError || error instanceof EvolutionServerError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('crm_evolution_request_failed');
  return NextResponse.json({ error: 'Não foi possível confirmar o resultado. Atualize a página antes de tentar novamente.' }, { status: 503 });
}

async function handleGET() {
  try { return NextResponse.json(await getEvolutionSnapshot(currentAccount()!)); }
  catch (error) { return failure(error); }
}

async function handlePOST(request: NextRequest) {
  if (!request.headers.get('origin') || !hasSameOrigin(request)) {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }
  if (!hasSafeRequestSize(request, MAXIMUM_BODY_BYTES)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAXIMUM_BODY_BYTES) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
    body = parsed as Record<string, unknown>;
    if (!body.command || typeof body.command !== 'object' || Array.isArray(body.command)
      || typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw new Error('invalid_body');
  } catch { return NextResponse.json({ error: 'Comando inválido. Confira os dados enviados.' }, { status: 400 }); }
  try {
    const actor = currentAccount()!;
    return NextResponse.json(await executeEvolutionCommand(actor, body.command as CrmCommand, body.expectedVersion as number, typeof body.expectedSourceRevision === 'string' ? body.expectedSourceRevision : undefined, ids => {
      after(async () => {
        const { onPropertyChanged } = await import('@/lib/opportunities');
        await Promise.all(ids.map(id => onPropertyChanged(actor.companyId, id)));
      });
    }));
  } catch (error) { return failure(error); }
}

export const GET = protectedRoute(handleGET);
export const POST = protectedRoute(handlePOST);
