BEGIN;
ALTER TABLE public.message_outbox ADD COLUMN provider_attempted_at timestamptz;
-- An older worker may be in flight during rollout. Its outcome is ambiguous.
UPDATE public.message_outbox SET provider_attempted_at=updated_at WHERE state='sending';
CREATE INDEX message_outbox_global_due ON public.message_outbox(next_attempt_at,id) WHERE state='pending';
CREATE INDEX message_outbox_stale ON public.message_outbox(updated_at) WHERE state='sending';

CREATE FUNCTION public.reset_outbox_provider_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 -- Legacy workers don't implement the attempt protocol: assume they may send.
 IF OLD.state='pending' AND NEW.state='sending' THEN NEW.provider_attempted_at:=now(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reset_outbox_provider_attempt BEFORE UPDATE OF state ON public.message_outbox
FOR EACH ROW EXECUTE FUNCTION public.reset_outbox_provider_attempt();

CREATE FUNCTION public.claim_outbox_message_v2(p_company_id uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.claim_outbox_message(p_company_id,p_id) THEN RETURN false; END IF;
 -- Only v2 workers promise to mark immediately before posting to the provider.
 UPDATE public.message_outbox SET provider_attempted_at=NULL WHERE company_id=p_company_id AND id=p_id AND state='sending';
 RETURN true;
END $$;

CREATE FUNCTION public.mark_outbox_provider_attempt(p_company_id uuid,p_id uuid,p_attempt integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.message_outbox SET provider_attempted_at=now(),updated_at=now()
 WHERE company_id=p_company_id AND id=p_id AND state='sending' AND attempts=p_attempt
 AND provider_attempted_at IS NULL AND updated_at>now()-interval '2 minutes';
 RETURN FOUND;
END $$;

CREATE FUNCTION public.finish_outbox_attempt(p_company_id uuid,p_id uuid,p_attempt integer,p_state text,
 p_error integer DEFAULT NULL,p_provider_id text DEFAULT NULL,p_retry_at timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.message_outbox%ROWTYPE;
BEGIN
 IF p_state IS NULL OR p_state NOT IN ('pending','sent','failed','uncertain') THEN RAISE EXCEPTION 'invalid_outbox_state'; END IF;
 IF p_state='sent' AND (p_provider_id IS NULL OR length(trim(p_provider_id)) NOT BETWEEN 1 AND 500) THEN RAISE EXCEPTION 'receipt_required'; END IF;
 SELECT * INTO o FROM public.message_outbox WHERE company_id=p_company_id AND id=p_id FOR UPDATE;
 IF NOT FOUND OR o.attempts<>p_attempt THEN RETURN false; END IF;
 IF o.state='sent' THEN RETURN p_state='sent' AND EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND id=p_id AND external_message_id=p_provider_id); END IF;
 -- A late confirmed receipt can resolve ambiguity, but cannot restart a send.
 IF o.state<>'sending' AND NOT(o.state='uncertain' AND p_state='sent') THEN RETURN false; END IF;
 IF p_state='pending' AND (o.attempts>=3 OR p_retry_at IS NULL OR p_retry_at<=now()) THEN RAISE EXCEPTION 'invalid_retry'; END IF;
 UPDATE public.messages SET delivery_status=CASE WHEN p_state='sent' THEN 'sent' WHEN p_state='pending' THEN 'pending' ELSE 'failed' END,
 delivery_error_code=p_error,external_message_id=CASE WHEN p_state='sent' THEN p_provider_id ELSE external_message_id END
 WHERE company_id=p_company_id AND id=p_id;
 UPDATE public.message_outbox SET state=p_state,updated_at=now(),next_attempt_at=coalesce(p_retry_at,next_attempt_at)
 WHERE company_id=p_company_id AND id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.recover_stale_outbox(p_company_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.message_outbox%ROWTYPE; recovered integer:=0; target_state text;
BEGIN
 FOR o IN SELECT * FROM public.message_outbox
 WHERE (p_company_id IS NULL OR company_id=p_company_id) AND state='sending' AND updated_at<now()-interval '2 minutes'
 ORDER BY updated_at LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  target_state:=CASE WHEN o.provider_attempted_at IS NOT NULL THEN 'uncertain' WHEN o.attempts<3 THEN 'pending' ELSE 'failed' END;
  UPDATE public.message_outbox SET state=target_state,updated_at=now(),next_attempt_at=now() WHERE company_id=o.company_id AND id=o.id;
  UPDATE public.messages SET delivery_status=CASE WHEN target_state='pending' THEN 'pending' ELSE 'failed' END,delivery_error_code=NULL
  WHERE company_id=o.company_id AND id=o.id AND delivery_status='pending';
  recovered:=recovered+1;
 END LOOP;
 RETURN recovered;
END $$;
REVOKE ALL ON FUNCTION public.reset_outbox_provider_attempt(),public.claim_outbox_message_v2(uuid,uuid),public.mark_outbox_provider_attempt(uuid,uuid,integer),
 public.finish_outbox_attempt(uuid,uuid,integer,text,integer,text,timestamptz),public.recover_stale_outbox(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_message_v2(uuid,uuid),public.mark_outbox_provider_attempt(uuid,uuid,integer),
 public.finish_outbox_attempt(uuid,uuid,integer,text,integer,text,timestamptz),public.recover_stale_outbox(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
