-- Core Basic: structured preferences, deterministic matches and manual handoff.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS interest_profile jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.leads ADD CONSTRAINT leads_interest_profile_object CHECK(jsonb_typeof(interest_profile)='object');
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS match_features text[] NOT NULL DEFAULT '{}';
CREATE FUNCTION public.match_normalize(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public
AS $$ SELECT lower(translate(btrim(coalesce(t,'')), 'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')) $$;

-- Legacy commercial fields remain the source for existing forms/imports.
CREATE FUNCTION public.lead_match_profile(l public.leads) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'purpose',CASE WHEN match_normalize(l.goal) IN ('comprar','compra','venda') THEN 'Venda' WHEN match_normalize(l.goal) IN ('alugar','aluguel','locacao') THEN 'Aluguel' END,
  'propertyType',CASE WHEN public.match_normalize(l.property_type) NOT IN ('','nao informado','null','undefined','-') THEN l.property_type ELSE l.interest_profile->>'propertyType' END,'city',l.interest_profile->>'city',
  'regions',CASE WHEN public.match_normalize(l.region) NOT IN ('','nao informado','null','undefined','-') THEN to_jsonb(regexp_split_to_array(l.region,'\s*[,;/]\s*')) ELSE l.interest_profile->'regions' END,
  'budgetMax',l.budget_max,
  'bedrooms',coalesce(l.interest_profile->'bedrooms',to_jsonb(l.bedrooms)),
  'parkingSpaces',coalesce(l.interest_profile->'parkingSpaces',to_jsonb(l.parking_spaces)),
  'features',coalesce(l.interest_profile->'features','[]'::jsonb)))
$$;

CREATE INDEX leads_match_candidates ON public.leads(company_id,property_type,budget_max)
 WHERE lifecycle_status NOT IN ('Convertido','Perdido');
CREATE INDEX leads_match_city ON public.leads(company_id,public.match_normalize(interest_profile->>'city'));
CREATE INDEX properties_match_available ON public.properties(company_id,id) WHERE status='Disponível';
CREATE UNIQUE INDEX leads_company_identity ON public.leads(company_id,id);
CREATE UNIQUE INDEX properties_company_identity ON public.properties(company_id,id);
CREATE UNIQUE INDEX brokers_company_identity ON public.broker_accounts(company_id,id);
CREATE UNIQUE INDEX conversations_company_identity ON public.conversations(company_id,id);

CREATE TABLE public.opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 lead_id uuid NOT NULL, property_id uuid NOT NULL, assigned_broker_id uuid,
 match_score int NOT NULL CHECK(match_score BETWEEN 75 AND 100),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','contacted','dismissed','converted','expired')),
 reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array'), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,lead_id,property_id), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,property_id) REFERENCES public.properties(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,assigned_broker_id) REFERENCES public.broker_accounts(company_id,id)
);
CREATE INDEX opportunities_inbox ON public.opportunities(company_id,status,match_score DESC,created_at,id);
CREATE INDEX opportunities_property_fk ON public.opportunities(company_id,property_id);
CREATE INDEX opportunities_broker_fk ON public.opportunities(company_id,assigned_broker_id) WHERE assigned_broker_id IS NOT NULL;
CREATE TABLE public.opportunity_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, opportunity_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,opportunity_id), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,opportunity_id) REFERENCES public.opportunities(company_id,id) ON DELETE CASCADE
);
CREATE TABLE public.opportunity_notification_reads (
 company_id uuid NOT NULL, notification_id uuid NOT NULL,
 broker_id uuid NOT NULL, read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(notification_id,broker_id),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,notification_id) REFERENCES public.opportunity_notifications(company_id,id) ON DELETE CASCADE
);
CREATE INDEX opportunity_reads_broker_fk ON public.opportunity_notification_reads(company_id,broker_id);
CREATE INDEX opportunity_reads_notification_fk ON public.opportunity_notification_reads(company_id,notification_id);
CREATE TABLE public.opportunity_sweeps (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id), day date NOT NULL, cursor uuid, complete boolean NOT NULL DEFAULT false
);

