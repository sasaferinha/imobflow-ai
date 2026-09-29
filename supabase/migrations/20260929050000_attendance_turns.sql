BEGIN;
SET LOCAL lock_timeout = '5s';

-- Provider timestamps have second precision and can arrive late. This sequence
-- identifies persisted arrivals without treating two messages in one second as one.
ALTER TABLE public.inbound_reply_jobs ADD COLUMN arrival_sequence bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.inbound_reply_jobs ADD COLUMN received_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE UNIQUE INDEX inbound_reply_jobs_arrival_sequence ON public.inbound_reply_jobs(arrival_sequence);
CREATE INDEX inbound_reply_jobs_conversation_turn ON public.inbound_reply_jobs(company_id,conversation_id,arrival_sequence);
CREATE TABLE public.attendance_turns (
  company_id uuid NOT NULL, conversation_id uuid NOT NULL,
  token uuid, watermark bigint, claimed_at timestamptz, lease_until timestamptz,
  PRIMARY KEY(company_id,conversation_id),
  FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.attendance_turns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_turns FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.message_outbox ADD COLUMN attendance_watermark bigint;
ALTER TABLE public.message_outbox ADD COLUMN attendance_handoff boolean NOT NULL DEFAULT false;
ALTER TABLE public.message_outbox ADD COLUMN attendance_handoff_reconciled boolean NOT NULL DEFAULT false;
CREATE INDEX attendance_handoffs_to_reconcile ON public.message_outbox(updated_at,id) INCLUDE(company_id,conversation_id)
  WHERE attendance_handoff AND NOT attendance_handoff_reconciled AND state IN ('sent','uncertain','failed');

-- Bot-only completion, kept separate from the shared/manual outbox protocol.
-- A crash between provider persistence and this step is repaired by the next
-- inbound turn or recovery worker, without sending the handoff twice.
CREATE FUNCTION public.reconcile_attendance_handoffs(p_company_id uuid DEFAULT NULL,p_conversation_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate record; c public.conversations%ROWTYPE; o public.message_outbox%ROWTYPE; reconciled integer:=0;
BEGIN
  FOR candidate IN SELECT company_id,conversation_id,id FROM public.message_outbox
    WHERE attendance_handoff AND NOT attendance_handoff_reconciled AND state IN ('sent','uncertain','failed')
      AND (p_company_id IS NULL OR company_id=p_company_id) AND (p_conversation_id IS NULL OR conversation_id=p_conversation_id)
    ORDER BY updated_at,id LIMIT 50 LOOP
    SELECT * INTO c FROM public.conversations WHERE company_id=candidate.company_id AND id=candidate.conversation_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO o FROM public.message_outbox WHERE company_id=candidate.company_id AND id=candidate.id
      AND attendance_handoff AND NOT attendance_handoff_reconciled AND state IN ('sent','uncertain','failed') FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF coalesce(c.assigned_to,'')='' AND c.assigned_broker_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.messages h JOIN public.messages handoff ON handoff.company_id=h.company_id AND handoff.id=o.id
        WHERE h.company_id=c.company_id AND h.conversation_id=c.id AND h.sender_type='human' AND h.created_at>=handoff.created_at) THEN
      UPDATE public.conversations SET bot_paused=true WHERE company_id=c.company_id AND id=c.id;
    END IF;
    UPDATE public.message_outbox SET attendance_handoff_reconciled=true WHERE company_id=o.company_id AND id=o.id;
    reconciled:=reconciled+1;
  END LOOP;
  RETURN reconciled;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_attendance_handoffs(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_attendance_handoffs(uuid,uuid) TO service_role;

-- Manual ownership/release wins over late bot reconciliation. This trigger
-- writes only the new handoff bookkeeping flag: never ownership, pause state,
-- message content, delivery state or the shared outbox retry protocol.
CREATE FUNCTION public.dismiss_attendance_handoff_on_manual_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.assigned_broker_id IS DISTINCT FROM NEW.assigned_broker_id
    OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to OR (OLD.bot_paused AND NOT NEW.bot_paused) THEN
    UPDATE public.message_outbox SET attendance_handoff_reconciled=true
      WHERE company_id=NEW.company_id AND conversation_id=NEW.id AND attendance_handoff AND NOT attendance_handoff_reconciled;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dismiss_attendance_handoff_on_manual_change
AFTER UPDATE OF assigned_broker_id,assigned_to,bot_paused ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.dismiss_attendance_handoff_on_manual_change();
REVOKE ALL ON FUNCTION public.dismiss_attendance_handoff_on_manual_change() FROM PUBLIC,anon,authenticated,service_role;

-- A completed targeted correction must clear its target; other explicit nulls
-- retain the established "do not overwrite known preferences" behavior.
CREATE OR REPLACE FUNCTION public.merge_attendance_profile(p_company_id uuid,p_lead_id uuid,p_version timestamptz,p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.leads%ROWTYPE; q jsonb;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  SELECT * INTO l FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id FOR UPDATE;
  IF NOT FOUND OR l.updated_at IS DISTINCT FROM p_version THEN RETURN false; END IF;
  q:=l.interest_profile||jsonb_strip_nulls(p_profile);
  IF p_profile ? 'correctionField' AND p_profile->'correctionField'='null'::jsonb THEN q:=q-'correctionField'; END IF;
  UPDATE public.leads SET interest_profile=q,updated_at=clock_timestamp(),
    goal=CASE p_profile->>'purpose' WHEN 'Venda' THEN 'Comprar' WHEN 'Aluguel' THEN 'Alugar' ELSE goal END,
    property_type=coalesce(nullif(p_profile->>'propertyType',''),property_type),
    region=CASE WHEN jsonb_array_length(coalesce(p_profile->'regions','[]'))>0 THEN (SELECT string_agg(value,', ') FROM jsonb_array_elements_text(p_profile->'regions')) ELSE region END,
    budget_max=coalesce((p_profile->>'budgetMax')::numeric,budget_max)
    WHERE company_id=p_company_id AND id=p_lead_id;
  RETURN true;
END $$;

CREATE FUNCTION public.claim_attendance_turn(p_company_id uuid,p_conversation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.conversations%ROWTYPE; t public.attendance_turns%ROWTYPE;
  latest_sequence bigint; latest_received timestamptz; latest_occurred timestamptz;
  first_occurred timestamptz; pending_count integer; items jsonb; nonce uuid; last_reply text;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','ignored'); END IF;
  PERFORM public.reconcile_attendance_handoffs(p_company_id,p_conversation_id);
  SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=p_conversation_id;
  IF c.bot_paused OR coalesce(c.assigned_to,'')<>'' OR c.status NOT IN ('open','Aberta')
    OR EXISTS(SELECT 1 FROM public.leads WHERE company_id=c.company_id AND id=c.lead_id AND lifecycle_status IN ('Convertido','Perdido')) THEN
    UPDATE public.inbound_reply_jobs SET state='cancelled' WHERE company_id=c.company_id AND conversation_id=c.id AND state='pending';
    RETURN jsonb_build_object('status','ignored');
  END IF;
  -- Existing legacy replies remain idempotent during a rolling deployment.
  UPDATE public.inbound_reply_jobs j SET state='done' FROM public.messages m
  WHERE j.company_id=c.company_id AND j.conversation_id=c.id AND j.state='pending'
    AND m.company_id=j.company_id AND m.id=j.message_id
    AND (EXISTS(SELECT 1 FROM public.message_outbox o WHERE o.company_id=j.company_id
      AND o.request_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id))
      OR EXISTS(SELECT 1 FROM public.attendance_replies a WHERE a.company_id=j.company_id
        AND a.dedup_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id) AND a.state='accepted'));
  UPDATE public.inbound_reply_jobs j SET state='cancelled' FROM public.messages m
  WHERE j.company_id=c.company_id AND j.conversation_id=c.id AND j.state='pending'
    AND m.company_id=j.company_id AND m.id=j.message_id
    AND (m.created_at<=now()-interval '24 hours' OR m.created_at>now()+interval '5 minutes'
      OR EXISTS(SELECT 1 FROM public.messages h WHERE h.company_id=c.company_id AND h.conversation_id=c.id
        AND h.sender_type='human' AND h.created_at>=m.created_at));
  SELECT count(*),max(j.arrival_sequence),max(j.received_at),max(m.created_at),min(m.created_at)
    INTO pending_count,latest_sequence,latest_received,latest_occurred,first_occurred
  FROM public.inbound_reply_jobs j JOIN public.messages m ON m.company_id=j.company_id AND m.id=j.message_id
  WHERE j.company_id=c.company_id AND j.conversation_id=c.id AND j.state='pending';
  IF pending_count=0 THEN RETURN jsonb_build_object('status','ignored'); END IF;
  -- Once queued, a human handoff must not be erased by further typing or race
  -- another automatic response while its bounded delivery retries are pending.
  IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=c.company_id AND conversation_id=c.id
    AND attendance_handoff AND (state IN ('pending','sending')
      OR (state IN ('sent','uncertain','failed') AND NOT attendance_handoff_reconciled))) THEN
    RETURN jsonb_build_object('status','deferred','retryAfterMs',3000);
  END IF;
  -- Cancelled/legacy-completed newer arrivals still belong to the same fence,
  -- otherwise an older valid pending message would be superseded forever.
  SELECT max(arrival_sequence) INTO latest_sequence FROM public.inbound_reply_jobs
    WHERE company_id=c.company_id AND conversation_id=c.id;
  IF EXISTS(SELECT 1 FROM public.messages WHERE company_id=c.company_id AND conversation_id=c.id
    AND sender_type='human' AND created_at>=first_occurred) THEN
    UPDATE public.inbound_reply_jobs SET state='cancelled' WHERE company_id=c.company_id AND conversation_id=c.id AND state='pending';
    RETURN jsonb_build_object('status','ignored');
  END IF;
  IF latest_received>clock_timestamp()-interval '3 seconds' THEN
    RETURN jsonb_build_object('status','deferred','retryAfterMs',greatest(50,ceil(extract(epoch FROM latest_received+interval '3 seconds'-clock_timestamp())*1000)));
  END IF;
  -- A pre-deploy worker may still own a per-message reservation. Let it finish;
  -- after its old lease window, fence its enqueue by invalidating that reservation.
  UPDATE public.attendance_replies SET state='uncertain'
    WHERE company_id=c.company_id AND conversation_id=c.id AND state='reserved'
      AND dedup_key NOT LIKE 'turn:%' AND created_at<=now()-interval '2 minutes';
  IF EXISTS(SELECT 1 FROM public.attendance_replies a WHERE a.company_id=c.company_id AND a.conversation_id=c.id
    AND a.state='reserved' AND a.dedup_key NOT LIKE 'turn:%'
    AND NOT EXISTS(SELECT 1 FROM public.message_outbox o WHERE o.company_id=a.company_id AND o.request_key=a.dedup_key)) THEN
    RETURN jsonb_build_object('status','deferred','retryAfterMs',3000);
  END IF;
  INSERT INTO public.attendance_turns(company_id,conversation_id) VALUES(c.company_id,c.id) ON CONFLICT DO NOTHING;
  SELECT * INTO t FROM public.attendance_turns WHERE company_id=c.company_id AND conversation_id=c.id FOR UPDATE;
  IF t.token IS NOT NULL AND t.lease_until>clock_timestamp() THEN
    RETURN jsonb_build_object('status','deferred','retryAfterMs',3000);
  END IF;
  -- Do not race a Meta POST that another worker has already begun.
  IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=c.company_id AND conversation_id=c.id
    AND state='sending' AND provider_attempted_at IS NOT NULL AND updated_at>now()-interval '2 minutes') THEN
    RETURN jsonb_build_object('status','deferred','retryAfterMs',3000);
  END IF;
  nonce:=gen_random_uuid();
  UPDATE public.attendance_turns SET token=nonce,watermark=latest_sequence,claimed_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
    WHERE company_id=c.company_id AND conversation_id=c.id;
  SELECT jsonb_agg(jsonb_build_object('externalMessageId',external_message_id,'message',content,
    'hasImage',content LIKE '%[Imagem%' OR content LIKE '%[Foto%', 'hasAudio',content LIKE '%[Áudio%',
    'occurredAt',created_at) ORDER BY arrival_sequence) INTO items
  FROM (SELECT m.external_message_id,m.content,m.created_at,j.arrival_sequence
    FROM public.inbound_reply_jobs j JOIN public.messages m ON m.company_id=j.company_id AND m.id=j.message_id
    WHERE j.company_id=c.company_id AND j.conversation_id=c.id AND j.state='pending'
      AND j.arrival_sequence<=latest_sequence ORDER BY j.arrival_sequence LIMIT 40) pending;
  -- Do not skip a newer unsent/cancelled bubble to find an older summary. Only
  -- the latest outgoing message is eligible to establish what the user saw.
  SELECT CASE WHEN delivery_status IN ('sent','delivered','read') THEN content ELSE NULL END INTO last_reply
    FROM public.messages WHERE company_id=c.company_id AND conversation_id=c.id AND direction='outgoing'
    ORDER BY created_at DESC,id DESC LIMIT 1;
  RETURN jsonb_build_object('status','claimed','token',nonce,'watermark',latest_sequence,
    'key','turn:'||nonce,'latestOccurredAt',latest_occurred,'lastReply',last_reply,'messages',items,'overflow',pending_count>40);
