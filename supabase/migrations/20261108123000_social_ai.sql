BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.social_messages ADD COLUMN transcript_text text CHECK(length(transcript_text)<=6000);
CREATE TABLE public.social_ai_turns (
 company_id uuid NOT NULL REFERENCES public.companies(id), thread_id uuid NOT NULL, message_id uuid NOT NULL,
 reply text NOT NULL CHECK(length(reply) BETWEEN 1 AND 2000), handoff boolean NOT NULL, profile_after jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,message_id), FOREIGN KEY(company_id,thread_id) REFERENCES public.social_threads(company_id,id)
);
ALTER TABLE public.social_ai_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_ai_turns FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.social_ai_turns TO service_role;
CREATE FUNCTION public.social_ai_profile(p_company_id uuid,p_lead_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('interestProfile',coalesce(interest_profile,'{}'::jsonb),'goal',goal,'region',region,'propertyType',property_type,'budgetMin',budget_min,'budgetMax',budget_max)
 FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id
$$;
CREATE FUNCTION public.prepare_social_ai_turn(p_company_id uuid,p_thread_id uuid,p_message_id uuid,p_patch jsonb,p_reply text,p_handoff boolean,p_expected_profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.social_threads%ROWTYPE; prior public.social_ai_turns%ROWTYPE; profile jsonb; actual jsonb; k text; v jsonb;
BEGIN
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=p_thread_id FOR UPDATE;
 IF NOT FOUND OR t.mode<>'automatic' OR t.last_inbound_message_id IS DISTINCT FROM p_message_id THEN RETURN jsonb_build_object('ready',false); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.social_messages WHERE company_id=p_company_id AND thread_id=p_thread_id AND id=p_message_id AND direction='incoming') THEN RETURN jsonb_build_object('ready',false); END IF;
 IF EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=p_company_id AND document#>>'{settings,ai,automaticMode}'='human') THEN RETURN jsonb_build_object('ready',false); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND id=t.account_id AND enabled) THEN RETURN jsonb_build_object('ready',false); END IF;
 PERFORM 1 FROM public.leads WHERE company_id=p_company_id AND id=t.lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ready',false); END IF;
 actual:=public.social_ai_profile(p_company_id,t.lead_id);
 SELECT * INTO prior FROM public.social_ai_turns WHERE company_id=p_company_id AND message_id=p_message_id;
 IF FOUND THEN
  IF prior.thread_id<>t.id OR actual IS DISTINCT FROM prior.profile_after THEN RETURN jsonb_build_object('ready',false); END IF;
  RETURN jsonb_build_object('ready',true,'reply',prior.reply,'handoff',prior.handoff);
 END IF;
 IF p_expected_profile IS NULL OR actual IS DISTINCT FROM p_expected_profile THEN RETURN jsonb_build_object('ready',false); END IF;
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_reply IS NULL OR length(p_reply) NOT BETWEEN 1 AND 2000 OR p_handoff IS NULL THEN RAISE EXCEPTION 'invalid_social_ai'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_patch) LOOP
  IF k NOT IN ('purpose','propertyType','city','regions','budgetMax','bedrooms','parkingSpaces','features','financingIntent','intendedUse','preferencesRecorded','preferenceNotes','summaryConfirmed','correctionRequested','correctionField') THEN RAISE EXCEPTION 'invalid_social_ai_field'; END IF;
  IF k IN ('regions','features') AND (jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v) z WHERE jsonb_typeof(z)<>'string' OR length(z#>>'{}')>200)) THEN RAISE EXCEPTION 'invalid_social_ai_array'; END IF;
  IF k IN ('budgetMax','bedrooms','parkingSpaces') AND (jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<0 OR (v#>>'{}')::numeric>1000000000) THEN RAISE EXCEPTION 'invalid_social_ai_number'; END IF;
  IF k IN ('preferencesRecorded','summaryConfirmed','correctionRequested') AND jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'invalid_social_ai_boolean'; END IF;
  IF k IN ('city','preferenceNotes','propertyType','purpose','financingIntent','intendedUse') AND (jsonb_typeof(v)<>'string' OR length(v#>>'{}')>500) THEN RAISE EXCEPTION 'invalid_social_ai_text'; END IF;
  IF k='correctionField' AND v<>'null'::jsonb AND (jsonb_typeof(v)<>'string' OR v#>>'{}' NOT IN ('purpose','propertyType','city','regions','budgetMax','bedrooms','parkingSpaces','financingIntent')) THEN RAISE EXCEPTION 'invalid_social_ai_correction'; END IF;
 END LOOP;
 IF p_patch ? 'purpose' AND p_patch->>'purpose' NOT IN ('Venda','Aluguel') THEN RAISE EXCEPTION 'invalid_social_ai_purpose'; END IF;
 SELECT coalesce(interest_profile,'{}'::jsonb)||p_patch INTO profile FROM public.leads WHERE company_id=p_company_id AND id=t.lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ready',false); END IF;
 UPDATE public.leads SET interest_profile=profile,
  goal=CASE WHEN p_patch ? 'purpose' THEN p_patch->>'purpose' ELSE goal END,
  property_type=CASE WHEN p_patch ? 'propertyType' THEN p_patch->>'propertyType' ELSE property_type END,
  region=CASE WHEN p_patch ? 'regions' THEN (SELECT string_agg(x,', ') FROM jsonb_array_elements_text(p_patch->'regions') x) WHEN p_patch ? 'city' THEN p_patch->>'city' ELSE region END,
  budget_max=CASE WHEN p_patch ? 'budgetMax' THEN (p_patch->>'budgetMax')::numeric ELSE budget_max END
 WHERE company_id=p_company_id AND id=t.lead_id;
 INSERT INTO public.social_ai_turns(company_id,thread_id,message_id,reply,handoff,profile_after) VALUES(p_company_id,p_thread_id,p_message_id,p_reply,p_handoff,public.social_ai_profile(p_company_id,t.lead_id));
 RETURN jsonb_build_object('ready',true,'reply',p_reply,'handoff',p_handoff);
END $$;
CREATE FUNCTION public.finish_social_ai_turn(p_company_id uuid,p_thread_id uuid,p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.social_threads t SET mode='human' WHERE t.company_id=p_company_id AND t.id=p_thread_id AND t.mode='automatic' AND t.last_inbound_message_id=p_message_id
 AND EXISTS(SELECT 1 FROM public.social_ai_turns a WHERE a.company_id=t.company_id AND a.thread_id=t.id AND a.message_id=p_message_id AND a.handoff)
 AND EXISTS(SELECT 1 FROM public.social_messages m WHERE m.company_id=t.company_id AND m.thread_id=t.id AND m.reply_to_id=p_message_id AND m.source='ai' AND m.status IN ('sent','failed','unknown'));
END $$;

-- Preparation is not an authorization to overwrite a later manual edit or send
-- after a handoff. Validate the persisted turn again at enqueue and dispatch.
CREATE FUNCTION public.guard_social_ai_dispatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.social_threads%ROWTYPE; turn public.social_ai_turns%ROWTYPE;
BEGIN
 IF NEW.source<>'ai' OR NEW.direction<>'outgoing' OR (TG_OP='UPDATE' AND (NEW.status<>'sending' OR OLD.status='sending')) THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.social_threads WHERE company_id=NEW.company_id AND id=NEW.thread_id;
 SELECT * INTO turn FROM public.social_ai_turns WHERE company_id=NEW.company_id AND thread_id=NEW.thread_id AND message_id=NEW.reply_to_id;
 IF t.id IS NULL OR turn.message_id IS NULL OR t.mode<>'automatic' OR t.last_inbound_message_id IS DISTINCT FROM NEW.reply_to_id OR NEW.content IS DISTINCT FROM turn.reply
  OR public.social_ai_profile(NEW.company_id,t.lead_id) IS DISTINCT FROM turn.profile_after
  OR EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=NEW.company_id AND document#>>'{settings,ai,automaticMode}'='human') THEN RAISE EXCEPTION 'social_handoff'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_ai_dispatch_guard BEFORE INSERT OR UPDATE OF status ON public.social_messages FOR EACH ROW EXECUTE FUNCTION public.guard_social_ai_dispatch();

CREATE TABLE public.social_ai_jobs (
 company_id uuid NOT NULL REFERENCES public.companies(id), thread_id uuid NOT NULL, message_id uuid PRIMARY KEY REFERENCES public.social_messages(id) ON DELETE CASCADE,
 lead_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_id uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), error_code text,
 FOREIGN KEY(company_id,thread_id) REFERENCES public.social_threads(company_id,id), FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id)
);
CREATE INDEX social_ai_jobs_pending ON public.social_ai_jobs(next_attempt_at,created_at) WHERE status IN ('pending','running');
ALTER TABLE public.social_ai_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_ai_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.social_ai_jobs TO service_role;
CREATE POLICY social_ai_jobs_server_only ON public.social_ai_jobs AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE FUNCTION public.schedule_social_ai_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.direction='incoming' AND NEW.status='received' AND NEW.occurred_at>now()-interval '24 hours' THEN
  INSERT INTO public.social_ai_jobs(company_id,thread_id,message_id,lead_id)
  SELECT NEW.company_id,NEW.thread_id,NEW.id,t.lead_id FROM public.social_threads t JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id
   WHERE t.company_id=NEW.company_id AND t.id=NEW.thread_id AND t.mode='automatic' AND a.enabled
   AND NOT EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=t.company_id AND document#>>'{settings,ai,automaticMode}'='human')
  ON CONFLICT(message_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_ai_job_on_incoming AFTER INSERT ON public.social_messages FOR EACH ROW EXECUTE FUNCTION public.schedule_social_ai_job();

CREATE FUNCTION public.claim_social_ai_job(p_lease_id uuid,p_company_id uuid DEFAULT NULL,p_message_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.social_ai_jobs%ROWTYPE;
BEGIN
 IF p_lease_id IS NULL THEN RAISE EXCEPTION 'social_invalid'; END IF;
 WITH exhausted AS (
  UPDATE public.social_ai_jobs SET status='failed',error_code='attempts_exhausted',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE status='running' AND lease_until<clock_timestamp() AND attempts>=3 AND (p_company_id IS NULL OR company_id=p_company_id) AND (p_message_id IS NULL OR message_id=p_message_id)
   RETURNING company_id,thread_id,message_id
 ), cancelled AS (
  UPDATE public.social_messages m SET status=CASE WHEN m.status='sending' THEN 'unknown' ELSE 'failed' END,error_code='ai_recovery_exhausted',error_message='A recuperação automática foi encerrada. Confira a conversa antes de responder.',updated_at=clock_timestamp()
   FROM exhausted e WHERE m.company_id=e.company_id AND m.thread_id=e.thread_id AND m.reply_to_id=e.message_id AND m.source='ai' AND (m.status='pending' OR (m.status='sending' AND m.updated_at<clock_timestamp()-interval '2 minutes')) RETURNING m.id
 ) UPDATE public.social_threads t SET mode='human' FROM exhausted e WHERE t.company_id=e.company_id AND t.id=e.thread_id AND t.mode='automatic' AND t.last_inbound_message_id=e.message_id
  AND NOT EXISTS(SELECT 1 FROM public.social_messages m WHERE m.company_id=t.company_id AND m.thread_id=t.id AND m.status='sending' AND m.updated_at>clock_timestamp()-interval '2 minutes');
 SELECT * INTO j FROM public.social_ai_jobs WHERE attempts<3 AND ((status='pending' AND next_attempt_at<=clock_timestamp()) OR (status='running' AND lease_until<clock_timestamp()))
  AND (p_company_id IS NULL OR company_id=p_company_id) AND (p_message_id IS NULL OR message_id=p_message_id)
  ORDER BY next_attempt_at,created_at,message_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public.social_ai_jobs SET status='running',attempts=attempts+1,lease_id=p_lease_id,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE message_id=j.message_id RETURNING * INTO j;
 RETURN jsonb_build_object('companyId',j.company_id,'threadId',j.thread_id,'leadId',j.lead_id,'messageId',j.message_id,'leaseId',p_lease_id,'attempts',j.attempts);
END $$;
CREATE FUNCTION public.finish_social_ai_job(p_company_id uuid,p_message_id uuid,p_lease_id uuid,p_outcome text,p_error_code text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.social_ai_jobs%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('done','retry','failed') OR p_outcome IS NULL THEN RAISE EXCEPTION 'social_invalid'; END IF;
 SELECT * INTO j FROM public.social_ai_jobs WHERE company_id=p_company_id AND message_id=p_message_id FOR UPDATE;
 IF NOT FOUND OR j.status<>'running' OR j.lease_id IS DISTINCT FROM p_lease_id OR j.lease_until<clock_timestamp() THEN RETURN false; END IF;
 UPDATE public.social_ai_jobs SET status=CASE WHEN p_outcome='done' THEN 'done' WHEN p_outcome='retry' AND attempts<3 THEN 'pending' ELSE 'failed' END,
  next_attempt_at=clock_timestamp()+interval '30 seconds'*attempts,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp(),error_code=left(p_error_code,60)
  WHERE message_id=j.message_id;
 IF p_outcome='done' THEN
  UPDATE public.social_messages SET status='failed',error_code='ai_stale',error_message='O atendimento ou a ficha mudou antes do envio.',updated_at=clock_timestamp()
   WHERE company_id=p_company_id AND thread_id=j.thread_id AND reply_to_id=j.message_id AND source='ai' AND status='pending';
 ELSIF p_outcome='failed' OR j.attempts>=3 THEN
  UPDATE public.social_messages SET status='failed',error_code='ai_recovery_exhausted',error_message='A recuperação automática foi encerrada. Um corretor continuará o atendimento.',updated_at=clock_timestamp()
   WHERE company_id=p_company_id AND thread_id=j.thread_id AND reply_to_id=j.message_id AND source='ai' AND status='pending';
  UPDATE public.social_threads SET mode='human' WHERE company_id=p_company_id AND id=j.thread_id AND mode='automatic' AND last_inbound_message_id=j.message_id
   AND NOT EXISTS(SELECT 1 FROM public.social_messages WHERE company_id=p_company_id AND thread_id=j.thread_id AND status='sending' AND updated_at>clock_timestamp()-interval '2 minutes');
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.social_ai_profile(uuid,uuid),public.prepare_social_ai_turn(uuid,uuid,uuid,jsonb,text,boolean,jsonb),public.finish_social_ai_turn(uuid,uuid,uuid),public.guard_social_ai_dispatch(),public.schedule_social_ai_job(),public.claim_social_ai_job(uuid,uuid,uuid),public.finish_social_ai_job(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_ai_profile(uuid,uuid),public.prepare_social_ai_turn(uuid,uuid,uuid,jsonb,text,boolean,jsonb),public.finish_social_ai_turn(uuid,uuid,uuid),public.claim_social_ai_job(uuid,uuid,uuid),public.finish_social_ai_job(uuid,uuid,uuid,text,text) TO service_role;
-- Extend the existing minute worker only where it was already provisioned.
-- No scheduler, extension or credential is invented by this migration.
DO $install$
BEGIN
 IF to_regprocedure('public.dispatch_message_recovery()') IS NOT NULL THEN
  EXECUTE $function$
   CREATE OR REPLACE FUNCTION public.dispatch_message_recovery()
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
   DECLARE worker_secret text; request_id_value bigint; previous_id bigint; previous_status integer;
   BEGIN
    IF NOT pg_try_advisory_xact_lock(9212210,1) THEN RETURN; END IF;
    SELECT last_request_id INTO previous_id FROM public.message_recovery_scheduler WHERE id;
    SELECT status_code INTO previous_status FROM net._http_response WHERE id=previous_id;
    UPDATE public.message_recovery_scheduler SET last_tick_at=now(),last_http_status=coalesce(previous_status,last_http_status),
     last_success_at=CASE WHEN previous_status=200 THEN coalesce((SELECT created FROM net._http_response WHERE id=previous_id),now()) ELSE last_success_at END WHERE id;
    IF NOT EXISTS(SELECT 1 FROM public.message_outbox WHERE state='pending' AND next_attempt_at<=now())
     AND NOT EXISTS(SELECT 1 FROM public.message_outbox WHERE state='sending' AND updated_at<now()-interval '2 minutes')
     AND NOT EXISTS(SELECT 1 FROM public.inbound_reply_jobs WHERE state='pending' AND next_attempt_at<=now())
     AND NOT EXISTS(SELECT 1 FROM public.social_ai_jobs WHERE (status='pending' AND next_attempt_at<=now()) OR (status='running' AND lease_until<now())) THEN RETURN; END IF;
    SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets WHERE name='imobflow_message_recovery_secret';
    IF worker_secret IS NULL OR length(worker_secret)<32 THEN RAISE EXCEPTION 'message_recovery_secret_missing'; END IF;
    SELECT net.http_post(url:='https://www.imobflow.net.br/api/automations/recover',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret),body:='{}'::jsonb,timeout_milliseconds:=55000) INTO request_id_value;
    UPDATE public.message_recovery_scheduler SET last_request_id=request_id_value,last_request_at=now() WHERE id;
   END $body$;
  $function$;
  REVOKE ALL ON FUNCTION public.dispatch_message_recovery() FROM PUBLIC,anon,authenticated,service_role;
 END IF;
END $install$;
COMMIT;
