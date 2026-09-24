-- CRM events and catalogue deals share one transaction. Legacy Neon sales stay
-- untouched; their cancellation is a tombstone, never a guessed property edit.
BEGIN;

CREATE TABLE public.broker_name_history (
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id), broker_id uuid NOT NULL,
 name text NOT NULL, PRIMARY KEY(company_id,broker_id,name),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id)
);
INSERT INTO public.broker_name_history(company_id,broker_id,name) SELECT company_id,id,name FROM public.broker_accounts;
ALTER TABLE public.broker_name_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broker_name_history FROM anon,authenticated;
CREATE FUNCTION public.remember_broker_name() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.broker_name_history(company_id,broker_id,name) VALUES(NEW.company_id,NEW.id,NEW.name) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER remember_broker_name AFTER INSERT OR UPDATE OF name ON public.broker_accounts FOR EACH ROW EXECUTE FUNCTION public.remember_broker_name();

ALTER TABLE public.leads ADD COLUMN assigned_broker_id uuid;
ALTER TABLE public.leads ADD COLUMN last_deal_id uuid;
ALTER TABLE public.leads ADD COLUMN deal_restore_status text;
ALTER TABLE public.appointments ADD COLUMN assigned_broker_id uuid;
ALTER TABLE public.leads ADD CONSTRAINT leads_performance_broker_fk FOREIGN KEY(company_id,assigned_broker_id) REFERENCES public.broker_accounts(company_id,id);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_performance_broker_fk FOREIGN KEY(company_id,assigned_broker_id) REFERENCES public.broker_accounts(company_id,id);
-- Names with two possible owners are intentionally not attributed to either.
UPDATE public.leads l SET assigned_broker_id=b.id FROM (SELECT company_id,name,(array_agg(id))[1] id FROM public.broker_accounts GROUP BY company_id,name HAVING count(*)=1) b WHERE b.company_id=l.company_id AND b.name=l.assigned_to;
UPDATE public.appointments a SET assigned_broker_id=b.id FROM (SELECT company_id,name,(array_agg(id))[1] id FROM public.broker_accounts GROUP BY company_id,name HAVING count(*)=1) b WHERE b.company_id=a.company_id AND b.name=a.assigned_to;
CREATE FUNCTION public.resolve_assigned_broker() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.assigned_broker_id IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
 SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] END INTO NEW.assigned_broker_id
 FROM public.broker_accounts WHERE company_id=NEW.company_id AND name=NEW.assigned_to;
 RETURN NEW;
END $$;
CREATE TRIGGER resolve_lead_broker BEFORE INSERT OR UPDATE OF assigned_to,assigned_broker_id ON public.leads FOR EACH ROW EXECUTE FUNCTION public.resolve_assigned_broker();
CREATE TRIGGER resolve_appointment_broker BEFORE INSERT OR UPDATE OF assigned_to,assigned_broker_id ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.resolve_assigned_broker();
CREATE FUNCTION public.clear_manual_lead_deal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status AND NEW.last_deal_id IS NOT DISTINCT FROM OLD.last_deal_id THEN
  NEW.last_deal_id=NULL; NEW.deal_restore_status=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clear_manual_lead_deal BEFORE UPDATE OF lifecycle_status ON public.leads FOR EACH ROW EXECUTE FUNCTION public.clear_manual_lead_deal();

