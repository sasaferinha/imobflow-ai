-- Plan capacity: active brokers only; owners remain separate.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.account_companies DROP CONSTRAINT IF EXISTS basic_seat_limit_check;
ALTER TABLE public.access_licenses DROP CONSTRAINT IF EXISTS basic_license_seat_limit_check;
UPDATE public.account_companies SET seat_limit=5 WHERE seat_limit BETWEEN 1 AND 3;
UPDATE public.access_licenses SET seat_limit=5 WHERE seat_limit=3;
ALTER TABLE public.account_companies ALTER COLUMN seat_limit SET DEFAULT 5;
ALTER TABLE public.account_companies ADD CONSTRAINT plan_seat_limit_check CHECK(seat_limit IN (5,8,12));
ALTER TABLE public.access_licenses ADD CONSTRAINT plan_license_seat_limit_check CHECK(seat_limit IN (5,8,12));
CREATE OR REPLACE FUNCTION public.create_access_license(
  p_key_hash text, p_seat_limit integer, p_company_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE license_id uuid;
BEGIN
  IF p_key_hash IS NULL OR p_seat_limit IS NULL OR p_key_hash !~ '^[a-f0-9]{64}$' OR p_seat_limit NOT IN (5,8,12) OR p_company_key IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_plan_license';
  END IF;
  INSERT INTO public.access_licenses(key_hash,seat_limit) VALUES(p_key_hash,p_seat_limit) RETURNING id INTO license_id;
  RETURN license_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.redeem_access_license(
  p_key_hash text, p_company text, p_company_key text, p_name text, p_name_key text,
  p_email text, p_email_key text, p_password_hash text
) RETURNS TABLE(broker_id uuid, company_id uuid, company text, broker_name text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE license public.access_licenses%ROWTYPE; cid uuid; bid uuid;
BEGIN
  IF p_email IS NULL OR p_email_key IS NULL OR length(p_email)>254 OR p_email_key IS DISTINCT FROM lower(btrim(p_email)) THEN RAISE EXCEPTION 'invalid_email'; END IF;
  IF p_key_hash !~ '^[a-f0-9]{64}$' OR length(p_company) NOT BETWEEN 2 AND 120 OR length(p_name) NOT BETWEEN 2 AND 120
    OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_password_hash NOT LIKE 'scrypt-v1$%' THEN
    RAISE EXCEPTION 'invalid_registration';
  END IF;
  SELECT * INTO license FROM public.access_licenses AS access_license WHERE access_license.key_hash=p_key_hash AND access_license.active=true AND access_license.company_id IS NULL FOR UPDATE;
  IF NOT FOUND OR license.seat_limit NOT IN (5,8,12) OR (license.expires_at IS NOT NULL AND license.expires_at <= now()) THEN RAISE EXCEPTION 'invalid_license'; END IF;
  cid := gen_random_uuid();
  INSERT INTO public.companies(id,name,slug) VALUES(cid,p_company,'empresa-' || cid::text);
  INSERT INTO public.account_companies(company_id,name,name_key,seat_limit) VALUES(cid,p_company,p_company_key,license.seat_limit);
  INSERT INTO public.broker_accounts(company_id,name,name_key,email,email_key,password_hash,role)
  VALUES(cid,p_name,p_name_key,p_email,p_email_key,p_password_hash,'owner') RETURNING id INTO bid;
  UPDATE public.access_licenses SET company_id=cid, active=false, redeemed_at=now() WHERE id=license.id;
  RETURN QUERY SELECT bid,cid,p_company,p_name,'owner'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.create_access_license(text,integer,text),public.redeem_access_license(text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_access_license(text,integer,text),public.redeem_access_license(text,text,text,text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
