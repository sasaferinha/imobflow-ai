import { createHash, randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { listLeads, listProperties } from './database';
import { automationFlows, evaluateAutomation, isFlowId, type FlowId } from './automation-rules';
import { newPropertyCandidates, whatsappNumber } from './property-matching';
import { supabaseCompanyId } from './supabase';

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Banco de dados não configurado.');
  return neon(process.env.DATABASE_URL);
}

// Schema is applied by versioned Neon migrations, never on incoming requests.
async function ensureAutomationSettings() {
  const sql = database();
  const companyId = supabaseCompanyId();
  await sql`UPDATE site_automation_settings SET active=FALSE WHERE company_id=${companyId} AND id IN ('qualification', 'recommendations') AND active=TRUE`;
  await sql`INSERT INTO site_automation_settings (company_id,id) SELECT ${companyId}, jsonb_array_elements_text(${JSON.stringify(automationFlows.map((flow) => flow.id))}::jsonb) ON CONFLICT DO NOTHING`;
}

export async function automationSnapshot() {
  if (!process.env.DATABASE_URL) return { configured: false, schedulerConfigured: false, flows: [], results: [], runs: [] };
  await ensureAutomationSettings();
  const sql = database();
  const companyId = supabaseCompanyId();
  const [settings, counts, results, runs] = await Promise.all([
    sql`SELECT * FROM site_automation_settings WHERE company_id=${companyId}`,
    sql`SELECT flow_id, count(*)::int AS total FROM site_automation_results WHERE company_id=${companyId} GROUP BY flow_id`,
    sql`SELECT id, flow_id, summary, detail, status, created_at FROM (
      SELECT *, row_number() OVER (PARTITION BY flow_id ORDER BY created_at DESC) AS position FROM site_automation_results WHERE company_id=${companyId} AND flow_id IN ('followup', 'priority', 'new-property')
    ) recent WHERE position <= 100 ORDER BY created_at DESC`,
    sql`SELECT * FROM site_automation_runs WHERE company_id=${companyId} AND flow_id IN ('followup', 'priority', 'new-property', 'all') ORDER BY created_at DESC LIMIT 40`,
  ]);
  return { configured: true, schedulerConfigured: Boolean(process.env.CRON_SECRET), flows: automationFlows.map((flow) => ({ ...flow, active: settings.find((setting) => setting.id === flow.id)?.active === true, total: Number(counts.find((count) => count.flow_id === flow.id)?.total || 0) })), results, runs };
}

export async function setAutomationActive(id: FlowId, active: boolean) {
  if (!isFlowId(id)) throw new Error('Automação indisponível.');
  await ensureAutomationSettings();
  await database()`UPDATE site_automation_settings SET active=${active} WHERE company_id=${supabaseCompanyId()} AND id=${id}`;
}

export async function completeAutomationResult(id: string) {
  await ensureAutomationSettings();
  return database()`UPDATE site_automation_results SET status='done' WHERE company_id=${supabaseCompanyId()} AND id=${id} AND status='open' RETURNING id`;
}

// A fresh read prevents an old draft from offering a sold property or a profile
// that has changed. Opening WhatsApp is a handoff, never an automatic send.
export async function prepareMatchMessage(id: string) {
  await ensureAutomationSettings();
  const rows = await database()`SELECT lead_id, detail FROM site_automation_results
    WHERE company_id=${supabaseCompanyId()} AND id=${id} AND flow_id='new-property' AND status='open'`;
  if (!rows.length) return { error: 'Este rascunho não está mais disponível.' };
  const [leads, properties] = await Promise.all([listLeads(10001), listProperties(true)]);
  const lead = leads.find((item) => item.id === rows[0].lead_id);
  const candidate = lead && newPropertyCandidates(lead, properties).find((item) => item.detail.propertyId === rows[0].detail.propertyId);
  if (!candidate || !lead) return { error: 'O perfil, a disponibilidade ou a janela de novidade mudou. Não envie este rascunho.' };
  const phone = whatsappNumber(lead.phone);
  return { message: String(candidate.detail.message), phone };
}

