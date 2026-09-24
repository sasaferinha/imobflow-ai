BEGIN;
CREATE OR REPLACE FUNCTION public.score_property_match(l public.leads,p public.properties)
RETURNS TABLE(score int,reasons jsonb) LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE q jsonb:=public.lead_match_profile(l); objective text;
BEGIN
 objective:=CASE WHEN public.match_normalize(l.goal) IN ('investir','investimento') THEN 'Venda' ELSE q->>'purpose' END;
 IF l.company_id IS DISTINCT FROM p.company_id OR l.lifecycle_status IS NULL OR l.lifecycle_status IN ('Convertido','Perdido')
 OR p.status IS DISTINCT FROM 'Disponível' OR objective IS NULL OR objective IS DISTINCT FROM p.purpose
 OR public.match_normalize(q->>'propertyType') IN ('','nao informado')
 OR public.match_normalize(q->>'propertyType')<>public.match_normalize(p.property_type)
 OR (q->>'budgetMax')::numeric IS NULL OR (q->>'budgetMax')::numeric<=0
 OR p.price IS NULL OR p.price<=0 OR p.price>(q->>'budgetMax')::numeric THEN RETURN; END IF;
 -- City disambiguates the desired region when the customer supplied it.
 IF public.match_normalize(q->>'city') NOT IN ('','nao informado')
 AND public.match_normalize(q->>'city')<>public.match_normalize(p.city) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(q->'regions','[]')) r
 WHERE public.match_normalize(r) NOT IN ('','nao informado') AND public.match_normalize(r)=public.match_normalize(p.district)) THEN RETURN; END IF;
 RETURN QUERY SELECT 100,jsonb_build_array('Objetivo compatível',p.property_type,p.city||' · '||p.district,'Dentro do orçamento');
END $$;

CREATE OR REPLACE FUNCTION public.generate_property_opportunities(p_company_id uuid,p_property_id uuid,p_inactive_days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.properties%ROWTYPE; inserted_count int;
BEGIN
 SELECT * INTO p FROM public.properties WHERE company_id=p_company_id AND id=p_property_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 UPDATE public.opportunities o SET status=CASE WHEN l.lifecycle_status='Convertido' THEN 'converted' ELSE 'expired' END,updated_at=now()
 FROM public.leads l WHERE o.company_id=p_company_id AND o.property_id=p.id AND l.id=o.lead_id AND l.company_id=o.company_id
 AND o.status IN ('open','contacted') AND NOT EXISTS(SELECT 1 FROM public.score_property_match(l,p) m WHERE m.score>=75);
 IF p.status IS DISTINCT FROM 'Disponível' THEN RETURN 0; END IF;
 WITH inserted AS (
 INSERT INTO public.opportunities(company_id,lead_id,property_id,assigned_broker_id,match_score,reasons)
 SELECT p_company_id,l.id,p.id,b.id,m.score,m.reasons FROM public.leads l
 CROSS JOIN LATERAL public.score_property_match(l,p) m
 LEFT JOIN LATERAL (SELECT id FROM public.broker_accounts WHERE company_id=p_company_id AND name=l.assigned_to AND active ORDER BY id LIMIT 1) b ON true
 WHERE l.company_id=p_company_id AND m.score>=75
 AND NOT EXISTS(SELECT 1 FROM public.lead_property_events e WHERE e.company_id=p_company_id AND e.lead_id=l.id AND e.property_id=p.id AND e.event_type='Enviado')
 ON CONFLICT(company_id,lead_id,property_id) DO NOTHING RETURNING id
 ) SELECT count(*) INTO inserted_count FROM inserted;
 UPDATE public.opportunities o SET match_score=m.score,reasons=m.reasons,updated_at=now()
 FROM public.leads l CROSS JOIN LATERAL public.score_property_match(l,p) m
 WHERE o.company_id=p_company_id AND o.property_id=p.id AND o.lead_id=l.id AND l.company_id=p_company_id AND o.status IN ('open','contacted');
 INSERT INTO public.opportunity_notifications(company_id,opportunity_id)
 SELECT p_company_id,id FROM public.opportunities WHERE company_id=p_company_id AND property_id=p.id AND status='open' AND match_score>=90 ON CONFLICT DO NOTHING;
 RETURN inserted_count;
END $$;
UPDATE public.opportunity_sweeps SET cursor=NULL,complete=false;
COMMIT;
