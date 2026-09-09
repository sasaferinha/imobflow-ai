BEGIN;
CREATE TABLE public.account_companies (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id),
  name text NOT NULL,
  name_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.account_companies(company_id,name,name_key)
SELECT id,name,lower(regexp_replace(btrim(name),'\s+',' ','g')) FROM public.companies;
CREATE TABLE public.broker_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  name_key text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','broker')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,name_key)
);
CREATE TABLE public.account_sessions (
  token_hash text PRIMARY KEY,
  broker_id uuid NOT NULL REFERENCES public.broker_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_sessions_broker_idx ON public.account_sessions(broker_id);
CREATE TABLE public.account_invitations (
  token_hash text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id),
  created_by uuid NOT NULL REFERENCES public.broker_accounts(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_companies, public.broker_accounts, public.account_sessions, public.account_invitations FROM anon, authenticated;
GRANT ALL ON public.account_companies, public.broker_accounts, public.account_sessions, public.account_invitations TO service_role;

CREATE FUNCTION public.account_session(p_hash text)
RETURNS TABLE(broker_id uuid,company_id uuid,name text,company text,role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT b.id,b.company_id,b.name,c.name,b.role FROM public.account_sessions s
 JOIN public.broker_accounts b ON b.id=s.broker_id
 JOIN public.account_companies c ON c.company_id=b.company_id
 WHERE s.token_hash=p_hash AND s.expires_at>now() AND b.active;
$$;

CREATE FUNCTION public.register_account(p_company text,p_company_key text,p_name text,p_name_key text,p_password_hash text,p_session_hash text,p_invitation_hash text DEFAULT NULL,p_claim_company uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE cid uuid; bid uuid; account_role text := 'broker';
BEGIN
 IF length(p_company) NOT BETWEEN 2 AND 120 OR length(p_name) NOT BETWEEN 2 AND 120 OR p_password_hash NOT LIKE 'scrypt-v1$%' THEN RAISE EXCEPTION 'invalid_registration'; END IF;
 IF p_claim_company IS NOT NULL THEN
   PERFORM 1 FROM public.account_companies WHERE company_id=p_claim_company FOR UPDATE;
   IF NOT FOUND OR EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_claim_company) THEN RAISE EXCEPTION 'company_already_claimed'; END IF;
   cid := p_claim_company; account_role := 'owner';
   UPDATE public.account_companies SET name=p_company,name_key=p_company_key WHERE company_id=cid;
   UPDATE public.companies SET name=p_company WHERE id=cid;
 ELSIF p_invitation_hash IS NOT NULL THEN
   SELECT i.company_id INTO cid FROM public.account_invitations i JOIN public.account_companies c ON c.company_id=i.company_id
   JOIN public.broker_accounts owner_account ON owner_account.id=i.created_by
   WHERE i.token_hash=p_invitation_hash AND i.used_at IS NULL AND i.expires_at>now() AND c.name_key=p_company_key AND owner_account.active AND owner_account.role='owner' FOR UPDATE OF i;
   IF cid IS NULL THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
   UPDATE public.account_invitations SET used_at=now() WHERE token_hash=p_invitation_hash;
 ELSE
   cid := gen_random_uuid(); account_role := 'owner';
   INSERT INTO public.companies(id,name,slug) VALUES(cid,p_company,'empresa-'||cid::text);
   INSERT INTO public.account_companies(company_id,name,name_key) VALUES(cid,p_company,p_company_key);
 END IF;
 INSERT INTO public.broker_accounts(company_id,name,name_key,password_hash,role)
 VALUES(cid,p_name,p_name_key,p_password_hash,account_role) RETURNING id INTO bid;
 INSERT INTO public.account_sessions(token_hash,broker_id,expires_at) VALUES(p_session_hash,bid,now()+interval '12 hours');
 RETURN bid;
END;
$$;
REVOKE ALL ON FUNCTION public.account_session(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_account(text,text,text,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_session(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_account(text,text,text,text,text,text,text,uuid) TO service_role;
COMMIT;
