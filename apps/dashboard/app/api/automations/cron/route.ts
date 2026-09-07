import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'Agendador não configurado.' }, { status: 503 });
  const actual = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  try {
    const execution = await runAutomations('cron');
    return NextResponse.json(execution, { status: execution.failed ? 500 : execution.busy ? 409 : 200 });
  } catch { return NextResponse.json({ error: 'Falha na execução agendada.' }, { status: 500 }); }
}
