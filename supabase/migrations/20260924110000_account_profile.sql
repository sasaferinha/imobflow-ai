-- Requires 20260924100000 (stable CRM attribution and broker-name history).
BEGIN;

CREATE OR REPLACE FUNCTION public.update_account_profile(
  p_company_id uuid, p_broker_id uuid, p_name text, p_name_key text,
  p_company text, p_company_key text, p_expected_name text, p_expected_company text
) RETURNS TABLE(broker_id uuid, name text, company text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; current_company text;
BEGIN
  -- Fixed lock order: company before broker. Identity always comes from session.
  SELECT c.name INTO current_company FROM public.account_companies c
    WHERE c.company_id=p_company_id FOR UPDATE;
  SELECT b.* INTO actor FROM public.broker_accounts b
    WHERE b.company_id=p_company_id AND b.id=p_broker_id AND b.active FOR UPDATE;
  IF actor.id IS NULL OR current_company IS NULL THEN RAISE EXCEPTION 'profile_unavailable'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 2 AND 120 OR length(btrim(p_company)) NOT BETWEEN 2 AND 120
    OR coalesce(p_name_key,'')='' OR coalesce(p_company_key,'')='' THEN RAISE EXCEPTION 'invalid_profile'; END IF;
  IF actor.name IS DISTINCT FROM p_expected_name OR current_company IS DISTINCT FROM p_expected_company THEN RETURN; END IF;
  IF actor.role<>'owner' AND p_company IS DISTINCT FROM current_company THEN RAISE EXCEPTION 'owner_required'; END IF;

  UPDATE public.broker_accounts b SET name=p_name, name_key=p_name_key
    WHERE b.company_id=p_company_id AND b.id=p_broker_id;
  -- Stable IDs, not a mutable name, decide which records belong to the person.
  UPDATE public.conversations SET assigned_to=p_name
    WHERE company_id=p_company_id AND assigned_broker_id=p_broker_id;
  UPDATE public.leads SET assigned_to=p_name
    WHERE company_id=p_company_id AND assigned_broker_id=p_broker_id;
  UPDATE public.appointments SET assigned_to=p_name
    WHERE company_id=p_company_id AND assigned_broker_id=p_broker_id;
  IF actor.role='owner' THEN
    UPDATE public.account_companies c SET name=p_company,name_key=p_company_key WHERE c.company_id=p_company_id;
    UPDATE public.companies SET name=p_company WHERE id=p_company_id;
  END IF;
  RETURN QUERY SELECT actor.id,p_name,p_company,actor.role;
END;
$$;
REVOKE ALL ON FUNCTION public.update_account_profile(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_account_profile(uuid,uuid,text,text,text,text,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
