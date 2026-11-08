-- Atomic, tenant-scoped manual offers. No messages are sent by this migration.
ALTER TABLE public.message_outbox ADD COLUMN IF NOT EXISTS image_url text;
CREATE TABLE public.property_whatsapp_batches (
 company_id uuid NOT NULL REFERENCES public.companies(id),
 broker_id uuid NOT NULL, request_id uuid NOT NULL, opportunity_id uuid NOT NULL,
 payload jsonb NOT NULL, message_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,broker_id,request_id)
);
ALTER TABLE public.property_whatsapp_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_whatsapp_batches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.property_whatsapp_batches TO service_role;

CREATE FUNCTION public.property_whatsapp_context(p_company_id uuid,p_broker_id uuid,p_opportunity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.opportunities%ROWTYPE;c public.conversations%ROWTYPE;n integer;recipient jsonb;
BEGIN
 recipient:=public.opportunity_action(p_company_id,p_broker_id,p_opportunity_id,'draft');
 SELECT * INTO o FROM public.opportunities WHERE company_id=p_company_id AND id=p_opportunity_id;
 SELECT count(*) INTO n FROM public.conversations WHERE company_id=p_company_id AND lead_id=o.lead_id
 AND external_conversation_id ~ '^(whatsapp:)?[0-9]{5,20}$' AND lower(channel)='whatsapp';
 IF n<>1 THEN RAISE EXCEPTION 'whatsapp_conversation_required'; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND lead_id=o.lead_id
 AND external_conversation_id ~ '^(whatsapp:)?[0-9]{5,20}$' AND lower(channel)='whatsapp' FOR UPDATE;
 IF c.assigned_broker_id IS DISTINCT FROM p_broker_id OR NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_broker_id AND active) THEN RAISE EXCEPTION 'claim_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND conversation_id=c.id AND direction='incoming' AND created_at>now()-interval '24 hours' AND created_at<=now()+interval '5 minutes') THEN RAISE EXCEPTION 'template_required'; END IF;
 RETURN jsonb_build_object('conversationId',c.id,'phoneNumberId',c.phone_number_id,'recipient',recipient->>'name','phone',regexp_replace(c.external_conversation_id,'^whatsapp:',''),'propertyId',o.property_id);
END $$;

CREATE FUNCTION public.enqueue_property_whatsapp_offer(p_company_id uuid,p_broker_id uuid,p_opportunity_id uuid,p_request_id uuid,p_content text,p_images jsonb,p_phone_number_id text)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx jsonb; prior public.property_whatsapp_batches%ROWTYPE; payload jsonb; ids uuid[]:='{}';mid uuid;img text;idx integer:=0;catalog jsonb;
BEGIN
 IF p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 4000 OR p_request_id IS NULL OR p_images IS NULL OR jsonb_typeof(p_images)<>'array' OR jsonb_array_length(p_images)>5 OR p_phone_number_id IS NULL OR p_phone_number_id !~ '^[0-9]{5,30}$' THEN RAISE EXCEPTION 'invalid_offer'; END IF;
 IF NOT public.can_access_opportunity(p_company_id,p_broker_id,(SELECT lead_id FROM public.opportunities WHERE company_id=p_company_id AND id=p_opportunity_id)) THEN RAISE EXCEPTION 'opportunity_not_found'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_broker_id::text||p_request_id::text,0));
 payload:=jsonb_build_object('opportunity',p_opportunity_id,'content',p_content,'images',p_images,'sender',p_phone_number_id);
 SELECT * INTO prior FROM public.property_whatsapp_batches WHERE company_id=p_company_id AND broker_id=p_broker_id AND request_id=p_request_id;
 IF FOUND THEN
   IF prior.payload<>payload THEN RAISE EXCEPTION 'offer_request_conflict'; END IF;
   RETURN prior.message_ids;
 END IF;
 ctx:=public.property_whatsapp_context(p_company_id,p_broker_id,p_opportunity_id);
 IF ctx->>'phoneNumberId' IS NOT NULL AND ctx->>'phoneNumberId'<>p_phone_number_id THEN RAISE EXCEPTION 'whatsapp_connection_changed'; END IF;
 SELECT to_jsonb(images) INTO catalog FROM public.properties WHERE company_id=p_company_id AND id=(ctx->>'propertyId')::uuid;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_images) x WHERE jsonb_typeof(x)<>'string') OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p_images) x)<>jsonb_array_length(p_images) THEN RAISE EXCEPTION 'invalid_offer_images'; END IF;
 FOR img IN SELECT jsonb_array_elements_text(p_images) LOOP
   IF NOT coalesce(catalog ? img,false) OR img !~ ('^https://[^/]+/storage/v1/object/public/property-images/'||p_company_id::text||'/[A-Za-z0-9-]+\.(jpg|jpeg|png)$') THEN RAISE EXCEPTION 'invalid_offer_images'; END IF;
 END LOOP;
 UPDATE public.conversations SET phone_number_id=p_phone_number_id WHERE company_id=p_company_id AND id=(ctx->>'conversationId')::uuid AND phone_number_id IS NULL;
 mid:=public.enqueue_conversation_message(p_company_id,(ctx->>'conversationId')::uuid,'property-offer:'||p_broker_id||':'||p_request_id||':0',p_content,p_broker_id,NULL);
 ids:=array_append(ids,mid);
 FOR img IN SELECT jsonb_array_elements_text(p_images) LOOP
   idx:=idx+1;
   mid:=public.enqueue_conversation_message(p_company_id,(ctx->>'conversationId')::uuid,'property-offer:'||p_broker_id||':'||p_request_id||':'||idx,'Foto '||idx||' do imóvel',p_broker_id,NULL);
   UPDATE public.message_outbox SET image_url=img WHERE company_id=p_company_id AND id=mid;
   UPDATE public.messages SET media_urls=(jsonb_populate_record(NULL::public.messages,jsonb_build_object('media_urls',jsonb_build_array(img)))).media_urls WHERE company_id=p_company_id AND id=mid;
   ids:=array_append(ids,mid);
 END LOOP;
 INSERT INTO public.property_whatsapp_batches VALUES(p_company_id,p_broker_id,p_request_id,p_opportunity_id,payload,ids,now());
 RETURN ids;
END $$;
REVOKE ALL ON FUNCTION public.property_whatsapp_context(uuid,uuid,uuid),public.enqueue_property_whatsapp_offer(uuid,uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.property_whatsapp_context(uuid,uuid,uuid),public.enqueue_property_whatsapp_offer(uuid,uuid,uuid,uuid,text,jsonb,text) TO service_role;
