-- Run after the migration, or prepend the migration WITHOUT its BEGIN/COMMIT
-- inside this transaction to validate the entire change without installing it.
-- No network or provider call. All fixtures and changes are rolled back.
BEGIN;

CREATE FUNCTION pg_temp.expect_property_blocked(c uuid, l uuid, p uuid, m uuid, expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE lv timestamptz; pv timestamptz; actual text;
BEGIN
  SELECT updated_at INTO lv FROM public.leads WHERE id=l;
  SELECT updated_at INTO pv FROM public.properties WHERE id=p;
  BEGIN
    PERFORM public.claim_property_auto_delivery(c,l,p,m,'Test only',lv,pv,'12345678','5511999999999');
  EXCEPTION WHEN OTHERS THEN actual:=SQLERRM;
  END;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Expected %, got %',expected,coalesce(actual,'NO ERROR');
  END IF;
END;
$$;

DO $$
DECLARE
  c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); l uuid:=gen_random_uuid();
  p uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); foreign_p uuid:=gen_random_uuid();
  conv uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); m2 uuid:=gen_random_uuid();
  lv timestamptz; pv timestamptz; old_lv timestamptz; delivery uuid; second_delivery uuid; outgoing uuid;
  rejected boolean; count_rows integer;
BEGIN
  INSERT INTO public.companies(id,name,slug) VALUES
    (c,'Temporary n8n verification','n8n-test-'||c),(other_c,'Temporary other tenant','n8n-test-'||other_c);
  INSERT INTO public.leads(id,company_id,name,phone,goal,property_type,region,budget_min,budget_max,details,lifecycle_status)
    VALUES(l,c,'Temporary test','11999999999','Comprar','Apartamento','Centro',300000,500000,'2 quartos','Novo');
  INSERT INTO public.properties(id,company_id,code,title,purpose,price,district,city,property_type,bedrooms,status) VALUES
    (p,c,'n8n-test-'||p,'Test apartment','Venda',400000,'Centro','Cidade','Apartamento',2,'Disponível'),
    (p2,c,'n8n-test-'||p2,'Test apartment 2','Venda',410000,'Centro','Cidade','Apartamento',2,'Disponível'),
    (foreign_p,other_c,'n8n-test-'||foreign_p,'Other company','Venda',410000,'Centro','Cidade','Apartamento',2,'Disponível');
  INSERT INTO public.conversations(id,company_id,lead_id,channel,external_conversation_id,status)
    VALUES(conv,c,l,'whatsapp','meta:12345678:5511999999999','open');
  INSERT INTO public.messages(id,company_id,conversation_id,direction,sender_type,content,external_message_id,created_at)
    VALUES(m,c,conv,'incoming','client','2 quartos','wamid.TEST.'||m,clock_timestamp()-interval '2 minutes');

  IF has_function_privilege('anon','public.claim_property_auto_delivery(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.finish_property_auto_delivery(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('anon','public.mark_property_auto_delivery_uncertain(uuid,uuid)','EXECUTE')
    OR has_table_privilege('service_role','public.property_auto_deliveries','DELETE') THEN
    RAISE EXCEPTION 'Unsafe reservation permissions';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.property_auto_deliveries'::regclass) THEN
    RAISE EXCEPTION 'RLS missing';
  END IF;
  PERFORM pg_temp.expect_property_blocked(c,l,foreign_p,m,'property_auto_delivery_property_not_found');
  PERFORM pg_temp.expect_property_blocked(other_c,l,p,m,'property_auto_delivery_lead_not_found');
  UPDATE public.properties SET status='Reservado' WHERE id=p;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_property_unavailable');
  UPDATE public.properties SET status='Disponível' WHERE id=p;
  UPDATE public.leads SET assigned_to='Corretor teste' WHERE id=l;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_human_handoff');
  UPDATE public.leads SET assigned_to=NULL WHERE id=l;
  UPDATE public.conversations SET assigned_to='Corretor teste' WHERE id=conv;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_human_handoff');
  UPDATE public.conversations SET assigned_to=NULL,status='closed' WHERE id=conv;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_human_handoff');
  UPDATE public.conversations SET status='open',channel='painel' WHERE id=conv;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_invalid_incoming');
  UPDATE public.conversations SET channel='whatsapp',external_conversation_id='meta:99999999:5511999999999' WHERE id=conv;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_invalid_incoming');
  UPDATE public.conversations SET external_conversation_id='meta:12345678:5511999999999' WHERE id=conv;
  UPDATE public.leads SET lifecycle_status='Perdido' WHERE id=l;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_inactive_lead');
  UPDATE public.leads SET lifecycle_status='Novo' WHERE id=l;
  UPDATE public.messages SET created_at=clock_timestamp()-interval '25 hours' WHERE id=m;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_invalid_incoming');
  UPDATE public.messages SET created_at=clock_timestamp()+interval '1 hour' WHERE id=m;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_invalid_incoming');
  UPDATE public.messages SET created_at=clock_timestamp()-interval '2 minutes',external_message_id=NULL WHERE id=m;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_invalid_incoming');
  UPDATE public.messages SET external_message_id='wamid.TEST.'||m,direction='outgoing',sender_type='human' WHERE id=m;
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_invalid_incoming');
  UPDATE public.messages SET direction='incoming',sender_type='client' WHERE id=m;

  SELECT updated_at INTO old_lv FROM public.leads WHERE id=l;
  UPDATE public.leads SET name='New test name' WHERE id=l;
  SELECT updated_at INTO lv FROM public.leads WHERE id=l;
  SELECT updated_at INTO pv FROM public.properties WHERE id=p;
  IF old_lv=lv THEN RAISE EXCEPTION 'Profile version not advanced'; END IF;
  rejected:=false;
  BEGIN
    PERFORM public.claim_property_auto_delivery(c,l,p,m,'Test',old_lv,pv,'12345678','5511999999999');
  EXCEPTION WHEN OTHERS THEN rejected:=SQLERRM='property_auto_delivery_stale_snapshot'; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale profile allowed'; END IF;

  INSERT INTO public.messages(id,company_id,conversation_id,direction,sender_type,content,external_message_id,created_at)
    VALUES(m2,c,conv,'incoming','client','New preferences','wamid.TEST.'||m2,clock_timestamp()-interval '1 minute');
  PERFORM pg_temp.expect_property_blocked(c,l,p,m,'property_auto_delivery_superseded_incoming');
  DELETE FROM public.messages WHERE id=m2;
  delivery:=public.claim_property_auto_delivery(c,l,p,m,'Test frozen content',lv,pv,'12345678','5511999999999');
  IF delivery IS NULL THEN RAISE EXCEPTION 'Expected first reservation'; END IF;
  IF public.claim_property_auto_delivery(c,l,p,m,'Must not duplicate',lv,pv,'12345678','5511999999999') IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate lead/property allowed';
  END IF;
  SELECT updated_at INTO pv FROM public.properties WHERE id=p2;
  IF public.claim_property_auto_delivery(c,l,p2,m,'Another property same event',lv,pv,'12345678','5511999999999') IS NOT NULL THEN
    RAISE EXCEPTION 'Multiple properties for same event allowed';
  END IF;
  SELECT count(*) INTO count_rows FROM public.messages WHERE company_id=c AND direction='outgoing';
  IF count_rows<>0 THEN RAISE EXCEPTION 'History created before receipt'; END IF;

  PERFORM public.mark_property_auto_delivery_uncertain(c,delivery);
  SELECT updated_at INTO pv FROM public.properties WHERE id=p;
  IF public.claim_property_auto_delivery(c,l,p,m,'Retry uncertain',lv,pv,'12345678','5511999999999') IS NOT NULL THEN
    RAISE EXCEPTION 'Uncertain reservation was released';
  END IF;
  rejected:=false;
  BEGIN PERFORM public.finish_property_auto_delivery(other_c,delivery,'wamid.OUT.'||delivery);
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-tenant receipt allowed'; END IF;
  outgoing:=public.finish_property_auto_delivery(c,delivery,'wamid.OUT.'||delivery);
  IF outgoing IS DISTINCT FROM public.finish_property_auto_delivery(c,delivery,'wamid.OUT.'||delivery) THEN
    RAISE EXCEPTION 'Receipt not idempotent';
  END IF;
  PERFORM public.mark_property_auto_delivery_uncertain(c,delivery);
  IF NOT EXISTS(SELECT 1 FROM public.property_auto_deliveries WHERE id=delivery AND state='accepted') THEN
    RAISE EXCEPTION 'Accepted state was downgraded';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE id=outgoing AND content='Test frozen content' AND sender_type='automation') THEN
    RAISE EXCEPTION 'Incorrect history';
  END IF;
  IF (SELECT count(*) FROM public.messages WHERE company_id=c AND direction='outgoing')<>1
    OR (SELECT count(*) FROM public.lead_property_events WHERE company_id=c AND event_type='Enviado')<>1 THEN
    RAISE EXCEPTION 'History duplicated';
  END IF;
  IF (SELECT assigned_to FROM public.leads WHERE id=l) IS NOT NULL THEN RAISE EXCEPTION 'Automation claimed broker ownership'; END IF;

  -- Same provider inbound replayed under another database UUID is still one event.
  INSERT INTO public.messages(id,company_id,conversation_id,direction,sender_type,content,external_message_id,created_at)
    VALUES(m2,c,conv,'incoming','client','Replay','wamid.TEST.'||m,clock_timestamp()-interval '1 minute');
  SELECT updated_at INTO pv FROM public.properties WHERE id=p2;
  IF public.claim_property_auto_delivery(c,l,p2,m2,'Replay',lv,pv,'12345678','5511999999999') IS NOT NULL THEN
    RAISE EXCEPTION 'Provider event replay duplicated';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'PASS: tenant isolation, handoff, availability, incoming window/source, snapshot, dedupe, receipt, history and permissions. All changes rolled back; no messages sent.' AS result;
