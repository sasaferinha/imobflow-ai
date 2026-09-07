import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { automationSnapshot, completeAutomationResult, prepareMatchMessage, runAutomations, setAutomationActive } from '@/lib/automations';
import { isFlowId } from '@/lib/automation-rules';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  try { return NextResponse.json({ data: await automationSnapshot() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Não foi possível acessar o banco de automações.' }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'Conecte o banco de dados para executar automações.' }, { status: 503 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 }); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NextResponse.json({ error: 'Solicitação inválida.' }, { status: 400 });
  const body = raw as Record<string, unknown>;
  try {
    if (body.action === 'prepare-message' && typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id)) {
      const draft = await prepareMatchMessage(body.id);
      return NextResponse.json(draft, { status: draft.error ? 409 : 200, headers: { 'Cache-Control': 'no-store' } });
    } else if (body.action === 'toggle' && isFlowId(body.flowId) && typeof body.active === 'boolean') {
      await setAutomationActive(body.flowId, body.active);
    } else if (body.action === 'run' && (body.flowId === undefined || isFlowId(body.flowId))) {
      const execution = await runAutomations('manual', body.flowId);
      return NextResponse.json({ data: await automationSnapshot(), execution });
    } else if (body.action === 'complete' && typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id)) {
      await completeAutomationResult(body.id);
    } else return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    return NextResponse.json({ data: await automationSnapshot() });
  } catch { return NextResponse.json({ error: 'A operação falhou. Verifique o histórico e tente novamente.' }, { status: 503 }); }
}
