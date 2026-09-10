BEGIN;
ALTER TABLE public.broker_accounts ADD COLUMN auth_version integer NOT NULL DEFAULT 0 CHECK(auth_version >= 0);
CREATE TABLE public.account_password_resets (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  broker_id uuid NOT NULL REFERENCES public.broker_accounts(id) ON DELETE CASCADE,
  password_version text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_password_resets_broker_idx ON public.account_password_resets(broker_id);
ALTER TABLE public.account_password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_password_resets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.account_password_resets TO service_role;

CREATE FUNCTION public.issue_account_password_reset(p_broker_id uuid,p_token_hash text,p_expected_hash text,p_expected_email text,p_expected_auth_version integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account public.broker_accounts%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT * INTO account FROM public.broker_accounts WHERE id=p_broker_id FOR UPDATE;
  IF NOT FOUND OR NOT account.active OR account.password_hash IS DISTINCT FROM p_expected_hash OR account.email IS DISTINCT FROM p_expected_email OR account.auth_version IS DISTINCT FROM p_expected_auth_version THEN RETURN false; END IF;
  DELETE FROM public.account_password_resets WHERE broker_id=p_broker_id;
  INSERT INTO public.account_password_resets(token_hash,broker_id,password_version)
    VALUES(p_token_hash,p_broker_id,account.password_hash);
  RETURN true;
END; $$;

CREATE FUNCTION public.consume_account_password_reset(p_token_hash text,p_new_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE bid uuid; account public.broker_accounts%ROWTYPE; reset public.account_password_resets%ROWTYPE;
BEGIN
  IF p_new_hash IS NULL OR p_new_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'invalid_password_hash'; END IF;
  SELECT broker_id INTO bid FROM public.account_password_resets WHERE token_hash=p_token_hash;
  IF bid IS NULL THEN RETURN false; END IF;
  SELECT * INTO account FROM public.broker_accounts WHERE id=bid FOR UPDATE;
  SELECT * INTO reset FROM public.account_password_resets WHERE token_hash=p_token_hash FOR UPDATE;
  IF NOT FOUND OR NOT account.active OR reset.used_at IS NOT NULL OR reset.expires_at<=clock_timestamp()
    OR reset.password_version IS DISTINCT FROM account.password_hash THEN RETURN false; END IF;
  UPDATE public.broker_accounts SET password_hash=p_new_hash WHERE id=bid;
  DELETE FROM public.account_sessions WHERE broker_id=bid;
  DELETE FROM public.account_password_resets WHERE broker_id=bid;
  RETURN true;
END; $$;

-- Recheck the administrator's verified credentials and the target's tenant in
-- the same transaction; a concurrent password reset cannot issue a stale link.
CREATE FUNCTION public.issue_company_broker_password_reset(p_actor_id uuid,p_actor_hash text,p_actor_auth_version integer,p_broker_id uuid,p_token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; target public.broker_accounts%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.broker_accounts WHERE id=p_actor_id FOR UPDATE;
  IF NOT FOUND OR NOT actor.active OR actor.role<>'owner' OR actor.password_hash IS DISTINCT FROM p_actor_hash OR actor.auth_version IS DISTINCT FROM p_actor_auth_version THEN RETURN false; END IF;
  SELECT * INTO target FROM public.broker_accounts WHERE id=p_broker_id AND company_id=actor.company_id AND role='broker' FOR UPDATE;
  IF NOT FOUND OR NOT target.active THEN RETURN false; END IF;
  RETURN public.issue_account_password_reset(target.id,p_token_hash,target.password_hash,target.email,target.auth_version);
END; $$;
REVOKE ALL ON FUNCTION public.issue_company_broker_password_reset(uuid,text,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_company_broker_password_reset(uuid,text,integer,uuid,text) TO service_role;

CREATE FUNCTION public.change_account_password(p_broker_id uuid,p_expected_hash text,p_new_hash text,p_expected_auth_version integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account public.broker_accounts%ROWTYPE;
BEGIN
  IF p_new_hash IS NULL OR p_new_hash !~ '^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'invalid_password_hash'; END IF;
  SELECT * INTO account FROM public.broker_accounts WHERE id=p_broker_id FOR UPDATE;
  IF NOT FOUND OR NOT account.active OR account.password_hash IS DISTINCT FROM p_expected_hash OR account.auth_version IS DISTINCT FROM p_expected_auth_version THEN RETURN false; END IF;
  UPDATE public.broker_accounts SET password_hash=p_new_hash WHERE id=p_broker_id;
  DELETE FROM public.account_sessions WHERE broker_id=p_broker_id;
  DELETE FROM public.account_password_resets WHERE broker_id=p_broker_id;
  RETURN true;
END; $$;

CREATE FUNCTION public.set_company_broker_active(p_actor_id uuid,p_broker_id uuid,p_active boolean)
RETURNS TABLE(id uuid,name text,email text,role text,active boolean,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; target public.broker_accounts%ROWTYPE; seats integer; used integer;
BEGIN
  SELECT * INTO actor FROM public.broker_accounts b WHERE b.id=p_actor_id;
  IF NOT FOUND OR NOT actor.active OR actor.role<>'owner' OR p_active IS NULL THEN RAISE EXCEPTION 'owner_required'; END IF;
  SELECT c.seat_limit INTO seats FROM public.account_companies c WHERE c.company_id=actor.company_id FOR UPDATE;
  SELECT * INTO target FROM public.broker_accounts b WHERE b.id=p_broker_id AND b.company_id=actor.company_id FOR UPDATE;
  IF NOT FOUND OR target.role<>'broker' OR target.id=actor.id THEN RAISE EXCEPTION 'invalid_broker'; END IF;
  IF p_active AND NOT target.active THEN
    SELECT count(*) INTO used FROM public.broker_accounts b WHERE b.company_id=actor.company_id AND b.role='broker' AND b.active;
    IF used>=seats THEN RAISE EXCEPTION 'seat_limit_reached'; END IF;
  END IF;
  UPDATE public.broker_accounts b SET active=p_active WHERE b.id=target.id RETURNING * INTO target;
  IF NOT p_active THEN
    DELETE FROM public.account_sessions WHERE broker_id=target.id;
    DELETE FROM public.account_password_resets WHERE broker_id=target.id;
  END IF;
  RETURN QUERY SELECT target.id,target.name,target.email,target.role,target.active,target.created_at;
END; $$;

REVOKE ALL ON FUNCTION public.issue_account_password_reset(uuid,text,text,text,integer),public.consume_account_password_reset(text,text),public.change_account_password(uuid,text,text,integer),public.set_company_broker_active(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_account_password_reset(uuid,text,text,text,integer),public.consume_account_password_reset(text,text),public.change_account_password(uuid,text,text,integer),public.set_company_broker_active(uuid,uuid,boolean) TO service_role;
-- Lock the account during issuance so a login verified before a password change
-- cannot recreate a session after that change revoked the previous sessions.
CREATE FUNCTION public.issue_account_session(p_broker_id uuid,p_token_hash text,p_expected_hash text,p_expected_auth_version integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account public.broker_accounts%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT * INTO account FROM public.broker_accounts WHERE id=p_broker_id FOR UPDATE;
  IF NOT FOUND OR NOT account.active OR account.password_hash IS DISTINCT FROM p_expected_hash OR account.auth_version IS DISTINCT FROM p_expected_auth_version THEN RETURN false; END IF;
  INSERT INTO public.account_sessions(token_hash,broker_id,expires_at) VALUES(p_token_hash,p_broker_id,now()+interval '12 hours');
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.issue_account_session(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_account_session(uuid,text,text,integer) TO service_role;

CREATE FUNCTION public.change_account_email(p_broker_id uuid,p_expected_hash text,p_expected_auth_version integer,p_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account public.broker_accounts%ROWTYPE;
BEGIN
  IF p_email IS NULL OR length(p_email)>254 OR p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR p_email IS DISTINCT FROM lower(btrim(p_email)) THEN RAISE EXCEPTION 'invalid_email'; END IF;
  SELECT * INTO account FROM public.broker_accounts WHERE id=p_broker_id FOR UPDATE;
  IF NOT FOUND OR NOT account.active OR account.password_hash IS DISTINCT FROM p_expected_hash OR account.auth_version IS DISTINCT FROM p_expected_auth_version THEN RETURN false; END IF;
  UPDATE public.broker_accounts SET email=p_email,email_key=p_email WHERE id=p_broker_id;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.change_account_email(uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_account_email(uuid,text,integer,text) TO service_role;

CREATE FUNCTION public.invalidate_account_recovery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.email IS DISTINCT FROM NEW.email OR OLD.email_key IS DISTINCT FROM NEW.email_key OR OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.active IS DISTINCT FROM NEW.active THEN
    NEW.auth_version := OLD.auth_version + 1;
    DELETE FROM public.account_password_resets WHERE broker_id=NEW.id;
    DELETE FROM public.account_sessions WHERE broker_id=NEW.id;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.invalidate_account_recovery() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER invalidate_account_recovery BEFORE UPDATE ON public.broker_accounts
FOR EACH ROW EXECUTE FUNCTION public.invalidate_account_recovery();
NOTIFY pgrst,'reload schema';
COMMIT;
