import { NextResponse } from 'next/server';
import { protectedRoute } from '@/lib/accounts';
import { currentAccount } from '@/lib/tenant-context';
import { supabaseRequest } from '@/lib/supabase';
import { urgentAlertEligibleAt } from '@/lib/conversation-urgency';
import { readUrgentAlertWindow, requireUrgentAlertPolicy } from '@/lib/urgent-alert-hours';

export const runtime = 'nodejs';
export const maxDuration = 30;
const PAGE_SIZE = 200;
const RESULT_LIMIT = 50;
const headers = { 'Cache-Control': 'private, no-store' };
type Waiting = {
  company_id: string;
  lead_id: string;
  waiting_since: string;
  duty_priority_until: string | null;
  duty_preferred: boolean;
};

export const GET = protectedRoute(async () => {
  const actor = currentAccount()!;
  const fetchedAt = Date.now();
  const data: {leadId: string; waitingSince: string}[] = [];
  const seen = new Set<string>();
  try {
    await requireUrgentAlertPolicy();
    const activeUntil = await readUrgentAlertWindow(actor.companyId);
    const respond = () => NextResponse.json({ data: activeUntil !== null && Date.now() < activeUntil ? data : [], fetchedAt, activeUntil }, {headers});
    if (activeUntil === null) return respond();
    // Page contacts, not a global message sample. Keep going past reserved/recent
    // contacts so they cannot hide older eligible results behind a row limit.
    for (let page = 0; page < 25 && Date.now() - fetchedAt < 20000; page++) {
      const rows = await supabaseRequest<Waiting[]>(
        `rpc/broker_unassigned_waiting?order=waiting_since.asc,lead_id.asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        {method: 'POST', body: {p_company_id: actor.companyId, p_broker_id: actor.brokerId}, timeoutMs: 5000},
      );
      if (!Array.isArray(rows)) throw new Error('waiting_unavailable');
      for (const row of rows) {
        if (row.company_id !== actor.companyId) throw new Error('waiting_scope');
        const eligibleAt = urgentAlertEligibleAt({dutyPriorityUntil: row.duty_priority_until, dutyPreferred: row.duty_preferred}, row.waiting_since);
        if (eligibleAt === null || eligibleAt > fetchedAt || seen.has(row.lead_id)) continue;
        seen.add(row.lead_id);
        data.push({leadId: row.lead_id, waitingSince: row.waiting_since});
        if (data.length === RESULT_LIMIT) return respond();
      }
      if (rows.length < PAGE_SIZE) return respond();
    }
    // Never silently present an incomplete global sample as an empty inbox.
    throw new Error('waiting_scan_limit');
  } catch {
    return NextResponse.json({error: 'Não foi possível atualizar os atendimentos aguardando corretor.'}, {status: 503, headers});
  }
});
