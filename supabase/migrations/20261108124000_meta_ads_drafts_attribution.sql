BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.meta_ads_build_requests (
 company_id uuid NOT NULL REFERENCES public.account_companies(company_id), request_id uuid NOT NULL, actor_id uuid NOT NULL,
 account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]{3,30}$'), request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','complete','uncertain')), step text NOT NULL DEFAULT 'adset',
 campaign_id text NOT NULL CHECK(campaign_id ~ '^[0-9]{3,30}$'), adset_id text, creative_id text, ad_id text,
 name text NOT NULL, error_message text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,request_id), FOREIGN KEY(company_id,actor_id) REFERENCES public.broker_accounts(company_id,id)
);
CREATE TABLE public.lead_ad_attributions (
 company_id uuid NOT NULL REFERENCES public.companies(id), lead_id uuid NOT NULL,
 source text NOT NULL CHECK(length(source)<=100), medium text NOT NULL CHECK(length(medium)<=100),
 campaign text NOT NULL CHECK(length(campaign)<=150), content text NOT NULL CHECK(length(content)<=150), term text NOT NULL CHECK(length(term)<=150),
 campaign_id text CHECK(campaign_id ~ '^[0-9]{3,40}$'), ad_id text CHECK(ad_id ~ '^[0-9]{3,40}$'),
 captured_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,lead_id),
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id) ON DELETE CASCADE
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meta_ads_build_requests','lead_ad_attributions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY meta_ads_server_only ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)',t);
 END LOOP;
END $$;
CREATE FUNCTION public.capture_lead_ad_attribution()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb:=NEW.interest_profile->'websiteAttribution';
BEGIN
 IF a IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(a)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(a))<>7
  OR jsonb_typeof(a->'source') IS DISTINCT FROM 'string' OR length(a->>'source')>100
  OR jsonb_typeof(a->'medium') IS DISTINCT FROM 'string' OR length(a->>'medium')>100
  OR jsonb_typeof(a->'campaign') IS DISTINCT FROM 'string' OR length(a->>'campaign')>150
  OR jsonb_typeof(a->'content') IS DISTINCT FROM 'string' OR length(a->>'content')>150
  OR jsonb_typeof(a->'term') IS DISTINCT FROM 'string' OR length(a->>'term')>150
  OR NOT(a ? 'campaignId') OR NOT(a ? 'adId')
  OR ((a->>'campaignId') IS NOT NULL AND (a->>'campaignId') !~ '^[0-9]{3,40}$')
  OR ((a->>'adId') IS NOT NULL AND (a->>'adId') !~ '^[0-9]{3,40}$') THEN RAISE EXCEPTION 'ads_invalid_attribution'; END IF;
 INSERT INTO public.lead_ad_attributions(company_id,lead_id,source,medium,campaign,content,term,campaign_id,ad_id)
 VALUES(NEW.company_id,NEW.id,a->>'source',a->>'medium',a->>'campaign',a->>'content',a->>'term',a->>'campaignId',a->>'adId') ON CONFLICT(company_id,lead_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_lead_ad_attribution AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.capture_lead_ad_attribution();
REVOKE ALL ON FUNCTION public.capture_lead_ad_attribution() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.claim_meta_ads_build(p_company_id uuid,p_actor_id uuid,p_request_id uuid,p_account_id text,p_hash text,p_campaign_id text,p_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inserted uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') OR NOT EXISTS(SELECT 1 FROM public.meta_ads_connections WHERE company_id=p_company_id AND account_id=p_account_id) THEN RAISE EXCEPTION 'ads_forbidden'; END IF;
 INSERT INTO public.meta_ads_build_requests(company_id,request_id,actor_id,account_id,request_hash,campaign_id,name)
 VALUES(p_company_id,p_request_id,p_actor_id,p_account_id,p_hash,p_campaign_id,left(p_name,150)) ON CONFLICT(company_id,request_id) DO NOTHING RETURNING request_id INTO inserted;
 RETURN inserted IS NOT NULL;
END $$;

-- Private inputs for the administrative aggregate. No names, contact details,
-- raw notes or unrelated workspace records are returned to the application.
CREATE FUNCTION public.meta_ads_attribution_inputs(p_company_id uuid,p_actor_id uuid,p_since timestamptz,p_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc jsonb; attributes jsonb; sales jsonb; total integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'ads_forbidden'; END IF;
 IF p_since IS NULL OR p_until IS NULL OR p_until<=p_since OR p_until-p_since>interval '367 days' THEN RAISE EXCEPTION 'ads_invalid_period'; END IF;
 SELECT document INTO doc FROM public.crm_evolution_workspaces WHERE company_id=p_company_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('leadId',lead_id,'source',source,'medium',medium,'campaign',campaign,'campaignId',campaign_id,'adId',ad_id,'capturedAt',captured_at)),'[]'::jsonb) INTO attributes FROM (SELECT * FROM public.lead_ad_attributions WHERE company_id=p_company_id ORDER BY captured_at DESC LIMIT 10001) q;
 SELECT count(*) INTO total FROM public.leads WHERE company_id=p_company_id AND created_at>=p_since AND created_at<p_until;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->>'id','leadId',r#>>'{data,leadId}','closedAt',coalesce((SELECT max(e->>'at') FROM jsonb_array_elements(coalesce(doc->'events','[]'::jsonb)) e WHERE e->>'recordId'=r->>'id' AND e#>>'{changes,status,to}'='Ganho'),r#>>'{data,closedAt}'),
  'amount',(SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(p#>'{data,amount}'))->0 ELSE NULL END FROM jsonb_array_elements(coalesce(doc->'records','[]'::jsonb)) p WHERE p->>'kind'='proposals' AND p#>>'{data,caseId}'=r->>'id' AND p#>>'{data,status}'='Aceita' AND p#>>'{data,propertyId}'=r#>>'{data,propertyId}'))),'[]'::jsonb) INTO sales
 FROM (SELECT value r FROM jsonb_array_elements(coalesce(doc->'records','[]'::jsonb)) WHERE value->>'kind'='cases' AND value#>>'{data,status}'='Ganho' AND value#>>'{data,purpose}'='Venda' AND coalesce(value#>>'{data,journey}','')<>'Captação' LIMIT 10001) q;
 RETURN jsonb_build_object('attributions',attributes,'sales',sales,'totalLeads',total);
END $$;
REVOKE ALL ON FUNCTION public.claim_meta_ads_build(uuid,uuid,uuid,text,text,text,text),public.meta_ads_attribution_inputs(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meta_ads_build(uuid,uuid,uuid,text,text,text,text),public.meta_ads_attribution_inputs(uuid,uuid,timestamptz,timestamptz) TO service_role;
COMMIT;
