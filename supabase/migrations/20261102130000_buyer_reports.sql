BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.crm_buyer_reports (
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id) ON DELETE CASCADE,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  period_key text NOT NULL CHECK (period_key ~ '^\d{4}-\d{2}(-\d{2})?$'),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL CHECK (jsonb_typeof(report) = 'object'),
  PRIMARY KEY (company_id, frequency, period_key),
  CHECK (period_end > period_start AND generated_at >= period_end)
);
ALTER TABLE public.crm_buyer_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_buyer_reports FROM PUBLIC, anon, authenticated;
-- Admin authentication and tenant scope are enforced by the reports API.
-- The cron only inserts completed periods; snapshots are not overwritten.
GRANT SELECT, INSERT ON public.crm_buyer_reports TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
