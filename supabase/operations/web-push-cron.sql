-- Install only after the web-push schema migrations. This script contains no
-- secret values and creates an INACTIVE job; it never sends an HTTP request.
-- Provision the SAME newly generated key in Vercel WEB_PUSH_SCHEDULER_SECRET
-- and Vault imobflow_web_push_scheduler_secret. Do not read/replace CRON_SECRET.
-- Deploy VAPID keys, VAPID_SUBJECT=https://www.imobflow.net.br,
-- WEB_PUSH_ENABLED=true and WEB_PUSH_SCHEDULER_CONFIGURED=true only once this
-- job is installed. Activate the job only after that deployment is ready.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $requirements$
BEGIN
 IF to_regclass('cron.job') IS NULL OR to_regclass('net._http_response') IS NULL
  OR to_regclass('vault.decrypted_secrets') IS NULL
  OR to_regprocedure('public.list_web_push_candidates(integer,integer)') IS NULL THEN
  RAISE EXCEPTION 'web_push_scheduler_prerequisites_missing';
 END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='imobflow-web-push') THEN
  RAISE EXCEPTION 'web_push_scheduler_already_installed_review_existing_job';
 END IF;
END
$requirements$;

CREATE TABLE public.web_push_scheduler (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 last_tick_at timestamptz,last_request_at timestamptz,last_request_id bigint,
 last_http_status integer,last_http_success_at timestamptz
);
ALTER TABLE public.web_push_scheduler ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_push_scheduler FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.web_push_scheduler TO service_role;
INSERT INTO public.web_push_scheduler(id) VALUES(true);

CREATE FUNCTION public.dispatch_web_push_scheduler()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE worker_secret text; previous_id bigint; previous_at timestamptz; previous_status integer;
 response_found boolean; request_id_value bigint;
BEGIN
 IF NOT pg_try_advisory_xact_lock(9212210,2) THEN RETURN; END IF;
 SELECT last_request_id,last_request_at INTO previous_id,previous_at FROM public.web_push_scheduler WHERE id;
 SELECT status_code INTO previous_status FROM net._http_response WHERE id=previous_id;
 response_found:=FOUND;
 UPDATE public.web_push_scheduler SET last_tick_at=clock_timestamp(),
  last_http_status=CASE WHEN response_found THEN previous_status ELSE last_http_status END,
  last_http_success_at=CASE WHEN previous_status=200 THEN
   coalesce((SELECT created FROM net._http_response WHERE id=previous_id),clock_timestamp()) ELSE last_http_success_at END WHERE id;
 -- The SQL lock ends at commit, before pg_net performs the HTTP request. Keep
 -- a short in-flight guard as well, so repeated ticks cannot stack workers.
 IF previous_id IS NOT NULL AND NOT response_found AND previous_at>clock_timestamp()-interval '75 seconds' THEN RETURN; END IF;
 -- No browser opt-in/eligible waiting contact means no idle HTTP invocation.
 -- SQL prefilters company hours and cooldown; the endpoint rechecks before send.
 IF jsonb_array_length(public.list_web_push_candidates(1,0))=0 THEN RETURN; END IF;
 IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='imobflow_web_push_scheduler_secret')<>1 THEN
  RAISE EXCEPTION 'web_push_scheduler_secret_missing_or_ambiguous';
 END IF;
 SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name='imobflow_web_push_scheduler_secret';
 IF worker_secret IS NULL OR length(worker_secret) NOT BETWEEN 32 AND 256 OR worker_secret !~ '^[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'web_push_scheduler_secret_invalid'; END IF;
 SELECT net.http_get(
  url:='https://www.imobflow.net.br/api/notifications/push/dispatch',
  headers:=jsonb_build_object('Authorization','Bearer '||worker_secret),
  timeout_milliseconds:=55000
 ) INTO request_id_value;
 UPDATE public.web_push_scheduler SET last_request_id=request_id_value,last_request_at=clock_timestamp() WHERE id;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_web_push_scheduler() FROM PUBLIC,anon,authenticated,service_role;

DO $install$
DECLARE job_id bigint;
BEGIN
 SELECT cron.schedule('imobflow-web-push','* * * * *','SELECT public.dispatch_web_push_scheduler()') INTO job_id;
 PERFORM cron.alter_job(job_id,active:=false);
END
$install$;
COMMIT;

-- After deployment and metadata verification, the database owner may activate
-- the known job with cron.alter_job(job_id, active:=true). Do not run the
-- dispatcher manually against customers as a test. Existing device consent,
-- session validity, tenant hours and persisted cooldown remain mandatory.
-- pg_net briefly stores HTTP headers in its request queue: monitoring must
-- project only request IDs/statuses and never return that queue's headers.
