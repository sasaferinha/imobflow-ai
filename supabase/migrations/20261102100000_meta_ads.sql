BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.meta_ads_connections (
  company_id uuid PRIMARY KEY REFERENCES public.account_companies(company_id) ON DELETE CASCADE,
  connected_by uuid NOT NULL REFERENCES public.broker_accounts(id),
  token_ciphertext text NOT NULL,
  account_id text CHECK (account_id ~ '^act_[0-9]{3,30}$'),
  account_name text,
  currency text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.meta_ads_oauth_requests (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id) ON DELETE CASCADE,
  broker_id uuid NOT NULL REFERENCES public.broker_accounts(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX meta_ads_oauth_expiration ON public.meta_ads_oauth_requests(expires_at);
CREATE TABLE public.meta_ads_campaign_requests (
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  campaign_id text CHECK (campaign_id ~ '^[0-9]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,request_id)
);
ALTER TABLE public.meta_ads_campaign_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_oauth_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ads_connections, public.meta_ads_oauth_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_ads_connections, public.meta_ads_oauth_requests TO service_role;
REVOKE ALL ON public.meta_ads_campaign_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.meta_ads_campaign_requests TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
