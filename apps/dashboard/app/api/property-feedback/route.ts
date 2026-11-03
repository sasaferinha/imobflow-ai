import { NextRequest, NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { hasSafeRequestSize, hasSameOrigin } from '@/lib/request-security';
import { CrmError } from '@/lib/evolution/model';
import { readEvolutionState } from '@/lib/evolution/server';
import { ensureCaseFeedback, listCaseFeedback } from '@/lib/evolution/property-feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof CrmError ? error.message : 'Não foi possível carregar a avaliação. Verifique se a atualização do banco foi instalada e tente novamente.' }, { status: error instanceof CrmError ? error.status : 503 });
}
export const GET = protectedRoute(async (request: NextRequest) => {
  try {
    const caseId = request.nextUrl.searchParams.get('caseId') || '';
    if (!caseId || caseId.length > 150) throw new CrmError('Atendimento inválido.');
    const actor = currentAccount()!;
    return NextResponse.json({ requests: await listCaseFeedback(actor, await readEvolutionState(actor), caseId) });
  } catch (error) { return failure(error); }
});
export const POST = protectedRoute(async (request: NextRequest) => {
  if (!request.headers.get('origin') || !hasSameOrigin(request)) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!hasSafeRequestSize(request, 4096)) return NextResponse.json({ error: 'Requisição muito grande.' }, { status: 413 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > 4096) throw new CrmError('Requisição muito grande.', 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['caseId', 'send'].includes(key)) || typeof body.caseId !== 'string' || !body.caseId || body.caseId.length > 150 || typeof body.send !== 'boolean') throw new CrmError('Solicitação inválida.');
    const actor = currentAccount()!;
    return NextResponse.json(await ensureCaseFeedback(actor, await readEvolutionState(actor), body.caseId, body.send));
  } catch (error) { return failure(error); }
});
