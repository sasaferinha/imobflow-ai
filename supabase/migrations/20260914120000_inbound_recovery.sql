BEGIN;
-- Only new inbound messages enter recovery. Never replay historical clients.
CREATE TABLE public.inbound_reply_jobs (
 company_id uuid NOT NULL, message_id uuid NOT NULL, conversation_id uuid NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','cancelled','failed')),
 next_attempt_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 PRIMARY KEY(company_id,message_id),
 FOREIGN KEY(company_id,message_id) REFERENCES public.messages(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.inbound_reply_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inbound_reply_jobs FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX inbound_reply_jobs_due ON public.inbound_reply_jobs(next_attempt_at) WHERE state='pending';
CREATE FUNCTION public.queue_inbound_reply_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.direction='incoming' AND NEW.external_message_id IS NOT NULL THEN
  INSERT INTO public.inbound_reply_jobs(company_id,message_id,conversation_id)
  VALUES(NEW.company_id,NEW.id,NEW.conversation_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_inbound_reply_job AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.queue_inbound_reply_job();
REVOKE ALL ON FUNCTION public.queue_inbound_reply_job() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_missing_inbound_reply() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.inbound_reply_jobs%ROWTYPE; m public.messages%ROWTYPE; c public.conversations%ROWTYPE;
BEGIN
 FOR j IN SELECT * FROM public.inbound_reply_jobs WHERE state='pending' AND next_attempt_at<=now()
  ORDER BY next_attempt_at LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO c FROM public.conversations WHERE company_id=j.company_id AND id=j.conversation_id FOR UPDATE;
  SELECT * INTO m FROM public.messages WHERE company_id=j.company_id AND id=j.message_id;
  IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=j.company_id AND request_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id))
   OR EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=j.company_id AND dedup_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id) AND state='accepted') THEN
   UPDATE public.inbound_reply_jobs SET state='done' WHERE company_id=j.company_id AND message_id=j.message_id; CONTINUE;
  END IF;
  IF c.bot_paused OR coalesce(c.assigned_to,'')<>'' OR c.status NOT IN ('open','Aberta')
   OR m.created_at<=now()-interval '24 hours' OR m.created_at>now()+interval '5 minutes'
   OR EXISTS(SELECT 1 FROM public.leads WHERE company_id=j.company_id AND id=c.lead_id AND lifecycle_status IN ('Convertido','Perdido'))
   OR EXISTS(SELECT 1 FROM public.messages WHERE company_id=j.company_id AND conversation_id=j.conversation_id
     AND created_at>m.created_at AND (direction='incoming' OR sender_type='human')) THEN
   UPDATE public.inbound_reply_jobs SET state='cancelled' WHERE company_id=j.company_id AND message_id=j.message_id; CONTINUE;
  END IF;
  IF j.attempts>=3 THEN
   UPDATE public.inbound_reply_jobs SET state='failed' WHERE company_id=j.company_id AND message_id=j.message_id; CONTINUE;
  END IF;
  -- Never release a live reservation. An enqueued/ambiguous provider send is handled only by outbox recovery.
  IF EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=j.company_id
   AND dedup_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id) AND created_at>now()-interval '2 minutes') THEN
   UPDATE public.inbound_reply_jobs SET next_attempt_at=now()+interval '2 minutes' WHERE company_id=j.company_id AND message_id=j.message_id; CONTINUE;
  END IF;
  DELETE FROM public.attendance_replies WHERE company_id=j.company_id
   AND dedup_key IN ('reply:'||m.external_message_id,'handoff:'||m.external_message_id) AND state IN ('reserved','uncertain');
  UPDATE public.inbound_reply_jobs SET attempts=attempts+1,next_attempt_at=now()+interval '2 minutes'
   WHERE company_id=j.company_id AND message_id=j.message_id;
  RETURN jsonb_build_object('companyId',j.company_id,'leadId',c.lead_id,'conversationId',c.id,
   'incomingExternalMessageId',m.external_message_id,'message',m.content,'occurredAt',m.created_at,
   'recipientPhone',regexp_replace(c.external_conversation_id,'^whatsapp:',''),'phoneNumberId',c.phone_number_id,
   'hasImage',m.content LIKE '%[Imagem%' OR m.content LIKE '%[Foto%', 'hasAudio',m.content LIKE '%[Áudio%');
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.claim_missing_inbound_reply() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_missing_inbound_reply() TO service_role;
COMMIT;
