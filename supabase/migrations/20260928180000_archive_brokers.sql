BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep foreign keys and historical attribution intact; deletion only removes access/listing.
ALTER TABLE public.broker_accounts ADD COLUMN archived_at timestamptz;
ALTER TABLE public.broker_accounts ADD CONSTRAINT archived_broker_has_no_access
  CHECK (archived_at IS NULL OR (role = 'broker' AND NOT active));

CREATE FUNCTION public.archive_company_broker(p_actor_id uuid, p_broker_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.broker_accounts; target public.broker_accounts;
BEGIN
  SELECT * INTO actor FROM public.broker_accounts
    WHERE id = p_actor_id AND active AND role = 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'owner_required'; END IF;
  -- Same lock order as broker activation/provisioning, so a released seat is atomic.
  PERFORM 1 FROM public.account_companies WHERE company_id = actor.company_id FOR UPDATE;
  SELECT * INTO target FROM public.broker_accounts
    WHERE id = p_broker_id AND company_id = actor.company_id FOR UPDATE;
  IF NOT FOUND OR target.role <> 'broker' OR target.id = actor.id THEN
    RAISE EXCEPTION 'broker_not_found';
  END IF;
  UPDATE public.broker_accounts SET active = false, archived_at = COALESCE(archived_at, now())
    WHERE id = target.id;
  -- Revoke even if the account was already inactive. Existing auth trigger also invalidates versions.
  DELETE FROM public.account_sessions WHERE broker_id = target.id;
  DELETE FROM public.account_password_resets WHERE broker_id = target.id;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_company_broker(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_company_broker(uuid, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
