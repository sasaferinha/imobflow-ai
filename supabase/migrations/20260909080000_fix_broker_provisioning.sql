-- The output column `role` shadows the column of the same name inside PL/pgSQL.
-- Qualifying the table keeps the Basic seat calculation deterministic.
CREATE OR REPLACE FUNCTION public.create_company_broker(
  p_company_id uuid, p_name text, p_name_key text, p_email text, p_email_key text, p_password_hash text
) RETURNS TABLE(id uuid, name text, email text, role text, active boolean, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE broker_limit integer; broker_count integer; created public.broker_accounts%ROWTYPE;
BEGIN
  IF length(p_name) NOT BETWEEN 2 AND 120 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_password_hash NOT LIKE 'scrypt-v1$%' THEN
    RAISE EXCEPTION 'invalid_broker';
  END IF;
  SELECT seat_limit INTO broker_limit FROM public.account_companies WHERE company_id=p_company_id FOR UPDATE;
  IF broker_limit IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;
  SELECT count(*)::integer INTO broker_count
    FROM public.broker_accounts AS broker
    WHERE broker.company_id=p_company_id AND broker.role='broker' AND broker.active=true;
  IF broker_count >= broker_limit THEN RAISE EXCEPTION 'seat_limit_reached'; END IF;
  INSERT INTO public.broker_accounts(company_id,name,name_key,email,email_key,password_hash,role)
    VALUES(p_company_id,p_name,p_name_key,p_email,p_email_key,p_password_hash,'broker')
    RETURNING * INTO created;
  RETURN QUERY SELECT created.id,created.name,created.email,created.role,created.active,created.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_company_broker(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_company_broker(uuid,text,text,text,text,text) TO service_role;
