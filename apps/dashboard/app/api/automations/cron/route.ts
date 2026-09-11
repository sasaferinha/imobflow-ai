import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAutomations } from '@/lib/automations';
import { supabaseRequest } from '@/lib/supabase';
import { withAccount } from '@/lib/tenant-context';
import { sweepOpportunities } from '@/lib/opportunities';
import {sweepMessageOutbox} from '@/lib/message-outbox';
import {removeExpiredConversationMedia} from '@/lib/whatsapp-media';

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
    const companies = await supabaseRequest<Array<{ company_id: string; name: string }>>('account_companies?select=company_id,name&order=company_id.asc&limit=1000');
    const executions = [];
    const deadline = Date.now() + 45_000;
    for (const company of companies) {
      try {
        await sweepMessageOutbox(company.company_id,deadline);
        if(Date.now()+10000<deadline)await removeExpiredConversationMedia(company.company_id,deadline);
        let complete = false;
        let generated = 0;
        let processed = 0;
        let busy = false;
        do {
          const page = await sweepOpportunities(company.company_id);
          complete = page.complete;
          generated += page.generated || 0;
          processed += page.processed || 0;
          busy = Boolean(page.busy);
        } while (!complete && !busy && Date.now() < deadline);
        const legacy = process.env.DATABASE_URL
          ? await withAccount({ companyId: company.company_id, company: company.name, brokerId: 'system', name: 'Agendador', role: 'owner' }, () => runAutomations('cron'))
          : { failed: 0 };
        executions.push({ companyId: company.company_id, complete, generated, processed, busy, failed: legacy.failed > 0 });
        await supabaseRequest('conversation_settings?on_conflict=company_id',{method:'POST',prefer:'resolution=merge-duplicates',body:{company_id:company.company_id,last_scheduler_at:new Date().toISOString()}});
      } catch { executions.push({ companyId: company.company_id, complete: false, generated: 0, failed: true }); }
      if (Date.now() >= deadline) break;
    }
    const failed = companies.length === 1000 || executions.length !== companies.length || executions.some((item) => item.failed || !item.complete);
    return NextResponse.json({ executions }, { status: failed ? 500 : 200 });
  } catch { return NextResponse.json({ error: 'Falha na execução agendada.' }, { status: 500 }); }
}
