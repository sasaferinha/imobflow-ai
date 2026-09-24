// Read-only deployment gate. Never executes a migration or reads customer rows.
const requiredTables = {
  broker_name_history: ['id', 'company_id', 'broker_id', 'name'],
  crm_metric_events: ['id', 'company_id', 'lead_id', 'broker_id', 'kind', 'occurred_at'],
  crm_metric_tracking: ['id', 'started_at'],
  property_deals: ['id', 'company_id', 'property_id', 'broker_id', 'lead_id', 'cancelled_at', 'previous_lead_status'],
  cancelled_legacy_sales: ['id', 'company_id', 'legacy_sale_id'],
  leads: ['assigned_broker_id', 'last_deal_id', 'deal_restore_status'], appointments: ['assigned_broker_id'], properties: ['last_deal_id'],
  messages: ['dashboard_hidden_at', 'dashboard_hidden_by'],
  demo_conversation_threads: ['hidden_message_ids'],
  message_outbox: ['property_image', 'depends_on', 'offered_property_id'],
};
const requiredFunctions = ['performance_crm_month', 'record_property_deal', 'cancel_property_deal',
  'update_account_profile', 'hide_dashboard_message', 'hide_demo_dashboard_message', 'enqueue_property_offer', 'claim_outbox_message_v2'];

function schemaProblems(schema) {
  const missing = [];
  for (const [table, columns] of Object.entries(requiredTables)) {
    const properties = schema.definitions?.[table]?.properties;
    if (!properties) { missing.push(table); continue; }
    for (const column of columns) if (!Object.hasOwn(properties, column)) missing.push(`${table}.${column}`);
  }
  for (const name of requiredFunctions) if (!schema.paths?.[`/rpc/${name}`]?.post) missing.push(`rpc/${name}`);
  return missing;
}

async function check({ env = process.env, request = fetch, optional = false } = {}) {
  if (!env.SUPABASE_URL && !env.SUPABASE_SECRET_KEY && optional && !env.VERCEL) return { skipped: true };
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('Banco não configurado: SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios para verificar a publicação.');
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('URL do banco inválida.');
  const response = await request(`${url.origin}/rest/v1/`, {
    headers: { Accept: 'application/openapi+json', apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Não foi possível verificar o schema do banco (HTTP ${response.status}). Publicação interrompida.`);
  const missing = schemaProblems(await response.json());
  if (missing.length) throw new Error(`Banco ainda não atualizado para esta versão. Aplique as migrations 20260924100000 a 20260924130000 e recarregue o schema antes de publicar. Ausentes: ${missing.join(', ')}`);
  return { skipped: false };
}

module.exports = { check, schemaProblems, requiredTables, requiredFunctions };
if (require.main === module) check({ optional: process.argv.includes('--if-configured') }).then(result => {
  console.log(result.skipped ? 'Schema remoto não verificado: ambiente local sem credenciais. A Vercel exigirá a verificação.' : 'PASS schema CRM: tabelas, colunas e funções exigidas disponíveis; consulta somente de metadados.');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