-- One source of scoring for events, sweeps, expiry and opening a draft.
CREATE FUNCTION public.score_property_match(l public.leads,p public.properties)
RETURNS TABLE(score int,reasons jsonb) LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE q jsonb:=public.lead_match_profile(l); region_match boolean; features_ok boolean; points int; price_points int; feature_count int;
BEGIN
 IF l.company_id IS DISTINCT FROM p.company_id OR l.lifecycle_status IS NULL OR l.lifecycle_status IN ('Convertido','Perdido')
 OR p.status IS DISTINCT FROM 'Disponível'
 OR q->>'purpose' IS NULL OR q->>'purpose' IS DISTINCT FROM p.purpose
 OR coalesce(q->>'propertyType','') IN ('','Não informado') OR public.match_normalize(q->>'propertyType')<>public.match_normalize(p.property_type)
 OR coalesce(q->>'city','')='' OR public.match_normalize(q->>'city')<>public.match_normalize(p.city)
 OR (q->>'budgetMax')::numeric IS NULL OR (q->>'budgetMax')::numeric<=0 OR p.price IS NULL OR p.price<=0 OR p.price>(q->>'budgetMax')::numeric
 OR (q->>'bedrooms')::int IS NULL OR p.bedrooms IS NULL OR p.bedrooms<(q->>'bedrooms')::int THEN RETURN; END IF;
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(q->'regions','[]')) r WHERE public.match_normalize(r)=public.match_normalize(p.district)) INTO region_match;
 IF NOT region_match THEN RETURN; END IF;
 IF q ? 'parkingSpaces' AND (p.parking_spaces IS NULL OR p.parking_spaces<(q->>'parkingSpaces')::int) THEN RETURN; END IF;
 SELECT jsonb_array_length(coalesce(q->'features','[]')) INTO feature_count;
 SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(q->'features','[]')) f
 WHERE NOT EXISTS(SELECT 1 FROM unnest(p.match_features) v WHERE public.match_normalize(v)=public.match_normalize(f))) INTO features_ok;
 -- Unknown additional preferences do not earn points. A weak score isn't an opportunity.
 price_points:=CASE WHEN p.price<=(q->>'budgetMax')::numeric*0.90 THEN 30 ELSE 24 END;
 points:=price_points+25+20+10+(CASE WHEN q ? 'parkingSpaces' THEN 10 ELSE 0 END)+(CASE WHEN feature_count=0 OR features_ok THEN 5 ELSE 0 END);
 RETURN QUERY SELECT points,jsonb_build_array('Dentro do orçamento',p.city||' · '||p.district,p.bedrooms||' quartos',p.property_type)
 || CASE WHEN q ? 'parkingSpaces' THEN jsonb_build_array(p.parking_spaces||' vagas') ELSE '[]'::jsonb END
 || CASE WHEN NOT features_ok THEN jsonb_build_array('Preferências adicionais precisam de confirmação') ELSE '[]'::jsonb END;
END $$;

CREATE FUNCTION public.generate_property_opportunities(p_company_id uuid,p_property_id uuid,p_inactive_days int DEFAULT 7)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.properties%ROWTYPE; inserted_count int;
BEGIN
 IF p_inactive_days NOT BETWEEN 1 AND 3650 THEN RAISE EXCEPTION 'invalid_inactive_days'; END IF;
 -- Serialize concurrent events/sweeps for this property for the whole transaction.
 SELECT * INTO p FROM public.properties WHERE company_id=p_company_id AND id=p_property_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 UPDATE public.opportunities o SET status=CASE WHEN l.lifecycle_status='Convertido' THEN 'converted' ELSE 'expired' END,updated_at=now()
 FROM public.leads l WHERE o.company_id=p_company_id AND o.property_id=p.id AND l.id=o.lead_id AND l.company_id=o.company_id
 AND o.status IN ('open','contacted') AND NOT EXISTS(SELECT 1 FROM public.score_property_match(l,p) m WHERE m.score>=75);
 IF p.status IS DISTINCT FROM 'Disponível' THEN RETURN 0; END IF;
 WITH candidates AS (
 SELECT l.*, public.lead_match_profile(l) AS profile FROM public.leads l
 WHERE l.company_id=p_company_id AND l.lifecycle_status NOT IN ('Convertido','Perdido')
 AND l.budget_max>=p.price AND public.match_normalize(l.property_type)=public.match_normalize(p.property_type)
 AND public.match_normalize(l.interest_profile->>'city')=public.match_normalize(p.city)
 AND public.lead_match_profile(l)->>'purpose'=p.purpose
 AND (public.lead_match_profile(l)->>'bedrooms')::int IS NOT NULL AND p.bedrooms>=(public.lead_match_profile(l)->>'bedrooms')::int
 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(public.lead_match_profile(l)->'regions','[]')) r
   WHERE public.match_normalize(r)=public.match_normalize(p.district))
 AND coalesce(l.last_contact_at,l.created_at)<=now()-make_interval(days=>p_inactive_days)
 ), inserted AS (
 INSERT INTO public.opportunities(company_id,lead_id,property_id,assigned_broker_id,match_score,reasons)
 SELECT p_company_id,l.id,p.id,b.id,m.score,m.reasons FROM candidates c
 JOIN public.leads l ON l.id=c.id AND l.company_id=p_company_id
 CROSS JOIN LATERAL public.score_property_match(l,p) m
 LEFT JOIN public.broker_accounts b ON b.company_id=p_company_id AND b.name=l.assigned_to AND b.active
 WHERE m.score>=75
 AND NOT EXISTS(SELECT 1 FROM public.lead_property_events e WHERE e.company_id=p_company_id AND e.lead_id=l.id AND e.property_id=p.id AND e.event_type='Enviado')
 ORDER BY coalesce(l.last_contact_at,l.created_at),m.score DESC,(b.id IS NOT NULL) DESC
 ON CONFLICT(company_id,lead_id,property_id) DO NOTHING RETURNING id,match_score
 ), notified AS (
 INSERT INTO public.opportunity_notifications(company_id,opportunity_id)
 SELECT p_company_id,id FROM inserted WHERE match_score>=90 ON CONFLICT DO NOTHING
  ) SELECT count(*) INTO inserted_count FROM inserted;
 INSERT INTO public.opportunity_notifications(company_id,opportunity_id)
 SELECT p_company_id,id FROM public.opportunities WHERE company_id=p_company_id AND property_id=p.id
 AND status='open' AND match_score>=90 ON CONFLICT DO NOTHING;
 RETURN inserted_count;