END $$;

CREATE FUNCTION public.release_attendance_turn(p_company_id uuid,p_conversation_id uuid,p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Match the conversation lock order used by receive/enqueue/claim functions.
  PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND id=p_conversation_id FOR UPDATE;
  UPDATE public.attendance_turns SET token=NULL,lease_until=NULL
    WHERE company_id=p_company_id AND conversation_id=p_conversation_id AND token=p_token;
END $$;

CREATE FUNCTION public.enqueue_attendance_turn(p_company_id uuid,p_conversation_id uuid,p_token uuid,p_watermark bigint,
  p_content text,p_profile jsonb DEFAULT '{}'::jsonb,p_profile_version timestamptz DEFAULT NULL,p_handoff boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.conversations%ROWTYPE; t public.attendance_turns%ROWTYPE; message_id uuid;
  latest_sequence bigint; duplicate_content boolean; turn_key text;
BEGIN
  IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 4000
    OR jsonb_typeof(p_profile) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_turn'; END IF;
  SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','cancelled'); END IF;
  turn_key:='turn:'||p_token;
  SELECT id INTO message_id FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=p_conversation_id AND request_key=turn_key;
  IF FOUND THEN RETURN jsonb_build_object('status','queued','messageId',message_id); END IF;
  SELECT * INTO t FROM public.attendance_turns WHERE company_id=c.company_id AND conversation_id=c.id FOR UPDATE;
  IF NOT FOUND OR t.token IS DISTINCT FROM p_token OR t.watermark IS DISTINCT FROM p_watermark
    OR t.lease_until<=clock_timestamp() THEN RETURN jsonb_build_object('status','superseded'); END IF;
  IF c.bot_paused OR coalesce(c.assigned_to,'')<>'' OR c.status NOT IN ('open','Aberta')
    OR EXISTS(SELECT 1 FROM public.leads WHERE company_id=c.company_id AND id=c.lead_id AND lifecycle_status IN ('Convertido','Perdido'))
    OR EXISTS(SELECT 1 FROM public.messages WHERE company_id=c.company_id AND conversation_id=c.id
      AND sender_type='human' AND created_at>=t.claimed_at) THEN
    PERFORM public.release_attendance_turn(c.company_id,c.id,p_token);
    RETURN jsonb_build_object('status','cancelled');
  END IF;
  SELECT max(arrival_sequence) INTO latest_sequence FROM public.inbound_reply_jobs WHERE company_id=c.company_id AND conversation_id=c.id;
  IF latest_sequence IS DISTINCT FROM p_watermark THEN
    PERFORM public.release_attendance_turn(c.company_id,c.id,p_token);
    RETURN jsonb_build_object('status','superseded');
  END IF;
  -- A legacy worker can claim a fragment after this turn was claimed. Fence
  -- that rolling-deploy race before committing any profile or outgoing text.
  IF EXISTS(SELECT 1 FROM public.inbound_reply_jobs j JOIN public.messages m ON m.company_id=j.company_id AND m.id=j.message_id
    JOIN public.attendance_replies a ON a.company_id=j.company_id AND a.dedup_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id)
    WHERE j.company_id=c.company_id AND j.conversation_id=c.id AND j.state='pending' AND j.arrival_sequence<=p_watermark
      AND a.state IN ('reserved','accepted')) THEN
    PERFORM public.release_attendance_turn(c.company_id,c.id,p_token);
    RETURN jsonb_build_object('status','superseded');
  END IF;
  IF p_profile_version IS NOT NULL THEN
    PERFORM 1 FROM public.leads WHERE company_id=c.company_id AND id=c.lead_id AND updated_at=p_profile_version FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM public.release_attendance_turn(c.company_id,c.id,p_token);
      RETURN jsonb_build_object('status','superseded');
    END IF;
  END IF;
  IF p_profile<>'{}'::jsonb AND NOT public.merge_attendance_profile(c.company_id,c.lead_id,p_profile_version,p_profile) THEN
    PERFORM public.release_attendance_turn(c.company_id,c.id,p_token);
    RETURN jsonb_build_object('status','superseded');
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.messages m JOIN public.message_outbox o ON o.company_id=m.company_id AND o.id=m.id
    WHERE m.company_id=c.company_id AND m.conversation_id=c.id AND m.sender_type='ai'
      AND m.created_at>now()-interval '45 seconds'
      AND (o.state IN ('sent','uncertain') OR (o.state='sending' AND o.provider_attempted_at IS NOT NULL)
        OR (o.state='pending' AND o.attendance_watermark IS NULL))
      AND lower(regexp_replace(trim(m.content),'\s+',' ','g'))=lower(regexp_replace(trim(p_content),'\s+',' ','g')))
    INTO duplicate_content;
  IF NOT duplicate_content THEN
    INSERT INTO public.attendance_replies(company_id,conversation_id,dedup_key)
      VALUES(c.company_id,c.id,turn_key) ON CONFLICT DO NOTHING;
    message_id:=public.enqueue_conversation_message(c.company_id,c.id,turn_key,p_content,NULL);
    UPDATE public.message_outbox SET attendance_watermark=p_watermark,attendance_handoff=p_handoff WHERE company_id=c.company_id AND id=message_id;
  END IF;
  -- Mark both legacy key variants consumed before releasing the conversation
  -- lock, preventing a pre-deploy callback from replying after this turn commits.
  INSERT INTO public.attendance_replies(company_id,conversation_id,dedup_key,state)
    SELECT j.company_id,j.conversation_id,prefix||m.external_message_id,'accepted'
    FROM public.inbound_reply_jobs j JOIN public.messages m ON m.company_id=j.company_id AND m.id=j.message_id
    CROSS JOIN (VALUES ('reply:'),('handoff:')) variants(prefix)
    WHERE j.company_id=c.company_id AND j.conversation_id=c.id AND j.state='pending' AND j.arrival_sequence<=p_watermark
    ON CONFLICT DO NOTHING;
  UPDATE public.inbound_reply_jobs SET state='done' WHERE company_id=c.company_id AND conversation_id=c.id
    AND state='pending' AND arrival_sequence<=p_watermark;
  PERFORM public.release_attendance_turn(c.company_id,c.id,p_token);
  IF duplicate_content THEN
    IF p_handoff THEN UPDATE public.conversations SET bot_paused=true WHERE company_id=c.company_id AND id=c.id; END IF;
    RETURN jsonb_build_object('status','suppressed');
  END IF;
  RETURN jsonb_build_object('status','queued','messageId',message_id);
