-- MANUAL operation, after the jobs migration and /api/media-studio/recover
-- deployment. Installs an INACTIVE job and performs no HTTP/provider request.
-- Reuses the existing MESSAGE_RECOVERY_SECRET / Vault
-- imobflow_message_recovery_secret pair. Never create/rotate that shared secret
-- here: the WhatsApp worker continues using it unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $requirements$
DECLARE maximum_timeout text; worker_secret text;
BEGIN
  IF to_regclass('cron.job') IS NULL OR to_regclass('net._http_response') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL OR to_regclass('public.media_ai_jobs') IS NULL
    OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
    OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
  THEN RAISE EXCEPTION 'media_ai_scheduler_prerequisites_missing'; END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'imobflow-media-ai-recovery') THEN
    RAISE EXCEPTION 'media_ai_scheduler_already_installed_review_existing_job';
  END IF;
  -- New pg_net versions bound request timeout with this setting; older
  -- versions expose the integer argument without the additional setting.
  maximum_timeout := nullif(current_setting('pg_net.max_timeout_ms', true), '');
  IF maximum_timeout IS NOT NULL THEN
    IF maximum_timeout !~ '^[0-9]+$' OR maximum_timeout::numeric < 170000 THEN
      RAISE EXCEPTION 'media_ai_scheduler_timeout_unavailable';
    END IF;
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'imobflow_message_recovery_secret') <> 1 THEN
    RAISE EXCEPTION 'media_ai_scheduler_secret_missing_or_ambiguous';
  END IF;
  SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name = 'imobflow_message_recovery_secret';
  IF worker_secret IS NULL OR length(worker_secret) NOT BETWEEN 32 AND 512 OR worker_secret ~ '[[:cntrl:][:space:]]' THEN
    RAISE EXCEPTION 'media_ai_scheduler_secret_invalid';
  END IF;
END
$requirements$;

CREATE TABLE public.media_ai_scheduler (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_tick_at timestamptz,
  last_request_at timestamptz,
  last_request_id bigint,
  last_http_status integer,
  last_success_at timestamptz,
  last_result text CHECK (last_result IN ('idle', 'dispatched', 'awaiting_response', 'http_success', 'http_failed'))
);
ALTER TABLE public.media_ai_scheduler ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_ai_scheduler FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_ai_scheduler FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.media_ai_scheduler TO service_role;
CREATE POLICY media_ai_scheduler_browser_denied ON public.media_ai_scheduler AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
INSERT INTO public.media_ai_scheduler(id) VALUES(true);

CREATE FUNCTION public.dispatch_media_ai_recovery()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  worker_secret text;
  previous_id bigint;
  previous_at timestamptz;
  previous_status integer;
  previous_response_at timestamptz;
  response_found boolean;
  request_id_value bigint;
BEGIN
  -- Dedicated key: message recovery uses (9212210,1), browser push uses (...,2).
  IF NOT pg_try_advisory_xact_lock(9212210,3) THEN RETURN; END IF;
  SELECT last_request_id,last_request_at INTO previous_id,previous_at FROM public.media_ai_scheduler WHERE id FOR UPDATE;
  SELECT status_code,created INTO previous_status,previous_response_at FROM net._http_response WHERE id = previous_id;
  response_found := FOUND;
  UPDATE public.media_ai_scheduler SET last_tick_at = clock_timestamp(),
    last_http_status = CASE WHEN response_found THEN previous_status ELSE last_http_status END,
    last_success_at = CASE WHEN previous_status = 200 THEN coalesce(previous_response_at,clock_timestamp()) ELSE last_success_at END,
    last_result = CASE WHEN response_found THEN CASE WHEN previous_status = 200 THEN 'http_success' ELSE 'http_failed' END ELSE last_result END
    WHERE id;
  -- The SQL lock ends before pg_net runs HTTP. Do not stack another worker
  -- while that request is outstanding, including a transport timeout response.
  IF previous_id IS NOT NULL AND previous_at > clock_timestamp() - interval '180 seconds'
    AND (NOT response_found OR previous_status IS NULL) THEN
    UPDATE public.media_ai_scheduler SET last_result = 'awaiting_response' WHERE id;
    RETURN;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.media_ai_jobs WHERE status = 'processing' AND kind = 'video' AND provider = 'runway'
      AND provider_task_id IS NOT NULL AND poll_after <= clock_timestamp() AND expires_at > clock_timestamp() AND purged_at IS NULL) THEN
    UPDATE public.media_ai_scheduler SET last_result = 'idle' WHERE id;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'imobflow_message_recovery_secret') <> 1 THEN
    RAISE EXCEPTION 'media_ai_scheduler_secret_missing_or_ambiguous';
  END IF;
  SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name = 'imobflow_message_recovery_secret';
  IF worker_secret IS NULL OR length(worker_secret) NOT BETWEEN 32 AND 512 OR worker_secret ~ '[[:cntrl:][:space:]]' THEN
    RAISE EXCEPTION 'media_ai_scheduler_secret_invalid';
  END IF;
  SELECT net.http_post(
    url := 'https://www.imobflow.net.br/api/media-studio/recover',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || worker_secret),
    timeout_milliseconds := 170000
  ) INTO request_id_value;
  UPDATE public.media_ai_scheduler SET last_request_id = request_id_value,
    last_request_at = clock_timestamp(), last_result = 'dispatched' WHERE id;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_media_ai_recovery() FROM PUBLIC, anon, authenticated, service_role;

DO $install$
DECLARE job_id bigint;
BEGIN
  SELECT cron.schedule('imobflow-media-ai-recovery','*/2 * * * *','SELECT public.dispatch_media_ai_recovery()') INTO job_id;
  PERFORM cron.alter_job(job_id,active := false);
END
$install$;
COMMIT;

-- After verifying the deployed endpoint and the SAME secret on both sides,
-- the database owner can activate only imobflow-media-ai-recovery with
-- cron.alter_job(job_id,active := true). No existing schedule is changed.
-- Observe only cron job metadata and media_ai_scheduler: pg_net's transient
-- request queue contains Authorization headers and must not be printed.
