import { createHash, randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { listLeads, listProperties } from './database';
import { automationFlows, evaluateAutomation, type FlowId } from './automation-rules';

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Banco de dados não configurado.');
  return neon(process.env.DATABASE_URL);
}

// Additive PostgreSQL schema, following the project's existing database bootstrap.
async function ensureSchema() {
  const sql = database();
  await sql`CREATE TABLE IF NOT EXISTS site_automation_settings (id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT TRUE)`;
  await sql`CREATE TABLE IF NOT EXISTS site_automation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), flow_id TEXT NOT NULL, lead_id UUID NOT NULL,
    fingerprint TEXT NOT NULL, summary TEXT NOT NULL, detail JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (flow_id, lead_id, fingerprint))`;
  await sql`CREATE TABLE IF NOT EXISTS site_automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), flow_id TEXT NOT NULL, trigger TEXT NOT NULL,
    status TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0, message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS site_automation_lock (id INTEGER PRIMARY KEY, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
  await sql`INSERT INTO site_automation_settings (id) SELECT jsonb_array_elements_text(${JSON.stringify(automationFlows.map((flow) => flow.id))}::jsonb) ON CONFLICT DO NOTHING`;
}

export async function automationSnapshot() {
  if (!process.env.DATABASE_URL) return { configured: false, schedulerConfigured: false, flows: [], results: [], runs: [] };
  await ensureSchema();
  const sql = database();
  const [settings, counts, results, runs] = await Promise.all([
    sql`SELECT * FROM site_automation_settings`,
    sql`SELECT flow_id, count(*)::int AS total FROM site_automation_results GROUP BY flow_id`,
    sql`SELECT id, flow_id, summary, detail, status, created_at FROM site_automation_results ORDER BY created_at DESC LIMIT 100`,
    sql`SELECT * FROM site_automation_runs ORDER BY created_at DESC LIMIT 40`,
  ]);
  return { configured: true, schedulerConfigured: Boolean(process.env.CRON_SECRET), flows: automationFlows.map((flow) => ({ ...flow, active: settings.find((setting) => setting.id === flow.id)?.active === true, total: Number(counts.find((count) => count.flow_id === flow.id)?.total || 0) })), results, runs };
}

export async function setAutomationActive(id: FlowId, active: boolean) {
  await ensureSchema();
  await database()`UPDATE site_automation_settings SET active=${active} WHERE id=${id}`;
}

export async function completeAutomationResult(id: string) {
  await ensureSchema();
  return database()`UPDATE site_automation_results SET status='done' WHERE id=${id} AND status='open' RETURNING id`;
}

export async function runAutomations(trigger: 'manual' | 'event' | 'cron', selected?: FlowId) {
  await ensureSchema();
  const sql = database();
  const token = randomUUID();
  const lock = await sql`INSERT INTO site_automation_lock (id, token, expires_at) VALUES (1, ${token}, NOW() + INTERVAL '2 minutes')
    ON CONFLICT (id) DO UPDATE SET token=EXCLUDED.token, expires_at=EXCLUDED.expires_at
    WHERE site_automation_lock.expires_at < NOW() RETURNING token`;
  if (!lock.length) return { busy: true, processed: 0, failed: 0 };
  let processed = 0;
  let failed = 0;
  try {
    const leads = await listLeads(10001);
    if (leads.length > 10000) throw new Error('Lote acima do limite seguro.');
    const settings = await sql`SELECT id FROM site_automation_settings WHERE active=TRUE`;
    const active = automationFlows.filter((flow) => (!selected || flow.id === selected) && settings.some((setting) => setting.id === flow.id));
    const properties = active.some((flow) => flow.id === 'recommendations') ? await listProperties(true) : [];
    // Close obsolete reminders after a recorded contact or change of commercial stage.
    await sql`UPDATE site_automation_results r SET status='cancelled' FROM site_leads l
      WHERE r.lead_id=l.id AND r.flow_id='followup' AND r.status='open'
      AND (l.lifecycle_status NOT IN ('Novo', 'Em atendimento') OR
        (r.detail->>'contactVersion')::timestamptz IS DISTINCT FROM COALESCE(l.last_contact_at, l.created_at))`;
    for (const flow of active) {
      try {
        const candidates = leads.map((lead) => evaluateAutomation(flow.id, lead, properties)).filter((result) => result !== null)
          .map((result) => ({ lead_id: result.leadId, fingerprint: createHash('sha256').update(result.version).digest('hex'), summary: result.summary, detail: result.detail }));
        // Effect, deduplication and success accounting commit together. A pause is
        // rechecked under a row lock, so it also applies to queued executions.
        const rows = await sql`WITH enabled AS (
            SELECT id FROM site_automation_settings WHERE id=${flow.id} AND active=TRUE FOR SHARE
          ), owned AS (
            SELECT token FROM site_automation_lock WHERE id=1 AND token=${token} AND expires_at > NOW() FOR SHARE
          ), payload AS (
            SELECT p.* FROM jsonb_to_recordset(${JSON.stringify(candidates)}::jsonb)
              AS p(lead_id UUID, fingerprint TEXT, summary TEXT, detail JSONB), enabled, owned
          ), inserted AS (
            INSERT INTO site_automation_results (flow_id, lead_id, fingerprint, summary, detail, status)
            SELECT ${flow.id}, p.lead_id, p.fingerprint, p.summary, p.detail,
              CASE WHEN ${flow.id}='qualification' THEN 'done' ELSE 'open' END FROM payload p
            ON CONFLICT DO NOTHING RETURNING lead_id, detail
          ), qualified AS (
            UPDATE site_leads l SET summary=i.detail->>'summary', score=(i.detail->>'score')::integer,
              temperature=i.detail->>'temperature', score_reasons=i.detail->'scoreReasons'
            FROM inserted i WHERE l.id=i.lead_id AND ${flow.id}='qualification' RETURNING l.id
          )
          INSERT INTO site_automation_runs (flow_id, trigger, status, processed)
          SELECT ${flow.id}, ${trigger}, 'success', (SELECT count(*) FROM inserted) FROM enabled, owned
          RETURNING processed`;
        processed += Number(rows[0]?.processed || 0);
      } catch {
        failed += 1;
        await sql`INSERT INTO site_automation_runs (flow_id, trigger, status, message)
          VALUES (${flow.id}, ${trigger}, 'failed', 'Falha ao processar. Tente novamente; itens já concluídos não serão duplicados.')`;
      }
    }
    return { busy: false, processed, failed };
  } catch (error) {
    await sql`INSERT INTO site_automation_runs (flow_id, trigger, status, message)
      VALUES (${selected || 'all'}, ${trigger}, 'failed', 'Não foi possível carregar ou processar a base. Verifique o banco e o limite de 10.000 leads por execução.')`;
    throw error;
  } finally {
    await sql`DELETE FROM site_automation_lock WHERE id=1 AND token=${token}`;
  }
}

export async function runAutomationsAfterEvent() {
  try { await runAutomations('event'); }
  catch { console.error('automation_event_failed'); }
}