export async function runAutomations(trigger: 'manual' | 'event' | 'cron', selected?: FlowId) {
  if (selected !== undefined && !isFlowId(selected)) throw new Error('Automação indisponível.');
  await ensureAutomationSettings();
  const sql = database();
  const companyId = supabaseCompanyId();
  const token = randomUUID();
  const lock = await sql`INSERT INTO site_automation_lock (company_id, token, expires_at) VALUES (${companyId}, ${token}, NOW() + INTERVAL '2 minutes')
    ON CONFLICT (company_id) DO UPDATE SET token=EXCLUDED.token, expires_at=EXCLUDED.expires_at
    WHERE site_automation_lock.expires_at < NOW() RETURNING token`;
  if (!lock.length) return { busy: true, processed: 0, failed: 0 };
  let processed = 0;
  let failed = 0;
  try {
    const leads = await listLeads(10001);
    if (leads.length > 10000) throw new Error('Lote acima do limite seguro.');
    const settings = await sql`SELECT id FROM site_automation_settings WHERE company_id=${companyId} AND active=TRUE`;
    // New-property matching now lives in Supabase opportunities; retain old
    // results for history, but never run a second matching engine.
    const active = automationFlows.filter((flow) => flow.id !== 'new-property' && (!selected || flow.id === selected) && settings.some((setting) => setting.id === flow.id));
    const properties = active.some((flow) => flow.id === 'new-property') ? await listProperties(true) : [];
    // The CRM source of truth is Supabase. Close reminders that no longer match
    // the current lead state without consulting the retired site_leads table.
    const leadStates = leads.map((lead) => ({
      id: lead.id,
      lifecycle_status: lead.lifecycleStatus,
      contact_version: lead.lastContactAt || lead.createdAt,
    }));
    await sql`UPDATE site_automation_results r SET status='cancelled'
      WHERE r.company_id=${companyId} AND r.flow_id='followup' AND r.status='open'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_to_recordset(${JSON.stringify(leadStates)}::jsonb)
          AS current_lead(id UUID, lifecycle_status TEXT, contact_version TEXT)
        WHERE current_lead.id=r.lead_id
          AND current_lead.lifecycle_status IN ('Novo', 'Em atendimento')
          AND r.detail->>'contactVersion'=current_lead.contact_version
      )`;
    for (const flow of active) {
      try {
        const candidates = leads.flatMap((lead) => flow.id === 'new-property' ? newPropertyCandidates(lead, properties) : [evaluateAutomation(flow.id, lead, properties)]).filter((result) => result !== null)
          .map((result) => ({ lead_id: result.leadId, fingerprint: createHash('sha256').update(result.version).digest('hex'), summary: result.summary, detail: result.detail }));
        // Effect, deduplication and success accounting commit together. A pause is
        // rechecked under a row lock, so it also applies to queued executions.
        const rows = await sql`WITH enabled AS (
            SELECT id FROM site_automation_settings WHERE company_id=${companyId} AND id=${flow.id} AND active=TRUE FOR SHARE
          ), owned AS (
            SELECT token FROM site_automation_lock WHERE company_id=${companyId} AND token=${token} AND expires_at > NOW() FOR SHARE
          ), payload AS (
            SELECT p.* FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
              AS p(lead_id UUID, fingerprint TEXT, summary TEXT, detail JSONB), enabled, owned
          ), inserted AS (
            INSERT INTO site_automation_results (company_id,flow_id, lead_id, fingerprint, summary, detail, status)
            SELECT ${companyId}, ${flow.id}, p.lead_id, p.fingerprint, p.summary, p.detail,
              'open' FROM payload p
            ON CONFLICT DO NOTHING RETURNING lead_id, detail
          )
          INSERT INTO site_automation_runs (company_id,flow_id, trigger, status, processed)
          SELECT ${companyId}, ${flow.id}, ${trigger}, 'success', (SELECT count(*) FROM inserted) FROM enabled, owned
          RETURNING processed`;
        processed += Number(rows[0]?.processed || 0);
      } catch {
        failed += 1;
        await sql`INSERT INTO site_automation_runs (company_id,flow_id, trigger, status, message)
          VALUES (${companyId}, ${flow.id}, ${trigger}, 'failed', 'Falha ao processar. Tente novamente; itens já concluídos não serão duplicados.')`;
      }
    }
    return { busy: false, processed, failed };
  } catch (error) {
    await sql`INSERT INTO site_automation_runs (company_id,flow_id, trigger, status, message)
      VALUES (${companyId}, ${selected || 'all'}, ${trigger}, 'failed', 'Não foi possível carregar ou processar a base. Verifique o banco e o limite de 10.000 leads por execução.')`;
    throw error;
  } finally {
    await sql`DELETE FROM site_automation_lock WHERE company_id=${companyId} AND token=${token}`;
  }
}

export async function runAutomationsAfterEvent() {
  try { await runAutomations('event'); }
  catch { console.error('automation_event_failed'); }
}
