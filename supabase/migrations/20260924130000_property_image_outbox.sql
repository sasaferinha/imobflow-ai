BEGIN;
ALTER TABLE public.message_outbox ADD COLUMN property_image jsonb;
ALTER TABLE public.message_outbox ADD COLUMN depends_on uuid;
ALTER TABLE public.message_outbox ADD COLUMN offered_property_id uuid;
ALTER TABLE public.message_outbox ADD CONSTRAINT message_outbox_tenant_id_unique UNIQUE(company_id,id);
ALTER TABLE public.message_outbox ADD CONSTRAINT outbox_image_shape CHECK (
 property_image IS NULL OR (jsonb_typeof(property_image)='object'
 AND property_image ?& ARRAY['propertyId','url','path'] AND template_payload IS NULL));
ALTER TABLE public.message_outbox ADD CONSTRAINT outbox_dependency_tenant_fk
 FOREIGN KEY(company_id,depends_on) REFERENCES public.message_outbox(company_id,id);
ALTER TABLE public.message_outbox ADD CONSTRAINT outbox_offer_tenant_fk
 FOREIGN KEY(company_id,offered_property_id) REFERENCES public.properties(company_id,id) ON DELETE SET NULL (offered_property_id);
CREATE INDEX message_outbox_dependency_idx ON public.message_outbox(company_id,depends_on) WHERE depends_on IS NOT NULL;

-- One atomic offer: text plus at most five real photos, each with its own receipt.
-- The caller must also validate the configured storage origin before passing images.
CREATE FUNCTION public.enqueue_property_offer(p_company_id uuid,p_conversation_id uuid,p_key text,p_content text,
 p_broker_id uuid,p_property_id uuid,p_images jsonb)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.conversations%ROWTYPE; p public.properties%ROWTYPE; image jsonb;
 ids uuid[]; text_id uuid; image_id uuid; previous_id uuid; idx integer:=0;