END $$;

-- Refresh display/assignment and invalidate drafts after lead/property edits.
CREATE FUNCTION public.refresh_open_opportunities() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.opportunities o SET
 status=CASE WHEN l.lifecycle_status='Convertido' THEN 'converted' WHEN m.score IS NULL OR m.score<75 THEN 'expired' ELSE o.status END,
 match_score=coalesce(m.score,o.match_score),reasons=coalesce(m.reasons,o.reasons),
 assigned_broker_id=(SELECT id FROM public.broker_accounts WHERE company_id=l.company_id AND name=l.assigned_to AND active LIMIT 1),updated_at=now()
 FROM public.leads l JOIN public.properties p ON p.company_id=l.company_id
 LEFT JOIN LATERAL public.score_property_match(l,p) m ON true
 WHERE o.company_id=NEW.company_id AND l.id=o.lead_id AND p.id=o.property_id
 AND ((TG_TABLE_NAME='leads' AND o.lead_id=NEW.id) OR (TG_TABLE_NAME='properties' AND o.property_id=NEW.id))
 AND o.status IN ('open','contacted');
 RETURN NEW;
END $$;
CREATE TRIGGER refresh_lead_opportunities AFTER UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.refresh_open_opportunities();
CREATE TRIGGER refresh_property_opportunities AFTER UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.refresh_open_opportunities();

CREATE FUNCTION public.sweep_opportunities(p_company_id uuid,p_inactive_days int DEFAULT 7,p_batch int DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.opportunity_sweeps%ROWTYPE; p record; n int:=0; generated int:=0; today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('opportunities:'||p_company_id::text,0)) THEN RETURN '{"busy":true,"complete":false}'::jsonb; END IF;
 INSERT INTO public.opportunity_sweeps(company_id,day) VALUES(p_company_id,today) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.opportunity_sweeps WHERE company_id=p_company_id FOR UPDATE;
 IF s.day<>today THEN s.cursor:=NULL;s.complete:=false; END IF;
 IF s.complete THEN RETURN '{"complete":true,"generated":0}'::jsonb; END IF;
 FOR p IN SELECT id FROM public.properties WHERE company_id=p_company_id AND (s.cursor IS NULL OR id>s.cursor) ORDER BY id LIMIT greatest(1,least(p_batch,100)) LOOP
   generated:=generated+public.generate_property_opportunities(p_company_id,p.id,p_inactive_days);s.cursor:=p.id;n:=n+1;
 END LOOP;
 s.complete:=NOT EXISTS(SELECT 1 FROM public.properties WHERE company_id=p_company_id AND (s.cursor IS NULL OR id>s.cursor));
 UPDATE public.opportunity_sweeps SET day=today,cursor=s.cursor,complete=s.complete WHERE company_id=p_company_id;
 RETURN jsonb_build_object('complete',s.complete,'generated',generated,'processed',n);
END $$;

-- Same access rule for list, notifications, state transitions and preparing drafts.
CREATE FUNCTION public.can_access_opportunity(p_company_id uuid,p_broker_id uuid,p_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.broker_accounts b JOIN public.leads l ON l.company_id=b.company_id
 WHERE b.company_id=p_company_id AND b.id=p_broker_id AND b.active AND l.id=p_lead_id
 AND (b.role='owner' OR l.assigned_to=b.name OR nullif(btrim(l.assigned_to),'') IS NULL))
