ALTER FUNCTION public.match_normalize(text) SET search_path=pg_catalog,public;
ALTER FUNCTION public.lead_match_profile(public.leads) SET search_path=pg_catalog,public;
CREATE INDEX IF NOT EXISTS opportunity_reads_notification_fk
  ON public.opportunity_notification_reads(company_id,notification_id);
