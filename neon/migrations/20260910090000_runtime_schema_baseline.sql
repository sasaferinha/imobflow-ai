-- Neon ONLY. Run explicitly before deploying; never from a web request.
-- Baseline for current multi-company schema. Existing older schemas must be
-- reviewed separately; this migration never guesses a tenant or moves data.
BEGIN;
SELECT pg_advisory_xact_lock(735391001);
CREATE TABLE IF NOT EXISTS site_performance_months (
    company_id TEXT NOT NULL,
    month TEXT NOT NULL,
    company_goal NUMERIC(14,2) NOT NULL DEFAULT 0,
    leads_received INTEGER NOT NULL DEFAULT 0,
    converted_leads INTEGER NOT NULL DEFAULT 0,
    recovered_leads INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (company_id, month)
  );

CREATE TABLE IF NOT EXISTS site_broker_goals (
    company_id TEXT NOT NULL,
    month TEXT NOT NULL,
    broker TEXT NOT NULL,
    goal NUMERIC(14,2) NOT NULL DEFAULT 0,
    leads_received INTEGER NOT NULL DEFAULT 0,
    converted_leads INTEGER NOT NULL DEFAULT 0,
    recovered_leads INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, month, broker)
  );

CREATE TABLE IF NOT EXISTS site_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL,
    reference_key TEXT,
    deal_type TEXT NOT NULL DEFAULT 'Venda',
    sale_date DATE NOT NULL,
    broker TEXT NOT NULL,
    property TEXT NOT NULL,
    client TEXT NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

CREATE TABLE IF NOT EXISTS site_automation_settings (company_id TEXT NOT NULL, id TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, PRIMARY KEY(company_id,id));

CREATE TABLE IF NOT EXISTS site_automation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id TEXT NOT NULL, flow_id TEXT NOT NULL, lead_id UUID NOT NULL,
    fingerprint TEXT NOT NULL, summary TEXT NOT NULL, detail JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, flow_id, lead_id, fingerprint));

CREATE TABLE IF NOT EXISTS site_automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_id TEXT NOT NULL, flow_id TEXT NOT NULL, trigger TEXT NOT NULL,
    status TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0, message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE IF NOT EXISTS site_automation_lock (company_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS site_sales_company_reference_key ON site_sales(company_id, reference_key) WHERE reference_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_automation_results_company_unique ON site_automation_results(company_id,flow_id,lead_id,fingerprint);
CREATE INDEX IF NOT EXISTS site_sales_company_date_idx ON site_sales(company_id,sale_date DESC);
CREATE INDEX IF NOT EXISTS site_automation_results_company_created_idx ON site_automation_results(company_id,created_at DESC);

-- Fail closed on a pre-multi-company schema, rather than removing its keys.
DO $$
DECLARE item record; columns text[];
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('site_performance_months',ARRAY['company_id','month']),
    ('site_broker_goals',ARRAY['company_id','month','broker']),
    ('site_automation_settings',ARRAY['company_id','id']),
    ('site_automation_lock',ARRAY['company_id'])
  ) AS expected(table_name,key_columns)
  LOOP
    SELECT array_agg(a.attname::text ORDER BY k.ordinality) INTO columns
    FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.conrelid=to_regclass(item.table_name) AND c.contype='p';
    IF columns IS DISTINCT FROM item.key_columns THEN RAISE EXCEPTION 'Review legacy primary key for % before migrating',item.table_name; END IF;
  END LOOP;
  PERFORM company_id,deal_type FROM site_sales LIMIT 0;
  PERFORM company_id,leads_received,converted_leads,recovered_leads,visits FROM site_broker_goals LIMIT 0;
END; $$;
CREATE TABLE IF NOT EXISTS imobflow_schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO imobflow_schema_migrations(version) VALUES('20260910090000_runtime_schema_baseline') ON CONFLICT DO NOTHING;
COMMIT;
