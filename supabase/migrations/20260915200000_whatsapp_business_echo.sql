BEGIN;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source_channel text;

CREATE OR REPLACE FUNCTION public.receive_business_app_message(p_company_id uuid,p_phone text,p_phone_number_id text,p_external_id text,p_content text,p_occurred_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lead_value uuid; conversation_value uuid; message_value uuid;
BEGIN
 IF p_company_id IS NULL OR p_phone IS NULL OR p_phone!~'^[0-9]{5,20}$' OR p_phone_number_id IS NULL OR p_phone_number_id!~'^[0-9]{5,30}$'
 OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 255 OR p_content IS NULL OR length(p_content) NOT BETWEEN 1 AND 4000
 OR p_occurred_at IS NULL OR p_occurred_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid_message'; END IF;
 -- Revalidate persisted ownership inside the write transaction.
 IF NOT EXISTS(SELECT 1 FROM public.conversation_settings WHERE company_id=p_company_id AND whatsapp_phone_number_id=p_phone_number_id AND whatsapp_enabled=true)
 THEN RAISE EXCEPTION 'connection_unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||p_phone,0));
 IF EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND external_message_id=p_external_id) THEN RETURN jsonb_build_object('saved',false); END IF;
 SELECT id INTO lead_value FROM public.leads WHERE company_id=p_company_id AND regexp_replace(phone,'[^0-9]','','g')=p_phone ORDER BY created_at LIMIT 1;
 IF lead_value IS NULL THEN
  INSERT INTO public.leads(company_id,name,phone,source,details,last_contact_at)
  VALUES(p_company_id,'Contato WhatsApp','+'||p_phone,'WhatsApp','Contato iniciado pela equipe no WhatsApp Business.',p_occurred_at) RETURNING id INTO lead_value;
 END IF;
 SELECT id INTO conversation_value FROM public.conversations WHERE company_id=p_company_id AND lead_id=lead_value ORDER BY last_message_at DESC NULLS LAST LIMIT 1 FOR UPDATE;
 IF conversation_value IS NULL THEN
  INSERT INTO public.conversations(company_id,lead_id,channel,external_conversation_id,status,last_message_at,phone_number_id,bot_paused)
  VALUES(p_company_id,lead_value,'WhatsApp','whatsapp:'||p_phone,'Aberta',p_occurred_at,p_phone_number_id,true) RETURNING id INTO conversation_value;
 END IF;
 INSERT INTO public.messages(company_id,conversation_id,direction,sender_type,source_channel,content,external_message_id,created_at,delivery_status)
 VALUES(p_company_id,conversation_value,'outgoing','human','whatsapp_business',p_content,p_external_id,p_occurred_at,'sent') RETURNING id INTO message_value;
 UPDATE public.conversations SET bot_paused=true,last_message_at=greatest(last_message_at,p_occurred_at),phone_number_id=p_phone_number_id
 WHERE company_id=p_company_id AND id=conversation_value;
 UPDATE public.leads SET last_contact_at=greatest(last_contact_at,p_occurred_at) WHERE company_id=p_company_id AND id=lead_value;
 -- A human has replied. Cancel bot replies that have not been sent yet.
 UPDATE public.messages SET delivery_status='failed',delivery_error_code=0 WHERE company_id=p_company_id AND id IN
 (SELECT id FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=conversation_value AND broker_id IS NULL AND state='pending');
 UPDATE public.message_outbox SET state='cancelled',updated_at=now() WHERE company_id=p_company_id AND conversation_id=conversation_value AND broker_id IS NULL AND state='pending';
 RETURN jsonb_build_object('saved',true,'messageId',message_value,'leadId',lead_value,'conversationId',conversation_value);
END $$;
REVOKE ALL ON FUNCTION public.receive_business_app_message(uuid,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_business_app_message(uuid,text,text,text,text,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
