-- Read-only metadata. Never return Vault decrypted values or cron/HTTP headers.
-- Run after installing web-push-cron.sql; HTTP success alone is not proof of
-- delivery to a device. Vercel environment readiness is checked separately.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT jobname,active,schedule,
 command='SELECT public.dispatch_web_push_scheduler()' AS expected_target
FROM cron.job WHERE jobname='imobflow-web-push';
SELECT 'imobflow_web_push_scheduler_secret'::text AS secret_name,
 count(*)=1 AS present_once
FROM vault.secrets WHERE name='imobflow_web_push_scheduler_secret';
SELECT last_tick_at,last_request_at,last_http_status,last_http_success_at
FROM public.web_push_scheduler WHERE id;
SELECT to_regprocedure('public.dispatch_web_push_scheduler()') IS NOT NULL AS dispatcher_present,
 has_function_privilege('anon','public.dispatch_web_push_scheduler()','EXECUTE') AS anon_execute,
 has_function_privilege('authenticated','public.dispatch_web_push_scheduler()','EXECUTE') AS authenticated_execute,
 has_function_privilege('service_role','public.dispatch_web_push_scheduler()','EXECUTE') AS service_execute,
 has_table_privilege('anon','public.web_push_scheduler','SELECT') AS anon_metadata_select,
 has_table_privilege('service_role','public.web_push_scheduler','SELECT') AS service_metadata_select;
COMMIT;
