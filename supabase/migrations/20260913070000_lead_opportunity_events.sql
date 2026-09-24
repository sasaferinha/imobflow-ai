BEGIN;
CREATE OR REPLACE FUNCTION public.generate_lead_opportunities_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate record;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF ROW(NEW.goal,NEW.property_type,NEW.region,NEW.budget_max,NEW.interest_profile,NEW.lifecycle_status)
      IS NOT DISTINCT FROM ROW(OLD.goal,OLD.property_type,OLD.region,OLD.budget_max,OLD.interest_profile,OLD.lifecycle_status) THEN RETURN NEW; END IF;
 END IF;
 IF NEW.lifecycle_status IN ('Convertido','Perdido') THEN RETURN NEW; END IF;
 FOR candidate IN SELECT p.id FROM public.properties p
   CROSS JOIN LATERAL public.score_property_match(NEW,p) m
   WHERE p.company_id=NEW.company_id AND p.status='Disponível' AND m.score>=75
   ORDER BY p.id
 LOOP
   PERFORM public.generate_property_opportunities(NEW.company_id,candidate.id,7);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.generate_lead_opportunities_after_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS generate_lead_opportunities ON public.leads;
CREATE TRIGGER generate_lead_opportunities AFTER INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.generate_lead_opportunities_after_change();
COMMIT;
