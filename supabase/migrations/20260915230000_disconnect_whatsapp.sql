CREATE OR REPLACE FUNCTION public.disconnect_company_whatsapp(p_company_id uuid,p_phone_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.conversation_settings WHERE company_id=p_company_id AND whatsapp_phone_number_id=p_phone_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'connection_changed'; END IF;
 UPDATE public.conversation_settings SET whatsapp_enabled=false,whatsapp_access_token=NULL
 WHERE company_id=p_company_id;
 -- Preserve the number's tenant ownership and every historical record.
 -- Pending messages must not unexpectedly resume when a new number is connected.
 WITH stopped AS (
 UPDATE public.message_outbox SET state='failed',updated_at=now()
 WHERE company_id=p_company_id AND state='pending' RETURNING id
 ) UPDATE public.messages SET delivery_status='failed'
 WHERE company_id=p_company_id AND id IN (SELECT id FROM stopped);
END; $$;
REVOKE ALL ON FUNCTION public.disconnect_company_whatsapp(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_company_whatsapp(uuid,text) TO service_role;
