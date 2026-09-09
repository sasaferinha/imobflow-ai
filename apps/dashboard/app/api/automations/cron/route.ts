import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations';
import { supabaseRequest } from '@/lib/supabase';
import { withAccount } from '@/lib/tenant-context';

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
    const companies = await supabaseRequest<Array<{ company_id: string; name: string }>>('account_companies?select=company_id,name');
    const executions = await Promise.all(companies.map(async (company) => {
      const result = await withAccount({ companyId: company.company_id, company: company.name, brokerId: 'system', name: 'Agendador', role: 'owner' }, () => runAutomations('cron'));
      return { companyId: company.company_id, ...result };
    }));
    const failed = executions.some((item) => item.failed);
    return NextResponse.json({ executions }, { status: failed ? 500 : 200 });
  } catch { return NextResponse.json({ error: 'Falha na execução agendada.' }, { status: 500 }); }
}