CREATE TABLE public.crm_metric_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 lead_id uuid NOT NULL, broker_id uuid, kind text NOT NULL CHECK(kind IN ('received','converted','recovered')),
 occurred_at timestamptz NOT NULL, source_key text NOT NULL,
 UNIQUE(company_id,source_key), FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id)
);
CREATE INDEX crm_metric_events_month_idx ON public.crm_metric_events(company_id,occurred_at,kind);
CREATE INDEX crm_metric_events_lead_idx ON public.crm_metric_events(company_id,lead_id,kind);
ALTER TABLE public.crm_metric_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_metric_events FROM anon,authenticated;
CREATE TABLE public.crm_metric_tracking (id boolean PRIMARY KEY DEFAULT true CHECK(id), started_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.crm_metric_tracking DEFAULT VALUES;
ALTER TABLE public.crm_metric_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_metric_tracking FROM anon,authenticated;
-- Creation timestamps are known. Past conversion/recovery times are NOT guessed.
INSERT INTO public.crm_metric_events(company_id,lead_id,broker_id,kind,occurred_at,source_key)
 SELECT company_id,id,assigned_broker_id,'received',created_at,'received:'||id FROM public.leads;
CREATE FUNCTION public.track_lead_metrics() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.crm_metric_events(company_id,lead_id,broker_id,kind,occurred_at,source_key)
   VALUES(NEW.company_id,NEW.id,NEW.assigned_broker_id,'received',NEW.created_at,'received:'||NEW.id) ON CONFLICT DO NOTHING;
 ELSE
  UPDATE public.crm_metric_events SET broker_id=NEW.assigned_broker_id WHERE company_id=NEW.company_id AND lead_id=NEW.id AND kind='received' AND broker_id IS NULL AND NEW.assigned_broker_id IS NOT NULL;
 END IF;
 -- An imported record already marked converted has no known conversion date.
 IF TG_OP='UPDATE' AND NEW.lifecycle_status='Convertido' AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status AND NEW.last_deal_id IS NULL THEN
  INSERT INTO public.crm_metric_events(company_id,lead_id,broker_id,kind,occurred_at,source_key)
   VALUES(NEW.company_id,NEW.id,NEW.assigned_broker_id,'converted',now(),'conversion:'||gen_random_uuid());
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER track_lead_metrics AFTER INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.track_lead_metrics();

CREATE FUNCTION public.track_recovered_lead() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.leads; previous_contact timestamptz; broker uuid;
BEGIN
 IF coalesce(NEW.direction,'') NOT IN ('incoming','inbound') OR coalesce(NEW.sender_type,'') NOT IN ('client','lead') THEN RETURN NEW; END IF;
 SELECT leads.* INTO l
 FROM public.conversations c JOIN public.leads leads ON leads.company_id=c.company_id AND leads.id=c.lead_id
 WHERE c.company_id=NEW.company_id AND c.id=NEW.conversation_id;
 IF l.id IS NULL OR l.lifecycle_status IN ('Convertido','Perdido') THEN RETURN NEW; END IF;
 SELECT coalesce(c.assigned_broker_id,l.assigned_broker_id) INTO broker FROM public.conversations c WHERE c.company_id=NEW.company_id AND c.id=NEW.conversation_id;
 SELECT max(m.created_at) INTO previous_contact FROM public.messages m JOIN public.conversations c ON c.company_id=m.company_id AND c.id=m.conversation_id
 WHERE c.company_id=NEW.company_id AND c.lead_id=l.id AND m.direction IN ('incoming','inbound') AND m.sender_type IN ('client','lead') AND m.id<>NEW.id AND m.created_at<NEW.created_at;
 IF NEW.created_at-coalesce(previous_contact,CASE WHEN l.last_contact_at<NEW.created_at THEN l.last_contact_at END,l.created_at)>=interval '30 days' THEN
  INSERT INTO public.crm_metric_events(company_id,lead_id,broker_id,kind,occurred_at,source_key)
   VALUES(NEW.company_id,l.id,broker,'recovered',NEW.created_at,'recovered:'||NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER track_recovered_lead AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.track_recovered_lead();

CREATE TABLE public.property_deals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 property_id uuid NOT NULL, broker_id uuid NOT NULL, lead_id uuid,
 broker text NOT NULL, property text NOT NULL, client text NOT NULL,
 sale_date date NOT NULL, amount numeric(14,2) NOT NULL CHECK(amount>0), deal_type text NOT NULL CHECK(deal_type IN ('Venda','Aluguel')),
 previous_status text NOT NULL, previous_lead_status text, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 cancelled_at timestamptz, cancelled_by uuid,
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES public.broker_accounts(company_id,id),
 FOREIGN KEY(company_id,cancelled_by) REFERENCES public.broker_accounts(company_id,id)
);
CREATE INDEX property_deals_month_idx ON public.property_deals(company_id,sale_date) WHERE cancelled_at IS NULL;
CREATE INDEX property_deals_property_idx ON public.property_deals(company_id,property_id);
CREATE INDEX property_deals_lead_idx ON public.property_deals(company_id,lead_id) WHERE lead_id IS NOT NULL;
ALTER TABLE public.property_deals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_deals FROM anon,authenticated;
ALTER TABLE public.properties ADD COLUMN last_deal_id uuid;
CREATE FUNCTION public.clear_manual_property_deal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND NEW.last_deal_id IS NOT DISTINCT FROM OLD.last_deal_id THEN NEW.last_deal_id=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clear_manual_property_deal BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.clear_manual_property_deal();
CREATE TABLE public.cancelled_legacy_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 legacy_sale_id uuid NOT NULL, sale_snapshot jsonb NOT NULL, cancelled_at timestamptz NOT NULL DEFAULT now(), cancelled_by uuid NOT NULL,
 UNIQUE(company_id,legacy_sale_id), FOREIGN KEY(company_id,cancelled_by) REFERENCES public.broker_accounts(company_id,id)
);
ALTER TABLE public.cancelled_legacy_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cancelled_legacy_sales FROM anon,authenticated;

