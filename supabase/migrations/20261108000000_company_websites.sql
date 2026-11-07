BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.company_websites (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id),
  version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
  draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object' AND octet_length(draft::text)<=65536),
  published jsonb CHECK(published IS NULL OR jsonb_typeof(published)='object'),
  previous jsonb CHECK(previous IS NULL OR jsonb_typeof(previous)='object'),
  published_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL, updated_role text NOT NULL CHECK(updated_role IN ('owner','marketing')),
  CHECK((published IS NULL)=(published_at IS NULL))
);
CREATE TABLE public.website_marketing_accounts (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK(length(email) BETWEEN 3 AND 160),
  email_key text NOT NULL UNIQUE CHECK(email_key=lower(btrim(email_key))),
  password_hash text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  UNIQUE(company_id,id), FOREIGN KEY(company_id,created_by) REFERENCES public.broker_accounts(company_id,id)
);
CREATE TABLE public.website_marketing_sessions (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES public.website_marketing_accounts(id),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '12 hours',
  created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>created_at)
);
CREATE INDEX website_marketing_company ON public.website_marketing_accounts(company_id);
CREATE INDEX website_marketing_session_account ON public.website_marketing_sessions(account_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['company_websites','website_marketing_accounts','website_marketing_sessions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role',t);
    EXECUTE format('CREATE POLICY website_server_only ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)',t);
  END LOOP;
END $$;

CREATE FUNCTION public.website_can_edit(p_company_id uuid,p_actor_id uuid,p_actor_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.account_companies WHERE company_id=p_company_id)
 AND ((p_actor_role='owner' AND EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND role='owner' AND active))
 OR (p_actor_role='marketing' AND EXISTS(SELECT 1 FROM public.website_marketing_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active)))
$$;

CREATE FUNCTION public.save_company_website(p_company_id uuid,p_actor_id uuid,p_actor_role text,p_expected_version bigint,p_action text,p_content jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.company_websites%ROWTYPE;
BEGIN
  -- Serialize first creation and every mutation; recheck account after acquiring lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('website:'||p_company_id::text,0));
  IF NOT public.website_can_edit(p_company_id,p_actor_id,p_actor_role) THEN RAISE EXCEPTION 'website_forbidden' USING ERRCODE='42501'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<0 OR p_action IS NULL OR p_action NOT IN ('save','publish','unpublish','restore') THEN RAISE EXCEPTION 'website_invalid'; END IF;
  SELECT * INTO s FROM public.company_websites WHERE company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_version<>0 OR p_action NOT IN ('save','publish') THEN RAISE EXCEPTION 'website_conflict'; END IF;
    IF p_content IS NULL OR jsonb_typeof(p_content)<>'object' OR octet_length(p_content::text)>65536 THEN RAISE EXCEPTION 'website_invalid'; END IF;
    INSERT INTO public.company_websites(company_id,draft,updated_by,updated_role) VALUES(p_company_id,p_content,p_actor_id,p_actor_role) RETURNING * INTO s;
  END IF;
  IF s.version<>p_expected_version THEN RAISE EXCEPTION 'website_conflict'; END IF;
  IF p_action IN ('save','publish') THEN
    IF p_content IS NULL OR jsonb_typeof(p_content)<>'object' OR octet_length(p_content::text)>65536 THEN RAISE EXCEPTION 'website_invalid'; END IF;
    s.draft:=p_content;
  END IF;
  IF p_action='publish' THEN s.previous:=s.published; s.published:=s.draft; s.published_at:=clock_timestamp();
  ELSIF p_action='unpublish' THEN s.previous:=coalesce(s.published,s.previous); s.published:=NULL; s.published_at:=NULL;
  ELSIF p_action='restore' THEN
    IF s.previous IS NULL THEN RAISE EXCEPTION 'website_no_previous'; END IF;
    s.draft:=s.previous; s.previous:=s.published; s.published:=s.draft; s.published_at:=clock_timestamp();
  END IF;
  UPDATE public.company_websites SET version=version+1,draft=s.draft,published=s.published,previous=s.previous,published_at=s.published_at,
    updated_at=clock_timestamp(),updated_by=p_actor_id,updated_role=p_actor_role WHERE company_id=p_company_id RETURNING * INTO s;
  RETURN to_jsonb(s);
END $$;

