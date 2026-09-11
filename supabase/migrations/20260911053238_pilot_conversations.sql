BEGIN;
CREATE TABLE public.conversation_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 object_path text NOT NULL UNIQUE,expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
ALTER TABLE public.conversation_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_media FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.conversation_media TO service_role;
CREATE INDEX conversation_media_expiry ON public.conversation_media(company_id,expires_at);
INSERT INTO public.conversation_media(company_id,object_path,expires_at)
SELECT m.company_id,path.value,m.created_at+interval '7 days'
FROM public.messages m CROSS JOIN LATERAL jsonb_array_elements_text(
 CASE WHEN jsonb_typeof(to_jsonb(m.media_urls))='array' THEN to_jsonb(m.media_urls) ELSE '[]'::jsonb END
) path(value)
WHERE path.value LIKE 'whatsapp-media/'||m.company_id::text||'/%'
AND path.value ~ '^whatsapp-media/[0-9a-f-]+/[0-9a-f-]+\.(jpg|png|webp)$'
ON CONFLICT(object_path) DO NOTHING;
CREATE TABLE public.conversation_settings (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id),
 last_scheduler_at timestamptz,
 business_hours jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(business_hours)='object'),
 templates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(templates)='array')
);
ALTER TABLE public.conversation_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.conversation_settings TO service_role;
CREATE TABLE public.message_delivery_events (
 id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 company_id uuid NOT NULL REFERENCES public.companies(id),
 external_message_id text NOT NULL CHECK(length(external_message_id) BETWEEN 1 AND 500),
 status text NOT NULL CHECK(status IN ('sent','delivered','read','failed')),
 occurred_at timestamptz NOT NULL,
 error_code integer,
 PRIMARY KEY(company_id,external_message_id,status)
);
ALTER TABLE public.message_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_delivery_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.message_delivery_events TO service_role;
ALTER TABLE public.conversations ADD COLUMN assigned_broker_id uuid REFERENCES public.broker_accounts(id);
ALTER TABLE public.conversations ADD COLUMN phone_number_id text;
ALTER TABLE public.messages ADD COLUMN delivery_status text CHECK(delivery_status IN ('pending','sent','failed'));
ALTER TABLE public.messages ADD COLUMN delivery_error_code integer;
CREATE TABLE public.message_outbox (
 id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id),conversation_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 600),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','uncertain','cancelled')),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),broker_id uuid,template_payload jsonb,
 UNIQUE(company_id,request_key), FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id)
);
ALTER TABLE public.message_outbox ENABLE ROW LEVEL SECURITY;
CREATE INDEX message_outbox_due ON public.message_outbox(company_id,state,next_attempt_at);
CREATE INDEX message_outbox_conversation ON public.message_outbox(company_id,conversation_id,state);
CREATE INDEX delivery_events_recent ON public.message_delivery_events(company_id,occurred_at DESC);
REVOKE ALL ON public.message_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.message_outbox TO service_role;
CREATE FUNCTION public.enqueue_conversation_message(p_company_id uuid,p_conversation_id uuid,p_key text,p_content text,p_broker_id uuid DEFAULT NULL,p_template_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.conversations%ROWTYPE; message_id uuid;tpl jsonb;
BEGIN
 IF p_content IS NULL OR length(p_content) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid_message'; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=p_conversation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_missing'; END IF;
 SELECT id INTO message_id FROM public.message_outbox WHERE company_id=p_company_id AND request_key=p_key;
 IF FOUND THEN RETURN message_id; END IF;
 IF p_broker_id IS NOT NULL THEN
  IF c.assigned_broker_id IS DISTINCT FROM p_broker_id OR NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active) THEN RAISE EXCEPTION 'claim_required'; END IF;
 ELSE
  IF c.bot_paused OR coalesce(c.assigned_to,'')<>'' THEN RAISE EXCEPTION 'bot_paused'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=p_company_id AND conversation_id=c.id AND dedup_key=p_key AND state='reserved') THEN RAISE EXCEPTION 'reservation_required'; END IF;
 END IF;
 IF p_template_name IS NOT NULL THEN
  IF p_broker_id IS NULL THEN RAISE EXCEPTION 'template_manual_only'; END IF;
  SELECT t INTO tpl FROM public.conversation_settings s CROSS JOIN LATERAL jsonb_array_elements(s.templates) t WHERE s.company_id=p_company_id AND t->>'name'=p_template_name AND t->>'approved'='true' LIMIT 1;
  IF tpl IS NULL THEN RAISE EXCEPTION 'template_required'; END IF;
 END IF;
 IF tpl IS NULL AND NOT EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND conversation_id=c.id AND direction='incoming' AND created_at>now()-interval '24 hours' AND created_at<=now()+interval '5 minutes') THEN RAISE EXCEPTION 'template_required'; END IF;
 message_id:=gen_random_uuid();
 INSERT INTO public.messages(id,company_id,conversation_id,direction,sender_type,content,delivery_status)
 VALUES(message_id,p_company_id,c.id,'outgoing',CASE WHEN p_broker_id IS NULL THEN 'ai' ELSE 'human' END,p_content,'pending');
 INSERT INTO public.message_outbox(id,company_id,conversation_id,request_key,broker_id,template_payload) VALUES(message_id,p_company_id,c.id,p_key,p_broker_id,tpl);
 UPDATE public.attendance_replies SET state='accepted' WHERE company_id=p_company_id AND dedup_key=p_key;
 UPDATE public.conversations SET last_message_at=now() WHERE company_id=p_company_id AND id=c.id;
 RETURN message_id;