$$;
CREATE FUNCTION public.list_opportunities(p_company_id uuid,p_broker_id uuid,p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(row_data),'[]') FROM (
 SELECT jsonb_build_object('id',o.id,'leadId',l.id,'propertyId',p.id,'leadName',l.name,'propertyTitle',p.title,
 'city',p.city,'district',p.district,'price',p.price,'bedrooms',p.bedrooms,'parkingSpaces',p.parking_spaces,
 'score',o.match_score,'status',o.status,'reasons',o.reasons,'assignedTo',l.assigned_to,
 'inactivityDays',greatest(0,extract(day from now()-coalesce(l.last_contact_at,l.created_at))::int),
 'notificationId',n.id,'unread',n.id IS NOT NULL AND nr.notification_id IS NULL) AS row_data
 FROM public.opportunities o JOIN public.leads l ON l.company_id=o.company_id AND l.id=o.lead_id
 JOIN public.properties p ON p.company_id=o.company_id AND p.id=o.property_id
 LEFT JOIN public.opportunity_notifications n ON n.company_id=o.company_id AND n.opportunity_id=o.id
 LEFT JOIN public.opportunity_notification_reads nr ON nr.company_id=o.company_id AND nr.notification_id=n.id AND nr.broker_id=p_broker_id
 WHERE o.company_id=p_company_id AND o.status IN ('open','contacted') AND public.can_access_opportunity(p_company_id,p_broker_id,l.id)
 ORDER BY coalesce(l.last_contact_at,l.created_at),(o.assigned_broker_id=p_broker_id) DESC,o.match_score DESC,o.id LIMIT 50 OFFSET greatest(0,p_offset)
 ) page
$$;
CREATE FUNCTION public.opportunity_action(p_company_id uuid,p_broker_id uuid,p_id uuid,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.opportunities%ROWTYPE;l public.leads%ROWTYPE;p public.properties%ROWTYPE;m record;
BEGIN
 SELECT * INTO o FROM public.opportunities WHERE id=p_id AND company_id=p_company_id;
 IF NOT FOUND OR NOT public.can_access_opportunity(p_company_id,p_broker_id,o.lead_id) THEN RAISE EXCEPTION 'opportunity_not_found'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=o.lead_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO p FROM public.properties WHERE id=o.property_id AND company_id=p_company_id FOR UPDATE;
 SELECT * INTO o FROM public.opportunities WHERE id=p_id AND company_id=p_company_id FOR UPDATE;
 IF NOT public.can_access_opportunity(p_company_id,p_broker_id,l.id) OR o.status NOT IN ('open','contacted') THEN RAISE EXCEPTION 'opportunity_unavailable'; END IF;
 IF p_action='read' THEN
 INSERT INTO public.opportunity_notification_reads(company_id,notification_id,broker_id)
 SELECT p_company_id,id,p_broker_id FROM public.opportunity_notifications WHERE company_id=p_company_id AND opportunity_id=o.id ON CONFLICT DO NOTHING;
 RETURN '{"ok":true}';
 END IF;
 IF p_action='dismissed' THEN UPDATE public.opportunities SET status='dismissed',updated_at=now() WHERE id=o.id;RETURN '{"ok":true}'; END IF;
 SELECT * INTO m FROM public.score_property_match(l,p);
 IF m.score IS NULL OR m.score<75 THEN RAISE EXCEPTION 'opportunity_unavailable'; END IF;
 IF p_action IN ('contacted','converted') THEN UPDATE public.opportunities SET status=p_action,updated_at=now() WHERE id=o.id;RETURN '{"ok":true}'; END IF;
 IF p_action<>'draft' THEN RAISE EXCEPTION 'invalid_action'; END IF;
 -- Returning a draft is never recorded as a provider send or a contacted lead.
 RETURN jsonb_build_object('phone',l.phone,'name',l.name,'title',p.title,'district',p.district,'city',p.city,'price',p.price,'bedrooms',p.bedrooms,'purpose',p.purpose);
END $$;

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_sweeps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opportunities,public.opportunity_notifications,public.opportunity_notification_reads,public.opportunity_sweeps FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.match_normalize(text), public.lead_match_profile(public.leads), public.score_property_match(public.leads,public.properties),public.refresh_open_opportunities(),public.can_access_opportunity(uuid,uuid,uuid),public.generate_property_opportunities(uuid,uuid,int),public.sweep_opportunities(uuid,int,int),public.list_opportunities(uuid,uuid,int),public.opportunity_action(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generate_property_opportunities(uuid,uuid,int),public.sweep_opportunities(uuid,int,int),public.list_opportunities(uuid,uuid,int),public.opportunity_action(uuid,uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