CREATE FUNCTION public.manage_website_marketing(p_company_id uuid,p_actor_id uuid,p_action text,p_id uuid,p_name text,p_email text,p_password_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('website:'||p_company_id::text,0));
  IF NOT public.website_can_edit(p_company_id,p_actor_id,'owner') THEN RAISE EXCEPTION 'website_forbidden' USING ERRCODE='42501'; END IF;
  IF p_action='create' THEN
    IF p_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 OR p_email IS NULL OR length(p_email) NOT BETWEEN 3 AND 160
      OR p_password_hash IS NULL OR p_password_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'website_invalid'; END IF;
    INSERT INTO public.website_marketing_accounts(id,company_id,name,email,email_key,password_hash,created_by)
    VALUES(p_id,p_company_id,btrim(p_name),lower(btrim(p_email)),lower(btrim(p_email)),p_password_hash,p_actor_id);
  ELSIF p_action='deactivate' THEN
    UPDATE public.website_marketing_accounts SET active=false WHERE company_id=p_company_id AND id=p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'website_not_found'; END IF;
    DELETE FROM public.website_marketing_sessions WHERE account_id=p_id;
  ELSIF p_action='reset-password' THEN
    IF p_password_hash IS NULL OR p_password_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'website_invalid'; END IF;
    UPDATE public.website_marketing_accounts SET password_hash=p_password_hash WHERE company_id=p_company_id AND id=p_id AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'website_not_found'; END IF;
    DELETE FROM public.website_marketing_sessions WHERE account_id=p_id;
  ELSE RAISE EXCEPTION 'website_invalid'; END IF;
  RETURN true;
END $$;

CREATE FUNCTION public.issue_website_session(p_account_id uuid,p_expected_hash text,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.website_marketing_accounts a JOIN public.account_companies c ON c.company_id=a.company_id
    WHERE a.id=p_account_id AND a.active AND a.password_hash=p_expected_hash FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.website_marketing_sessions(token_hash,account_id) VALUES(p_token_hash,p_account_id);
  DELETE FROM public.website_marketing_sessions WHERE expires_at<=now();
  RETURN true;
END $$;
CREATE FUNCTION public.read_website_session(p_token_hash text)
RETURNS TABLE(id uuid,company_id uuid,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT a.id,a.company_id,a.name FROM public.website_marketing_sessions s JOIN public.website_marketing_accounts a ON a.id=s.account_id
    JOIN public.account_companies c ON c.company_id=a.company_id WHERE s.token_hash=p_token_hash AND s.expires_at>now() AND a.active
$$;
CREATE FUNCTION public.revoke_website_session(p_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ DELETE FROM public.website_marketing_sessions WHERE token_hash=p_token_hash $$;

-- A narrow projection keeps contact details, internal notes, owner details and
-- private addresses inside the CRM, including for the marketing editor.
CREATE FUNCTION public.website_catalog(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
WITH overlays AS (
 SELECT r FROM public.crm_evolution_workspaces w CROSS JOIN LATERAL jsonb_array_elements(w.document->'records') r
 WHERE w.company_id=p_company_id AND r->>'kind'='properties'
), catalog AS (
 SELECT p.id::text id,jsonb_build_object('id',p.id,'code',p.code,'title',p.title,'description',p.description,'purpose',p.purpose,'price',p.price,
  'district',p.district,'city',p.city,'property_type',p.property_type,'bedrooms',p.bedrooms,'parking_spaces',p.parking_spaces,'area',p.area,
  'images',p.images,'status',p.status,'features',coalesce((SELECT r->'data'->>'features' FROM overlays WHERE r->>'id'='property:'||p.id::text LIMIT 1),'')) item
 FROM public.properties p WHERE p.company_id=p_company_id AND p.status='Disponível'
 UNION ALL
 SELECT r->>'id',jsonb_build_object('id',r->>'id','code',r->'data'->>'code','title',r->'data'->>'name','description',r->'data'->>'description',
  'purpose',r->'data'->>'purpose','price',r->'data'->'price','district',r->'data'->>'district','city',r->'data'->>'city',
  'property_type',r->'data'->>'propertyType','bedrooms',r->'data'->'bedrooms','parking_spaces',r->'data'->'parkingSpaces','area',r->'data'->'area',
  'images',jsonb_build_array(r->'data'->>'photoUrl'),'status',r->'data'->>'status','features',r->'data'->>'features')
 FROM overlays WHERE NOT(r ? 'legacy') AND r->>'id' NOT LIKE 'property:%' AND r->'data'->>'status'='Disponível'
), bounded AS (SELECT * FROM catalog ORDER BY id LIMIT 10001)
SELECT coalesce(jsonb_agg(item ORDER BY id),'[]'::jsonb) FROM bounded
$$;

REVOKE ALL ON FUNCTION public.website_can_edit(uuid,uuid,text),public.save_company_website(uuid,uuid,text,bigint,text,jsonb),
 public.manage_website_marketing(uuid,uuid,text,uuid,text,text,text),public.issue_website_session(uuid,text,text),
 public.read_website_session(text),public.revoke_website_session(text),public.website_catalog(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.website_can_edit(uuid,uuid,text),public.save_company_website(uuid,uuid,text,bigint,text,jsonb),
 public.manage_website_marketing(uuid,uuid,text,uuid,text,text,text),public.issue_website_session(uuid,text,text),
 public.read_website_session(text),public.revoke_website_session(text),public.website_catalog(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