END $$;

-- Last possible local guard, immediately before sending the provider request.
-- Manual/legacy messages retain their existing attempt protocol unchanged.
CREATE OR REPLACE FUNCTION public.mark_outbox_provider_attempt(p_company_id uuid,p_id uuid,p_attempt integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.message_outbox%ROWTYPE; c public.conversations%ROWTYPE; latest_sequence bigint;
BEGIN
  SELECT * INTO o FROM public.message_outbox WHERE company_id=p_company_id AND id=p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=o.conversation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO o FROM public.message_outbox WHERE company_id=p_company_id AND id=p_id FOR UPDATE;
  IF o.state<>'sending' OR o.attempts<>p_attempt OR o.provider_attempted_at IS NOT NULL
    OR o.updated_at<=now()-interval '2 minutes' THEN RETURN false; END IF;
  IF o.attendance_watermark IS NOT NULL THEN
    SELECT max(arrival_sequence) INTO latest_sequence FROM public.inbound_reply_jobs
      WHERE company_id=c.company_id AND conversation_id=c.id;
    IF (latest_sequence IS DISTINCT FROM o.attendance_watermark AND NOT o.attendance_handoff) OR c.bot_paused OR coalesce(c.assigned_to,'')<>''
      OR c.status NOT IN ('open','Aberta')
      OR EXISTS(SELECT 1 FROM public.leads WHERE company_id=c.company_id AND id=c.lead_id AND lifecycle_status IN ('Convertido','Perdido'))
      OR EXISTS(SELECT 1 FROM public.messages h JOIN public.messages original ON original.company_id=h.company_id AND original.id=o.id
        WHERE h.company_id=c.company_id AND h.conversation_id=c.id AND h.sender_type='human' AND h.created_at>=original.created_at) THEN
      UPDATE public.message_outbox SET state='cancelled',updated_at=now() WHERE company_id=p_company_id AND id=p_id;
      UPDATE public.messages SET delivery_status='failed',delivery_error_code=-29001 WHERE company_id=p_company_id AND id=p_id;
      RETURN false;
    END IF;
  END IF;
  UPDATE public.message_outbox SET provider_attempted_at=now(),updated_at=now()
    WHERE company_id=p_company_id AND id=p_id;
  RETURN true;
END $$;

-- Keep the public worker contract, but recover a conversation turn, not one
-- superseded fragment. All still-pending fragments are retained for the claim.
CREATE OR REPLACE FUNCTION public.claim_missing_inbound_reply() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate record; j public.inbound_reply_jobs%ROWTYPE; m public.messages%ROWTYPE; c public.conversations%ROWTYPE;
BEGIN
  FOR candidate IN SELECT company_id,conversation_id,min(next_attempt_at) due FROM public.inbound_reply_jobs
    WHERE state='pending' AND next_attempt_at<=now() GROUP BY company_id,conversation_id ORDER BY due LIMIT 50 LOOP
    SELECT * INTO c FROM public.conversations WHERE company_id=candidate.company_id AND id=candidate.conversation_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.inbound_reply_jobs WHERE company_id=c.company_id AND conversation_id=c.id
      AND state='pending' AND next_attempt_at<=now()) THEN CONTINUE; END IF;
    UPDATE public.inbound_reply_jobs job SET state='done' FROM public.messages msg
      WHERE job.company_id=c.company_id AND job.conversation_id=c.id AND job.state='pending'
      AND msg.company_id=job.company_id AND msg.id=job.message_id
      AND EXISTS(SELECT 1 FROM public.message_outbox o WHERE o.company_id=job.company_id
        AND o.request_key IN ('reply:'||msg.external_message_id,'handoff:'||msg.external_message_id));
    -- Reject expired/future/pre-human fragments individually, retaining other
    -- valid pending input even when the invalid fragment arrived more recently.
    UPDATE public.inbound_reply_jobs job SET state='cancelled' FROM public.messages msg
      WHERE job.company_id=c.company_id AND job.conversation_id=c.id AND job.state='pending'
        AND msg.company_id=job.company_id AND msg.id=job.message_id
        AND (msg.created_at<=now()-interval '24 hours' OR msg.created_at>now()+interval '5 minutes'
          OR EXISTS(SELECT 1 FROM public.messages h WHERE h.company_id=c.company_id AND h.conversation_id=c.id
            AND h.sender_type='human' AND h.created_at>=msg.created_at));
    SELECT * INTO j FROM public.inbound_reply_jobs WHERE company_id=c.company_id AND conversation_id=c.id
      AND state='pending' ORDER BY arrival_sequence DESC LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO m FROM public.messages WHERE company_id=j.company_id AND id=j.message_id;
    IF c.bot_paused OR coalesce(c.assigned_to,'')<>'' OR c.status NOT IN ('open','Aberta')
      OR m.created_at<=now()-interval '24 hours' OR m.created_at>now()+interval '5 minutes'
      OR EXISTS(SELECT 1 FROM public.leads WHERE company_id=c.company_id AND id=c.lead_id AND lifecycle_status IN ('Convertido','Perdido'))
      OR EXISTS(SELECT 1 FROM public.messages WHERE company_id=c.company_id AND conversation_id=c.id AND sender_type='human' AND created_at>=m.created_at) THEN
      UPDATE public.inbound_reply_jobs SET state='cancelled' WHERE company_id=c.company_id AND conversation_id=c.id AND state='pending'; CONTINUE;
    END IF;
    IF EXISTS(SELECT 1 FROM public.attendance_turns WHERE company_id=c.company_id AND conversation_id=c.id AND token IS NOT NULL AND lease_until>clock_timestamp()) THEN
      UPDATE public.inbound_reply_jobs SET next_attempt_at=now()+interval '2 minutes' WHERE company_id=c.company_id AND conversation_id=c.id AND state='pending'; CONTINUE;
    END IF;
    IF j.attempts>=3 THEN
      UPDATE public.inbound_reply_jobs SET state='failed' WHERE company_id=c.company_id AND conversation_id=c.id AND state='pending'; CONTINUE;
    END IF;
    UPDATE public.inbound_reply_jobs SET attempts=least(attempts+1,3),next_attempt_at=now()+interval '2 minutes'
      WHERE company_id=c.company_id AND conversation_id=c.id AND state='pending';
    RETURN jsonb_build_object('companyId',j.company_id,'leadId',c.lead_id,'conversationId',c.id,
      'incomingExternalMessageId',m.external_message_id,'message',m.content,'occurredAt',m.created_at,
      'recipientPhone',regexp_replace(c.external_conversation_id,'^whatsapp:',''),'phoneNumberId',c.phone_number_id,
      'hasImage',m.content LIKE '%[Imagem%' OR m.content LIKE '%[Foto%', 'hasAudio',m.content LIKE '%[Áudio%');
  END LOOP;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.claim_attendance_turn(uuid,uuid),public.release_attendance_turn(uuid,uuid,uuid),
  public.enqueue_attendance_turn(uuid,uuid,uuid,bigint,text,jsonb,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_turn(uuid,uuid),public.release_attendance_turn(uuid,uuid,uuid),
  public.enqueue_attendance_turn(uuid,uuid,uuid,bigint,text,jsonb,timestamptz,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
