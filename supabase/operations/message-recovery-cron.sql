-- Run as database owner after deploying /api/automations/recover.
-- Provision MESSAGE_RECOVERY_SECRET in Vercel and the SAME random secret as
-- imobflow_message_recovery_secret in Supabase Vault first. Never commit its value.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE TABLE IF NOT EXISTS public.message_recovery_scheduler (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 last_tick_at timestamptz, last_request_at timestamptz, last_request_id bigint,
 last_http_status integer, last_success_at timestamptz
);
ALTER TABLE public.message_recovery_scheduler ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_recovery_scheduler FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.message_recovery_scheduler TO service_role;
INSERT INTO public.message_recovery_scheduler(id) VALUES(true) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.dispatch_message_recovery()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE worker_secret text; request_id_value bigint; previous_id bigint; previous_status integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(9212210,1) THEN RETURN; END IF;
 SELECT last_request_id INTO previous_id FROM public.message_recovery_scheduler WHERE id;
 SELECT status_code INTO previous_status FROM net._http_response WHERE id=previous_id;
 UPDATE public.message_recovery_scheduler SET last_tick_at=now(),
 last_http_status=coalesce(previous_status,last_http_status),
 last_success_at=CASE WHEN previous_status=200 THEN coalesce((SELECT created FROM net._http_response WHERE id=previous_id),now()) ELSE last_success_at END WHERE id;
 -- No browser traffic and no daily Vercel cron dependency; no idle HTTP calls.
 IF NOT EXISTS(SELECT 1 FROM public.message_outbox WHERE state='pending' AND next_attempt_at<=now())
 AND NOT EXISTS(SELECT 1 FROM public.message_outbox WHERE state='sending' AND updated_at<now()-interval '2 minutes')
 AND NOT EXISTS(SELECT 1 FROM public.inbound_reply_jobs WHERE state='pending' AND next_attempt_at<=now()) THEN RETURN; END IF;
 SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name='imobflow_message_recovery_secret';
 IF worker_secret IS NULL OR length(worker_secret)<32 THEN RAISE EXCEPTION 'message_recovery_secret_missing'; END IF;
 SELECT net.http_post(
   url:='https://www.imobflow.net.br/api/automations/recover',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret),
   body:='{}'::jsonb,timeout_milliseconds:=55000
 ) INTO request_id_value;
 UPDATE public.message_recovery_scheduler SET last_request_id=request_id_value,last_request_at=now() WHERE id;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_message_recovery() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('imobflow-message-recovery','* * * * *','SELECT public.dispatch_message_recovery()');
COMMIT;
