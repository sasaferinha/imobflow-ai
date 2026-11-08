BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.company_website_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  hostname text NOT NULL UNIQUE CHECK(hostname=lower(hostname) AND length(hostname) BETWEEN 4 AND 237 AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$'),
  ownership_token text NOT NULL CHECK(ownership_token ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','provisioning','active','error')),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  disabled_at timestamptz,
  ownership_verified_at timestamptz, tls_verified_at timestamptz, checked_at timestamptz,
  provider_project_id text, provider_verified boolean NOT NULL DEFAULT false, dns_valid boolean NOT NULL DEFAULT false,
  records jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(records)='array' AND octet_length(records::text)<=16384),
  message text NOT NULL DEFAULT 'Adicione o registro TXT para comprovar que este domínio pertence à sua imobiliária.' CHECK(length(message)<=500),
  check_id uuid, check_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  FOREIGN KEY(company_id,created_by) REFERENCES public.broker_accounts(company_id,id),
  CHECK(status<>'active' OR (disabled_at IS NULL AND ownership_verified_at IS NOT NULL AND tls_verified_at IS NOT NULL AND provider_verified AND dns_valid AND provider_project_id IS NOT NULL))
);
CREATE INDEX company_website_domains_company ON public.company_website_domains(company_id);
ALTER TABLE public.company_website_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_website_domains FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.company_website_domains TO service_role;
CREATE POLICY website_domains_server_only ON public.company_website_domains AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);

CREATE FUNCTION public.manage_website_domain(p_company_id uuid,p_actor_id uuid,p_action text,p_hostname text DEFAULT NULL,p_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL,p_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.company_website_domains%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('website-domains:'||p_company_id::text,0));
  IF NOT public.website_can_edit(p_company_id,p_actor_id,'owner') THEN RAISE EXCEPTION 'website_forbidden' USING ERRCODE='42501'; END IF;
  IF p_action='create' THEN
    IF p_hostname IS NULL OR p_hostname<>lower(p_hostname) OR length(p_hostname) NOT BETWEEN 4 AND 237 OR p_hostname !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$'
      OR p_hostname='imobflow.net.br' OR p_hostname LIKE '%.imobflow.net.br' OR p_hostname='vercel.app' OR p_hostname LIKE '%.vercel.app'
      OR p_hostname='vercel.com' OR p_hostname LIKE '%.vercel.com' OR p_hostname LIKE '%.supabase.co'
      OR p_hostname ~ '\.(localhost|local|localdomain|internal|intranet|lan|home|arpa|corp|test|invalid|example|onion)$'
      OR p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'website_domain_invalid'; END IF;
    IF EXISTS(SELECT 1 FROM public.company_website_domains WHERE hostname=p_hostname) THEN RAISE EXCEPTION 'website_domain_reserved'; END IF;
    IF (SELECT count(*) FROM public.company_website_domains WHERE company_id=p_company_id)>=3 THEN RAISE EXCEPTION 'website_domain_limit'; END IF;
    INSERT INTO public.company_website_domains(company_id,hostname,ownership_token,created_by) VALUES(p_company_id,p_hostname,p_token,p_actor_id) RETURNING * INTO d;
  ELSIF p_action IN ('disable','enable') THEN
    SELECT * INTO d FROM public.company_website_domains WHERE id=p_id AND company_id=p_company_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'website_not_found'; END IF;
    IF p_expected_version IS NULL OR d.version<>p_expected_version THEN RAISE EXCEPTION 'website_conflict'; END IF;
    UPDATE public.company_website_domains SET disabled_at=CASE WHEN p_action='disable' THEN clock_timestamp() ELSE NULL END,
      status='pending', ownership_verified_at=NULL,tls_verified_at=NULL,provider_verified=false,dns_valid=false,
      check_id=NULL,check_expires_at=NULL,version=version+1,updated_at=clock_timestamp(),
      message=CASE WHEN p_action='disable' THEN 'Desconectado do site. O conteúdo e os registros DNS foram preservados.' ELSE 'Verifique novamente a posse e a configuração para ativar o domínio.' END
      WHERE id=d.id RETURNING * INTO d;
  ELSE RAISE EXCEPTION 'website_domain_invalid'; END IF;
  RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.begin_website_domain_check(p_company_id uuid,p_actor_id uuid,p_id uuid,p_expected_version bigint,p_check_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.company_website_domains%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.company_website_domains WHERE id=p_id AND company_id=p_company_id FOR UPDATE;
  IF NOT public.website_can_edit(p_company_id,p_actor_id,'owner') THEN RAISE EXCEPTION 'website_forbidden' USING ERRCODE='42501'; END IF;
  IF d.id IS NULL OR d.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'website_not_found'; END IF;
  IF p_check_id IS NULL OR p_expected_version IS NULL OR d.version<>p_expected_version OR (d.check_id IS NOT NULL AND d.check_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'website_conflict'; END IF;
  UPDATE public.company_website_domains SET check_id=p_check_id,check_expires_at=clock_timestamp()+interval '2 minutes',version=version+1,updated_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
  RETURN to_jsonb(d);
END $$;

CREATE FUNCTION public.finish_website_domain_check(p_company_id uuid,p_actor_id uuid,p_id uuid,p_check_id uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.company_website_domains%ROWTYPE; s text;
BEGIN
  SELECT * INTO d FROM public.company_website_domains WHERE id=p_id AND company_id=p_company_id FOR UPDATE;
  IF NOT public.website_can_edit(p_company_id,p_actor_id,'owner') THEN RAISE EXCEPTION 'website_forbidden' USING ERRCODE='42501'; END IF;
  IF d.id IS NULL OR d.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'website_not_found'; END IF;
  IF p_check_id IS NULL OR d.check_id IS DISTINCT FROM p_check_id OR d.check_expires_at<clock_timestamp() THEN RAISE EXCEPTION 'website_conflict'; END IF;
  s:=p_result->>'status';
  IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR s IS NULL OR s NOT IN ('pending','verified','provisioning','active','error') OR jsonb_typeof(p_result->'records')<>'array' THEN RAISE EXCEPTION 'website_domain_invalid'; END IF;
  UPDATE public.company_website_domains SET status=s,
    ownership_verified_at=CASE WHEN (p_result->>'ownershipVerified')::boolean THEN clock_timestamp() ELSE NULL END,
    tls_verified_at=CASE WHEN (p_result->>'tlsVerified')::boolean THEN clock_timestamp() ELSE NULL END,
    provider_project_id=p_result->>'projectId',provider_verified=coalesce((p_result->>'providerVerified')::boolean,false),dns_valid=coalesce((p_result->>'dnsValid')::boolean,false),
    records=p_result->'records',message=left(coalesce(p_result->>'message','Verificação pendente.'),500),checked_at=clock_timestamp(),updated_at=clock_timestamp(),
    check_id=NULL,check_expires_at=NULL,version=version+1 WHERE id=d.id RETURNING * INTO d;
  RETURN to_jsonb(d);
END $$;
REVOKE ALL ON FUNCTION public.manage_website_domain(uuid,uuid,text,text,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_website_domain_check(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_website_domain_check(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_website_domain(uuid,uuid,text,text,uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_website_domain_check(uuid,uuid,uuid,bigint,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_website_domain_check(uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
