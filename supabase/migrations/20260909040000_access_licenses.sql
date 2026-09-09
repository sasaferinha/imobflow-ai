BEGIN;

CREATE TABLE public.access_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  company_id uuid REFERENCES public.account_companies(company_id) ON DELETE SET NULL,
  seat_limit integer NOT NULL CHECK (seat_limit BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_licenses_company_idx ON public.access_licenses(company_id);
ALTER TABLE public.access_licenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.access_licenses FROM anon, authenticated;
GRANT ALL ON public.access_licenses TO service_role;

CREATE FUNCTION public.create_access_license(
  p_key_hash text, p_seat_limit integer, p_company_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cid uuid; license_id uuid;
BEGIN
  IF p_key_hash !~ '^[a-f0-9]{64}$' OR p_seat_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_license';
  END IF;
  IF p_company_key IS NOT NULL THEN
    SELECT company_id INTO cid FROM public.account_companies WHERE name_key=p_company_key;
    IF cid IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
    UPDATE public.account_companies SET seat_limit=GREATEST(seat_limit,p_seat_limit) WHERE company_id=cid;
  END IF;
  INSERT INTO public.access_licenses(key_hash,company_id,seat_limit) VALUES(p_key_hash,cid,p_seat_limit) RETURNING id INTO license_id;
  RETURN license_id;
END;
$$;

CREATE FUNCTION public.redeem_access_license(
  p_key_hash text, p_company text, p_company_key text, p_name text, p_name_key text, p_password_hash text
) RETURNS TABLE(broker_id uuid, company_id uuid, company text, broker_name text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE license public.access_licenses%ROWTYPE; cid uuid; bid uuid; active_count integer; company_name text; account_role text;
BEGIN
  IF p_key_hash !~ '^[a-f0-9]{64}$' OR length(p_company) NOT BETWEEN 2 AND 120 OR length(p_name) NOT BETWEEN 2 AND 120 OR p_password_hash NOT LIKE 'scrypt-v1$%' THEN
    RAISE EXCEPTION 'invalid_registration';
  END IF;
  SELECT * INTO license FROM public.access_licenses WHERE key_hash=p_key_hash AND active=true FOR UPDATE;
  IF NOT FOUND OR (license.expires_at IS NOT NULL AND license.expires_at <= now()) THEN RAISE EXCEPTION 'invalid_license'; END IF;
  IF license.company_id IS NULL THEN
    cid := gen_random_uuid(); account_role := 'owner'; company_name := p_company;
    INSERT INTO public.companies(id,name,slug) VALUES(cid,company_name,'empresa-' || cid::text);
    INSERT INTO public.account_companies(company_id,name,name_key,seat_limit) VALUES(cid,company_name,p_company_key,license.seat_limit);
    UPDATE public.access_licenses SET company_id=cid, redeemed_at=COALESCE(redeemed_at,now()) WHERE id=license.id;
  ELSE
    cid := license.company_id;
    SELECT name INTO company_name FROM public.account_companies WHERE company_id=cid AND name_key=p_company_key FOR UPDATE;
    IF company_name IS NULL THEN RAISE EXCEPTION 'license_company_mismatch'; END IF;
    account_role := 'broker';
    UPDATE public.account_companies SET seat_limit=GREATEST(seat_limit,license.seat_limit) WHERE company_id=cid;
  END IF;
  SELECT count(*)::integer INTO active_count FROM public.broker_accounts WHERE company_id=cid AND active=true;
  IF active_count >= license.seat_limit THEN RAISE EXCEPTION 'seat_limit_reached'; END IF;
  INSERT INTO public.broker_accounts(company_id,name,name_key,password_hash,role)
  VALUES(cid,p_name,p_name_key,p_password_hash,account_role) RETURNING id INTO bid;
  RETURN QUERY SELECT bid,cid,company_name,p_name,account_role;
END;
$$;

REVOKE ALL ON FUNCTION public.create_access_license(text,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.redeem_access_license(text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_access_license(text,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_access_license(text,text,text,text,text,text) TO service_role;
COMMIT;
