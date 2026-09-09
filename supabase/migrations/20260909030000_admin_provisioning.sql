BEGIN;
ALTER TABLE public.account_companies ADD COLUMN IF NOT EXISTS seat_limit integer NOT NULL DEFAULT 1 CHECK (seat_limit BETWEEN 1 AND 500);

CREATE FUNCTION public.admin_provision_broker(
  p_company text, p_company_key text, p_name text, p_name_key text,
  p_password_hash text, p_seat_limit integer, p_existing_company boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cid uuid; bid uuid; active_count integer;
BEGIN
  IF length(p_company) NOT BETWEEN 2 AND 120 OR length(p_name) NOT BETWEEN 2 AND 120
    OR p_password_hash NOT LIKE 'scrypt-v1$%' OR p_seat_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_provisioning';
  END IF;
  IF p_existing_company THEN
    SELECT company_id INTO cid FROM public.account_companies WHERE name_key=p_company_key FOR UPDATE;
    IF cid IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
    SELECT count(*)::integer INTO active_count FROM public.broker_accounts WHERE company_id=cid AND active=true;
    IF p_seat_limit < active_count + 1 THEN RAISE EXCEPTION 'seat_limit_reached'; END IF;
    UPDATE public.account_companies SET seat_limit=p_seat_limit WHERE company_id=cid;
  ELSE
    cid := gen_random_uuid();
    INSERT INTO public.companies(id,name,slug) VALUES(cid,p_company,'empresa-' || cid::text);
    INSERT INTO public.account_companies(company_id,name,name_key,seat_limit) VALUES(cid,p_company,p_company_key,p_seat_limit);
  END IF;
  INSERT INTO public.broker_accounts(company_id,name,name_key,password_hash,role)
  VALUES(cid,p_name,p_name_key,p_password_hash,CASE WHEN NOT p_existing_company THEN 'owner' ELSE 'broker' END)
  RETURNING id INTO bid;
  RETURN bid;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_provision_broker(text,text,text,text,text,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_provision_broker(text,text,text,text,text,integer,boolean) TO service_role;
COMMIT;
