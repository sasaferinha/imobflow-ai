BEGIN;

-- A chave comercial ativa uma empresa uma única vez. O limite não inclui o owner/admin.
CREATE OR REPLACE FUNCTION public.create_access_license(
  p_key_hash text, p_seat_limit integer, p_company_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE license_id uuid;
BEGIN
  IF p_key_hash !~ '^[a-f0-9]{64}$' OR p_seat_limit <> 5 OR p_company_key IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_basic_license';
  END IF;
  INSERT INTO public.access_licenses(key_hash,seat_limit) VALUES(p_key_hash,5) RETURNING id INTO license_id;
  RETURN license_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_access_license(
  p_key_hash text, p_company text, p_company_key text, p_name text, p_name_key text, p_password_hash text
) RETURNS TABLE(broker_id uuid, company_id uuid, company text, broker_name text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE license public.access_licenses%ROWTYPE; cid uuid; bid uuid;
BEGIN
  IF p_key_hash !~ '^[a-f0-9]{64}$' OR length(p_company) NOT BETWEEN 2 AND 120 OR length(p_name) NOT BETWEEN 2 AND 120 OR p_password_hash NOT LIKE 'scrypt-v1$%' THEN
    RAISE EXCEPTION 'invalid_registration';
  END IF;
  SELECT * INTO license FROM public.access_licenses WHERE key_hash=p_key_hash AND active=true AND company_id IS NULL FOR UPDATE;
  IF NOT FOUND OR license.seat_limit <> 5 OR (license.expires_at IS NOT NULL AND license.expires_at <= now()) THEN RAISE EXCEPTION 'invalid_license'; END IF;
  cid := gen_random_uuid();
  INSERT INTO public.companies(id,name,slug) VALUES(cid,p_company,'empresa-' || cid::text);
  INSERT INTO public.account_companies(company_id,name,name_key,seat_limit) VALUES(cid,p_company,p_company_key,5);
  INSERT INTO public.broker_accounts(company_id,name,name_key,password_hash,role) VALUES(cid,p_name,p_name_key,p_password_hash,'owner') RETURNING id INTO bid;
  UPDATE public.access_licenses SET company_id=cid, active=false, redeemed_at=now() WHERE id=license.id;
  RETURN QUERY SELECT bid,cid,p_company,p_name,'owner'::text;
END;
$$;

CREATE FUNCTION public.create_company_broker(
  p_company_id uuid, p_name text, p_name_key text, p_password_hash text
) RETURNS TABLE(id uuid, name text, role text, active boolean, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE broker_limit integer; broker_count integer; created public.broker_accounts%ROWTYPE;
BEGIN
  IF length(p_name) NOT BETWEEN 2 AND 120 OR p_password_hash NOT LIKE 'scrypt-v1$%' THEN RAISE EXCEPTION 'invalid_broker'; END IF;
  SELECT seat_limit INTO broker_limit FROM public.account_companies WHERE company_id=p_company_id FOR UPDATE;
  IF broker_limit IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
  SELECT count(*)::integer INTO broker_count FROM public.broker_accounts WHERE company_id=p_company_id AND role='broker' AND active=true;
  IF broker_count >= broker_limit THEN RAISE EXCEPTION 'seat_limit_reached'; END IF;
  INSERT INTO public.broker_accounts(company_id,name,name_key,password_hash,role) VALUES(p_company_id,p_name,p_name_key,p_password_hash,'broker') RETURNING * INTO created;
  RETURN QUERY SELECT created.id,created.name,created.role,created.active,created.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_broker(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_broker(uuid,text,text,text) TO service_role;
COMMIT;
