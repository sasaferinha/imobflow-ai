import { supabaseServiceRequest } from '../supabase';
import type { CrmState } from './model';
import { buildBuyerReport, buyerReportPeriods, type BuyerReportFrequency, type BuyerReportPeriod } from './buyer-report';

export type ScheduledBuyerReport = { periodKey: string; generatedAt: string; report: BuyerReportPeriod };
type StoredReport = { company_id: string; frequency: BuyerReportFrequency; period_key: string; generated_at: string; report: BuyerReportPeriod };

export async function readScheduledBuyerReports(companyId: string, frequency: BuyerReportFrequency): Promise<ScheduledBuyerReport[]> {
  const rows = await supabaseServiceRequest<StoredReport[]>(`crm_buyer_reports?company_id=eq.${encodeURIComponent(companyId)}&frequency=eq.${frequency}&select=company_id,frequency,period_key,generated_at,report&order=period_start.desc&limit=6`, { timeoutMs: 3000 });
  if (!Array.isArray(rows) || rows.some(row => row.company_id !== companyId || row.frequency !== frequency || row.period_key !== row.report?.key
    || !Array.isArray(row.report?.buyers) || !Number.isFinite(Date.parse(row.generated_at)))) throw new Error('buyer_report_scope');
  return rows.map(row => ({ periodKey: row.period_key, generatedAt: row.generated_at, report: row.report }));
}

export async function generateScheduledBuyerReport(state: CrmState, now = new Date()) {
  const frequency = state.settings.buyerReportFrequency === 'weekly' ? 'weekly' : 'monthly';
  const period = buyerReportPeriods(frequency, now)[1];
  const existing = await supabaseServiceRequest<Array<{ period_key: string }>>(`crm_buyer_reports?company_id=eq.${encodeURIComponent(state.companyId)}&frequency=eq.${frequency}&period_key=eq.${period.key}&select=period_key&limit=1`, { timeoutMs: 3000 });
  if (existing.length) return { status: 'already-generated' as const, period: period.key };
  const report = buildBuyerReport(state, frequency, now).periods[1];
  // Unique company/frequency/period key makes parallel workers/retries idempotent.
  const result = await supabaseServiceRequest<Array<{ period_key: string }>>('crm_buyer_reports?on_conflict=company_id,frequency,period_key&select=period_key', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', timeoutMs: 3000,
    body: { company_id: state.companyId, frequency, period_key: period.key, period_start: period.start, period_end: period.end,
      generated_at: now.toISOString(), report },
  });
  return { status: result.length ? 'generated' as const : 'already-generated' as const, period: period.key };
}