END $$;
CREATE FUNCTION public.claim_outbox_message(p_company_id uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.message_outbox%ROWTYPE;c public.conversations%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.message_outbox WHERE company_id=p_company_id AND id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=o.conversation_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO o FROM public.message_outbox WHERE company_id=p_company_id AND id=p_id FOR UPDATE;
 IF o.state<>'pending' OR o.attempts>=3 OR o.next_attempt_at>now() THEN RETURN false; END IF;
 IF (o.broker_id IS NULL AND (c.bot_paused OR coalesce(c.assigned_to,'')<>'')) OR (o.broker_id IS NOT NULL AND c.assigned_broker_id IS DISTINCT FROM o.broker_id)
 OR (o.template_payload IS NULL AND NOT EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND conversation_id=c.id AND direction='incoming' AND created_at>now()-interval '24 hours' AND created_at<=now()+interval '5 minutes')) THEN
 UPDATE public.message_outbox SET state='cancelled' WHERE company_id=p_company_id AND id=p_id AND state='pending';
 UPDATE public.messages SET delivery_status='failed',delivery_error_code=131047 WHERE company_id=p_company_id AND id=p_id AND delivery_status='pending';
 RETURN false;END IF;
 UPDATE public.message_outbox SET state='sending',attempts=attempts+1,updated_at=now() WHERE company_id=p_company_id AND id=p_id AND state='pending' AND attempts<3 AND next_attempt_at<=now();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_conversation_message(uuid,uuid,text,text,uuid,text),public.claim_outbox_message(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_conversation_message(uuid,uuid,text,text,uuid,text),public.claim_outbox_message(uuid,uuid) TO service_role;
CREATE FUNCTION public.change_conversation_owner(p_company_id uuid,p_lead_id uuid,p_broker_id uuid,p_release boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.conversations%ROWTYPE; broker_name text;
BEGIN
 SELECT name INTO broker_name FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF c.assigned_broker_id IS NOT NULL AND c.assigned_broker_id<>p_broker_id THEN RETURN false; END IF;
 IF c.assigned_broker_id IS NULL AND coalesce(c.assigned_to,'') NOT IN ('',broker_name) THEN RETURN false; END IF;
 UPDATE public.attendance_replies SET state='uncertain' WHERE company_id=p_company_id AND conversation_id=c.id AND state='reserved' AND created_at<now()-interval '2 minutes';
 -- Wait for a reserved outbound send to resolve before ownership changes.
 IF EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=p_company_id AND conversation_id=c.id AND state='reserved') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=c.id AND state='sending') THEN RETURN false; END IF;
 UPDATE public.messages SET delivery_status='failed',delivery_error_code=0 WHERE company_id=p_company_id AND id IN
 (SELECT id FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=c.id AND state='pending');
 UPDATE public.message_outbox SET state='cancelled' WHERE company_id=p_company_id AND conversation_id=c.id AND state='pending';
 UPDATE public.conversations SET assigned_broker_id=CASE WHEN p_release THEN NULL ELSE p_broker_id END,
 assigned_to=CASE WHEN p_release THEN NULL ELSE broker_name END,bot_paused=NOT p_release WHERE company_id=p_company_id AND id=c.id;
 UPDATE public.leads SET assigned_to=CASE WHEN p_release THEN NULL ELSE broker_name END WHERE company_id=p_company_id AND id=p_lead_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.change_conversation_owner(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_conversation_owner(uuid,uuid,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
CREATE FUNCTION public.receive_conversation_message(p_company_id uuid,p_phone text,p_phone_number_id text,p_external_id text,p_content text,p_name text,p_occurred_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lead_id_value uuid;conversation_id_value uuid;message_id_value uuid;
BEGIN
 IF p_phone!~'^[0-9]{5,20}$' OR length(p_external_id) NOT BETWEEN 1 AND 255 OR length(p_content) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid_message';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_phone,0));
 IF EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND external_message_id=p_external_id) THEN RETURN jsonb_build_object('saved',false);END IF;
 SELECT id INTO lead_id_value FROM public.leads WHERE company_id=p_company_id AND regexp_replace(phone,'[^0-9]','','g')=p_phone ORDER BY created_at LIMIT 1;
 IF lead_id_value IS NULL THEN
  lead_id_value:=gen_random_uuid();
  INSERT INTO public.leads(id,company_id,name,phone,source,details,last_contact_at) VALUES(lead_id_value,p_company_id,coalesce(nullif(left(p_name,160),''),'Contato WhatsApp'),'+'||p_phone,'WhatsApp','Lead criado automaticamente a partir de uma mensagem recebida no WhatsApp.',p_occurred_at);
 END IF;
 SELECT id INTO conversation_id_value FROM public.conversations WHERE company_id=p_company_id AND lead_id=lead_id_value ORDER BY last_message_at DESC LIMIT 1;
 IF conversation_id_value IS NULL THEN
  conversation_id_value:=gen_random_uuid();
  INSERT INTO public.conversations(id,company_id,lead_id,channel,external_conversation_id,status,last_message_at,phone_number_id)
  VALUES(conversation_id_value,p_company_id,lead_id_value,'WhatsApp','whatsapp:'||p_phone,'Aberta',p_occurred_at,p_phone_number_id);
 END IF;
 message_id_value:=gen_random_uuid();
 INSERT INTO public.messages(id,company_id,conversation_id,direction,sender_type,content,external_message_id,created_at)
 VALUES(message_id_value,p_company_id,conversation_id_value,'incoming','client',p_content,p_external_id,p_occurred_at);
 UPDATE public.conversations SET last_message_at=greatest(last_message_at,p_occurred_at),phone_number_id=p_phone_number_id,external_conversation_id='whatsapp:'||p_phone WHERE company_id=p_company_id AND id=conversation_id_value;
 UPDATE public.leads SET last_contact_at=greatest(last_contact_at,p_occurred_at) WHERE company_id=p_company_id AND id=lead_id_value;
 RETURN jsonb_build_object('saved',true,'leadId',lead_id_value,'conversationId',conversation_id_value,'messageId',message_id_value);
END $$;
REVOKE ALL ON FUNCTION public.receive_conversation_message(uuid,text,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_conversation_message(uuid,text,text,text,text,text,timestamptz) TO service_role;
COMMIT;