CREATE FUNCTION public.record_property_deal(p_company_id uuid,p_actor_id uuid,p_property_id uuid,p_broker_id uuid,p_lead_id uuid,p_date date,p_amount numeric,p_deal_type text,p_client text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.broker_accounts; b public.broker_accounts; p public.properties; l public.leads; d public.property_deals;
BEGIN
 SELECT * INTO a FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
 SELECT * INTO b FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_broker_id AND active;
 IF a.id IS NULL OR b.id IS NULL OR (a.role<>'owner' AND a.id<>b.id) THEN RAISE EXCEPTION 'deal_forbidden'; END IF;
 SELECT * INTO p FROM public.properties WHERE company_id=p_company_id AND id=p_property_id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'property_not_found'; END IF;
 IF public.match_normalize(coalesce(p.status,'Disponível')) NOT IN ('disponivel','available','reservado','reservada','reserved') THEN RAISE EXCEPTION 'property_unavailable'; END IF;
 IF p_deal_type NOT IN ('Venda','Aluguel') OR public.match_normalize(coalesce(p.purpose,'Venda')) <> public.match_normalize(p_deal_type) THEN RAISE EXCEPTION 'deal_purpose_mismatch'; END IF;
 IF p_date IS NULL OR p_date> (now() AT TIME ZONE 'America/Sao_Paulo')::date OR p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'deal_invalid'; END IF;
 IF p_lead_id IS NOT NULL THEN
  SELECT * INTO l FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
 END IF;
 IF nullif(btrim(coalesce(l.name,p_client)),'') IS NULL THEN RAISE EXCEPTION 'deal_invalid'; END IF;
 INSERT INTO public.property_deals(company_id,property_id,broker_id,lead_id,broker,property,client,sale_date,amount,deal_type,previous_status,previous_lead_status,created_by)
 VALUES(p_company_id,p.id,b.id,l.id,b.name,p.title,coalesce(l.name,btrim(p_client)),p_date,p_amount,p_deal_type,coalesce(p.status,'Disponível'),l.lifecycle_status,a.id) RETURNING * INTO d;
 UPDATE public.properties SET status=CASE WHEN p_deal_type='Aluguel' THEN 'Alugado' ELSE 'Vendido' END,last_deal_id=d.id WHERE company_id=p_company_id AND id=p.id;
 IF l.id IS NOT NULL THEN
  -- The first deal owns the baseline. Later deals carry it forward, so either
  -- cancellation order can restore the user's stage once the final deal ends.
  UPDATE public.leads SET lifecycle_status='Convertido',last_deal_id=d.id,
   deal_restore_status=CASE WHEN l.last_deal_id IS NULL THEN coalesce(l.lifecycle_status,'Novo') ELSE coalesce(l.deal_restore_status,l.lifecycle_status,'Novo') END
   WHERE company_id=p_company_id AND id=l.id;
 END IF;
 RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.cancel_property_deal(p_company_id uuid,p_actor_id uuid,p_deal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.property_deals; l public.leads; remaining_deal uuid; changed integer:=0; lead_restored boolean:=false;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'deal_forbidden'; END IF;
 SELECT * INTO d FROM public.property_deals WHERE company_id=p_company_id AND id=p_deal_id FOR UPDATE;
 IF d.id IS NULL THEN RETURN NULL; END IF;
 IF d.cancelled_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'alreadyCancelled',true,'propertyRestored',false); END IF;
 UPDATE public.property_deals SET cancelled_at=now(),cancelled_by=p_actor_id WHERE id=d.id AND company_id=p_company_id;
 -- Only undo the status owned by this exact deal, not a newer deal or edit.
 UPDATE public.properties SET status=d.previous_status,last_deal_id=NULL
 WHERE company_id=p_company_id AND id=d.property_id AND last_deal_id=d.id
 AND status=CASE WHEN d.deal_type='Aluguel' THEN 'Alugado' ELSE 'Vendido' END;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF d.lead_id IS NOT NULL THEN
  SELECT * INTO l FROM public.leads WHERE company_id=p_company_id AND id=d.lead_id FOR UPDATE;
  IF l.last_deal_id=d.id AND l.lifecycle_status='Convertido' THEN
   SELECT id INTO remaining_deal FROM public.property_deals WHERE company_id=p_company_id AND lead_id=d.lead_id AND cancelled_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 1;
   IF remaining_deal IS NOT NULL THEN
    UPDATE public.leads SET last_deal_id=remaining_deal WHERE company_id=p_company_id AND id=l.id;
   ELSE
    UPDATE public.leads SET lifecycle_status=coalesce(l.deal_restore_status,d.previous_lead_status,'Novo'),last_deal_id=NULL,deal_restore_status=NULL WHERE company_id=p_company_id AND id=l.id;
    lead_restored:=true;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'propertyRestored',changed=1,'leadRestored',lead_restored,'warning',CASE WHEN changed=0 THEN 'Negócio cancelado. O imóvel teve outra alteração e sua situação foi preservada.' END);