BEGIN
 IF p_broker_id IS NULL OR p_images IS NULL OR jsonb_typeof(p_images)<>'array' OR jsonb_array_length(p_images)>5 THEN RAISE EXCEPTION 'invalid_property_images'; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=p_conversation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_missing'; END IF;
 IF c.assigned_broker_id IS DISTINCT FROM p_broker_id OR NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_broker_id AND active) THEN RAISE EXCEPTION 'claim_required'; END IF;
 SELECT id INTO text_id FROM public.message_outbox WHERE company_id=p_company_id AND request_key=p_key;
 IF FOUND THEN
  SELECT array_agg(id ORDER BY CASE WHEN request_key=p_key THEN 0 ELSE 1 END,request_key) INTO ids
  FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=c.id
   AND (request_key=p_key OR request_key IN (SELECT p_key||':photo:'||i FROM generate_series(1,5) i));
  RETURN ids;
 END IF;
 SELECT * INTO p FROM public.properties WHERE company_id=p_company_id AND id=p_property_id FOR SHARE;
 IF NOT FOUND OR p.status IN ('Vendido','Alugado') THEN RAISE EXCEPTION 'property_unavailable'; END IF;
 FOR image IN SELECT value FROM jsonb_array_elements(p_images) LOOP
  IF coalesce(image->>'propertyId','')<>p_property_id::text
   OR coalesce(image->>'path','') !~ ('^property-images/'||p_company_id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$')
   OR NOT coalesce(to_jsonb(p.images) @> jsonb_build_array(image->>'url'),false)
   OR coalesce(image->>'url','') NOT LIKE '%/storage/v1/object/public/'||(image->>'path')
  THEN RAISE EXCEPTION 'invalid_property_images'; END IF;
 END LOOP;
 -- No free-form photos outside the service window, even if a text template exists.
 text_id:=public.enqueue_conversation_message(p_company_id,c.id,p_key,p_content,p_broker_id,NULL);
 UPDATE public.message_outbox SET offered_property_id=p_property_id WHERE company_id=p_company_id AND id=text_id;
 ids:=ARRAY[text_id]; previous_id:=text_id;
 FOR image IN SELECT value FROM jsonb_array_elements(p_images) LOOP
  idx:=idx+1; image_id:=gen_random_uuid();
  INSERT INTO public.messages(id,company_id,conversation_id,direction,sender_type,content,media_urls,delivery_status,created_at)
   VALUES(image_id,p_company_id,c.id,'outgoing','human',left(p.title,900)||' — foto '||idx||'/'||jsonb_array_length(p_images),jsonb_build_array(image->>'url'),'pending',now()+idx*interval '1 millisecond');
  INSERT INTO public.message_outbox(id,company_id,conversation_id,request_key,broker_id,property_image,depends_on,next_attempt_at)
   VALUES(image_id,p_company_id,c.id,p_key||':photo:'||idx,p_broker_id,image,previous_id,now()+idx*interval '1 millisecond');
  ids:=array_append(ids,image_id); previous_id:=image_id;
 END LOOP;
 RETURN ids;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_property_offer(uuid,uuid,text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_property_offer(uuid,uuid,text,text,uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_outbox_message_v2(p_company_id uuid,p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.message_outbox%ROWTYPE; parent_state text; parent_retry timestamptz;
BEGIN
 SELECT * INTO o FROM public.message_outbox WHERE company_id=p_company_id AND id=p_id;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Match the legacy claim lock order (conversation before queue row).
 PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND id=o.conversation_id FOR UPDATE;
 IF o.offered_property_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.properties
  WHERE company_id=p_company_id AND id=o.offered_property_id AND coalesce(status,'Disponível') NOT IN ('Vendido','Alugado')) THEN
  UPDATE public.message_outbox SET state='cancelled',updated_at=now() WHERE company_id=p_company_id AND id=p_id AND state='pending';
  IF FOUND THEN UPDATE public.messages SET delivery_status='failed',delivery_error_code=131053 WHERE company_id=p_company_id AND id=p_id; END IF;
  RETURN false;
 END IF;
 IF o.depends_on IS NOT NULL THEN
  SELECT state,next_attempt_at INTO parent_state,parent_retry FROM public.message_outbox WHERE company_id=p_company_id AND id=o.depends_on;
  IF parent_state IN ('failed','cancelled','uncertain') THEN
   UPDATE public.message_outbox SET state='cancelled',updated_at=now() WHERE company_id=p_company_id AND id=p_id AND state='pending';
   IF FOUND THEN UPDATE public.messages SET delivery_status='failed',delivery_error_code=131053 WHERE company_id=p_company_id AND id=p_id; END IF;
   RETURN false;
  END IF;
  IF parent_state IS DISTINCT FROM 'sent' THEN
   -- A delayed parent must not let children monopolize the oldest due batch.
   IF parent_retry>now() OR parent_state='sending' THEN
    UPDATE public.message_outbox SET next_attempt_at=greatest(parent_retry+interval '1 millisecond',now()+interval '30 seconds')
     WHERE company_id=p_company_id AND id=p_id AND state='pending';
   END IF;
   RETURN false;
  END IF;
 END IF;
 IF NOT public.claim_outbox_message(p_company_id,p_id) THEN RETURN false; END IF;
 UPDATE public.message_outbox SET provider_attempted_at=NULL WHERE company_id=p_company_id AND id=p_id AND state='sending';
 RETURN true;
END $$;
CREATE FUNCTION public.record_sent_property_offer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state='sent' AND OLD.state IS DISTINCT FROM 'sent' AND NEW.offered_property_id IS NOT NULL THEN
  INSERT INTO public.lead_property_events(company_id,lead_id,property_id,event_type)
  SELECT NEW.company_id,c.lead_id,NEW.offered_property_id,'Enviado' FROM public.conversations c
  WHERE c.company_id=NEW.company_id AND c.id=NEW.conversation_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER record_sent_property_offer AFTER UPDATE OF state ON public.message_outbox
 FOR EACH ROW EXECUTE FUNCTION public.record_sent_property_offer();
REVOKE ALL ON FUNCTION public.record_sent_property_offer() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
