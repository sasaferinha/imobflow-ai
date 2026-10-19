import { supabaseServiceRequest } from '../supabase';
import { withAccount } from '../tenant-context';
import { evolutionEnabled } from './feature';
import { evolutionIntegrated, executeEvolutionCommand, readEvolutionState } from './server';
import { weeklyReport } from './weekly-report';
import { captureReminderCandidates } from './operations';

/** Opt-in internal routines. Inactive portfolios become unassigned; no external messages. */
export async function runEvolutionScheduler(companyId: string, company: string, deadline = Date.now() + 45000) {
  if (!evolutionEnabled(companyId)) return { report: 'disabled' };
  const owners = await supabaseServiceRequest<Array<{ id: string; name: string }>>(
    `broker_accounts?company_id=eq.${encodeURIComponent(companyId)}&active=eq.true&role=eq.owner&select=id,name&order=created_at.asc&limit=1`,
  );
  if (!owners[0]) return { report: 'no-owner' };
  const actor = { companyId, company, brokerId: owners[0].id, name: owners[0].name, role: 'owner' as const };
  return withAccount(actor, async () => {
    let state = await readEvolutionState(actor);
    if (Date.now() + 12000 > deadline) return { report: 'deferred' };
    let released = 0;
    let inactivePool: { status: 'disabled' | 'blocked' | 'deferred' | 'completed'; reason?: 'canonical-integration-required' | 'schema-unavailable' | 'unverified-contacts' } = { status: 'disabled' };
    let releaseReady = false;
    if (state.settings.operations?.inactivePoolEnabled) {
      if (!evolutionIntegrated()) inactivePool = { status: 'blocked', reason: 'canonical-integration-required' };
      else {
        // A persisted opt-in may predate the verified-contact migration. Recheck
        // on every run; missing/old schema must never invoke the legacy policy.
        try {
          const ready = await supabaseServiceRequest<{ inactivePool?: boolean; verifiedInactiveContacts?: boolean } | null>(
            'rpc/crm_operational_rules_ready', { method: 'POST', body: { p_company_id: companyId, p_actor_id: actor.brokerId }, timeoutMs: 3000 },
          );
          releaseReady = ready?.inactivePool === true && ready?.verifiedInactiveContacts === true;
          inactivePool = { status: 'blocked', reason: 'unverified-contacts' };
        } catch {
          inactivePool = { status: 'blocked', reason: 'schema-unavailable' };
        }
      }
      if (releaseReady && Date.now() + 12000 > deadline) {
        releaseReady = false;
        inactivePool = { status: 'deferred' };
      }
    }
    // A blocked pool does not prevent independent capture reminders/reports.
    if (releaseReady) {
      const pool = await supabaseServiceRequest<{ released: number; protected: Array<{ leadId: string; lastContactAt: string | null; reason?: string }> }>(
        'rpc/release_inactive_lead_pool', { method: 'POST', body: { p_company_id: companyId, p_actor_id: actor.brokerId }, timeoutMs: 5000 },
      );
      released = pool.released;
      inactivePool = { status: 'completed' };
      state = await readEvolutionState(actor);
      // A failed CAS leaves the protected contact eligible for review on the next run.
      // Linking the contact and timestamp keeps retries/renames from duplicating requests.
      let warnings = 0;
      for (const candidate of pool.protected) {
        if (warnings >= 5) break;
        if (Date.now() + 12000 > deadline) break;
        const leadId = `lead:${candidate.leadId}`;
        const lead = state.records.find(record => record.kind === 'leads' && record.id === leadId);
        const unverified = candidate.reason === 'contact-history-unverified';
        const contactTime = candidate.lastContactAt ? Date.parse(candidate.lastContactAt) : NaN;
        if (!lead || (!unverified && !Number.isFinite(contactTime))) continue;
        // An empty optional date is the stable unknown key; never fabricate a contact date.
        const contactAt = Number.isFinite(contactTime) ? new Date(contactTime).toISOString() : '';
        if (state.records.some(record => record.kind === 'followups' && record.data.protectedLeadId === leadId && (record.data.poolContactAt || '') === contactAt)
          || state.events.some(event => event.type === 'created' && event.changes?.protectedLeadId?.to === leadId && (event.changes?.poolContactAt?.to || '') === contactAt)) continue;
        await executeEvolutionCommand(actor, { type: 'save', kind: 'followups', data: {
          name: `Revisar carteira · ${String(lead.data.name).slice(0, 160)}`, assignedTo: actor.brokerId,
          protectedLeadId: leadId, poolContactAt: contactAt,
          dueAt: new Date(Date.now() + 86400000).toISOString(), priority: 'Alta', status: 'Pendente',
          request: unverified
            ? 'O histórico deste cliente não permite comprovar com segurança 30 dias sem contato. A carteira foi preservada. Confira as mensagens, especialmente contatos antigos do Instagram, e os registros manuais antes de decidir sobre a liberação.'
            : 'Este cliente está há pelo menos 30 dias sem contato, mas possui visita ou negociação que protege sua carteira. Confira o compromisso e solicite atualização ao corretor antes de decidir sobre a liberação.',
        } }, state.version, state.sourceRevision);
        warnings++;
        state = await readEvolutionState(actor);
      }
    }
    const candidates = Date.now() + 12000 <= deadline ? captureReminderCandidates(state) : [];
    if (candidates.length) {
      await executeEvolutionCommand(actor, { type: 'capture-reminders' }, state.version, state.sourceRevision);
      state = await readEvolutionState(actor);
    }
    const captureReminders = candidates.length;
    if (Date.now() + 12000 > deadline) return { report: 'deferred', captureReminders, released, inactivePool };
    if (!state.settings.operations?.weeklyReportsEnabled) return { report: 'disabled', captureReminders, released, inactivePool };
    const report = weeklyReport(state);
    const notices = new Set(state.records.filter(r=>r.kind==='notices').map(r=>r.id));
    if (state.records.some(r => r.kind === 'notices' && r.data.name === report.title)
      || state.events.some(e=>notices.has(e.recordId) && e.type==='created' && e.changes?.name?.to===report.title)) return { report: 'already-generated', captureReminders, released, inactivePool };
    // Same workspace CAS means overlapping cron executions cannot duplicate this notice.
    await executeEvolutionCommand(actor, { type: 'save', kind: 'notices', data: { name: report.title, text: report.text } }, state.version, state.sourceRevision);
    return { report: 'generated', captureReminders, released, inactivePool };
  });
}