END $$;

CREATE FUNCTION public.performance_crm_month(p_company_id uuid,p_actor_id uuid,p_month text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE start_at timestamptz; end_at timestamptz; result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active) THEN RAISE EXCEPTION 'performance_forbidden'; END IF;
 IF p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'invalid_month'; END IF;
 start_at:=(p_month||'-01')::timestamp AT TIME ZONE 'America/Sao_Paulo';
 end_at:=(((p_month||'-01')::date+interval '1 month')::timestamp AT TIME ZONE 'America/Sao_Paulo');
 WITH converted AS (
  SELECT lead_id,broker_id,occurred_at FROM public.crm_metric_events WHERE company_id=p_company_id AND kind='converted'
  UNION ALL SELECT lead_id,broker_id,sale_date::timestamp AT TIME ZONE 'America/Sao_Paulo' FROM public.property_deals WHERE company_id=p_company_id AND cancelled_at IS NULL AND lead_id IS NOT NULL
 ), received AS (SELECT * FROM public.crm_metric_events WHERE company_id=p_company_id AND kind='received' AND occurred_at>=start_at AND occurred_at<end_at),
 recovered AS (SELECT * FROM public.crm_metric_events WHERE company_id=p_company_id AND kind='recovered' AND occurred_at>=start_at AND occurred_at<end_at),
 groups AS (SELECT NULL::uuid broker_id UNION ALL SELECT id FROM public.broker_accounts WHERE company_id=p_company_id),
 metrics AS (SELECT g.broker_id,
  (SELECT count(DISTINCT lead_id) FROM received WHERE g.broker_id IS NULL OR broker_id=g.broker_id) leads_received,
  (SELECT count(DISTINCT lead_id) FROM converted WHERE occurred_at>=start_at AND occurred_at<end_at AND (g.broker_id IS NULL OR broker_id=g.broker_id)) converted_leads,
  (SELECT count(DISTINCT lead_id) FROM recovered WHERE g.broker_id IS NULL OR broker_id=g.broker_id) recovered_leads,
  (SELECT count(*) FROM public.appointments WHERE company_id=p_company_id AND scheduled_at>=start_at AND scheduled_at<end_at AND status NOT IN ('Cancelada','Cancelado') AND (g.broker_id IS NULL OR assigned_broker_id=g.broker_id)) visits,
  (SELECT count(DISTINCT r.lead_id) FROM received r WHERE (g.broker_id IS NULL OR r.broker_id=g.broker_id) AND EXISTS(SELECT 1 FROM converted c WHERE c.lead_id=r.lead_id AND c.occurred_at<end_at)) cohort_converted
 FROM groups g)
 SELECT jsonb_build_object('metrics',coalesce(jsonb_agg(to_jsonb(metrics)),'[]'::jsonb)) INTO result FROM metrics;
 RETURN result || jsonb_build_object('trackingStartedAt',(SELECT started_at FROM public.crm_metric_tracking LIMIT 1));
END $$;

REVOKE ALL ON FUNCTION public.remember_broker_name(),public.resolve_assigned_broker(),public.clear_manual_lead_deal(),public.track_lead_metrics(),public.track_recovered_lead(),public.clear_manual_property_deal() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_property_deal(uuid,uuid,uuid,uuid,uuid,date,numeric,text,text),public.cancel_property_deal(uuid,uuid,uuid),public.performance_crm_month(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_property_deal(uuid,uuid,uuid,uuid,uuid,date,numeric,text,text),public.cancel_property_deal(uuid,uuid,uuid),public.performance_crm_month(uuid,uuid,text) TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.broker_name_history,public.crm_metric_events,public.crm_metric_tracking,public.property_deals,public.cancelled_legacy_sales TO service_role;
COMMIT;
