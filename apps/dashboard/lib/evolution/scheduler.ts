import { supabaseServiceRequest } from '../supabase';
import { withAccount } from '../tenant-context';
import { evolutionEnabled } from './feature';
import { executeEvolutionCommand, readEvolutionState } from './server';
import { weeklyReport } from './weekly-report';

/** Only opt-in internal reports. Never transfers customers or sends messages. */
export async function runEvolutionScheduler(companyId: string, company: string) {
  if (!evolutionEnabled(companyId)) return { report: 'disabled' };
  const owners = await supabaseServiceRequest<Array<{ id: string; name: string }>>(
    `broker_accounts?company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&role=eq.owner&select=id,name&order=created_at.asc&limit=1`,
  );
  if (!owners[0]) return { report: 'no-owner' };
  const actor = { companyId, company, brokerId: owners[0].id, name: owners[0].name, role: 'owner' as const };
  return withAccount(actor, async () => {
    const state = await readEvolutionState(actor);
    if (!state.settings.operations?.weeklyReportsEnabled) return { report: 'disabled' };
    const report = weeklyReport(state);
    const notices = new Set(state.records.filter(r=>r.kind==='notices').map(r=>r.id));
    if (state.records.some(r => r.kind === 'notices' && r.data.name === report.title)
      || state.events.some(e=>notices.has(e.recordId) && e.type==='created' && e.changes?.name?.to===report.title)) return { report: 'already-generated' };
    // Same workspace CAS means overlapping cron executions cannot duplicate this notice.
    await executeEvolutionCommand(actor, { type: 'save', kind: 'notices', data: { name: report.title, text: report.text } }, state.version, state.sourceRevision);
    return { report: 'generated' };
  });
}
