BEGIN;
SET LOCAL lock_timeout = '5s';

-- Paid generation is opt-in per real tenant. No CRM/browser role can grant
-- itself an entitlement, raise a quota, or write a provider job.
CREATE TABLE public.media_ai_entitlements (
  company_id uuid PRIMARY KEY REFERENCES public.account_companies(company_id),
  enabled boolean NOT NULL DEFAULT false,
  photo_enabled boolean NOT NULL DEFAULT true,
  video_enabled boolean NOT NULL DEFAULT false,
  photo_daily_limit integer NOT NULL DEFAULT 3 CHECK (photo_daily_limit BETWEEN 1 AND 10),
  video_daily_limit integer NOT NULL DEFAULT 1 CHECK (video_daily_limit BETWEEN 1 AND 10)
);

CREATE TABLE public.media_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id),
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK (kind IN ('photo', 'video')),
  -- Demo gallery slots only: this is deliberately not a foreign key to real
  -- properties. Paid output never silently changes a customer's catalogue.
  property_id text NOT NULL CHECK (property_id IN (
    'demo-casa-jardim', 'demo-apartamento-centro', 'demo-casa-verde', 'demo-apartamento-serra'
  )),
  photo_index integer NOT NULL CHECK (
    photo_index >= 0 AND photo_index < CASE WHEN property_id = 'demo-casa-jardim' THEN 3 ELSE 2 END
  ),
  format text NOT NULL CHECK (format IN ('landscape', 'portrait')),
  provider text NOT NULL,
  model text NOT NULL CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN (
    'reserved', 'submitting', 'processing', 'completed', 'failed', 'unknown'
  )),
  provider_task_id text CHECK (provider_task_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  input_path text,
  result_path text,
  result_mime text CHECK (result_mime IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  result_bytes integer CHECK (result_bytes BETWEEN 1 AND 30000000),
  -- Store only selected billing counters, never a raw provider response/token.
  provider_usage jsonb CHECK (jsonb_typeof(provider_usage) = 'object' AND octet_length(provider_usage::text) <= 8192),
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '168 hours',
  poll_after timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  UNIQUE (company_id, actor_id, request_id),
  FOREIGN KEY (company_id, actor_id) REFERENCES public.broker_accounts(company_id, id),
  CHECK ((kind = 'photo' AND provider = 'openai') OR (kind = 'video' AND provider = 'runway')),
  CHECK (input_path IS NULL OR input_path IN (
    company_id::text || '/' || id::text || '/input.jpg',
    company_id::text || '/' || id::text || '/input.jpeg',
    company_id::text || '/' || id::text || '/input.png',
    company_id::text || '/' || id::text || '/input.webp'
  )),
  CHECK (result_path IS NULL OR (kind = 'video' AND result_path = company_id::text || '/' || id::text || '/result.mp4')
    OR (kind = 'photo' AND result_path IN (
      company_id::text || '/' || id::text || '/result.jpg',
      company_id::text || '/' || id::text || '/result.jpeg',
      company_id::text || '/' || id::text || '/result.png',
      company_id::text || '/' || id::text || '/result.webp'
    ))),
  CHECK (result_mime IS NULL OR (kind = 'video' AND result_mime = 'video/mp4')
    OR (kind = 'photo' AND result_mime IN ('image/jpeg', 'image/png', 'image/webp'))),
  CHECK (status <> 'completed' OR (result_path IS NOT NULL AND result_mime IS NOT NULL AND result_bytes IS NOT NULL)),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '168 hours')
);
CREATE INDEX media_ai_jobs_company_daily ON public.media_ai_jobs(company_id, kind, created_at);
CREATE INDEX media_ai_jobs_global_daily ON public.media_ai_jobs(kind, created_at);
CREATE INDEX media_ai_jobs_expiry ON public.media_ai_jobs(expires_at);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['media_ai_entitlements', 'media_ai_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', table_name);
    EXECUTE format('CREATE POLICY media_ai_browser_denied ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', table_name);
  END LOOP;
END $$;

-- A retry, a failure and an uncertain provider response retain their original
-- paid reservation. Metadata updates cannot move it to another tenant/day.
CREATE FUNCTION public.media_ai_job_keep_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.id, NEW.company_id, NEW.actor_id, NEW.request_id, NEW.request_hash,
    NEW.kind, NEW.property_id, NEW.photo_index, NEW.format, NEW.provider, NEW.model, NEW.created_at, NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.company_id, OLD.actor_id, OLD.request_id, OLD.request_hash,
    OLD.kind, OLD.property_id, OLD.photo_index, OLD.format, OLD.provider, OLD.model, OLD.created_at, OLD.expires_at)
  THEN RAISE EXCEPTION 'media_identity_immutable'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER media_ai_job_keep_identity BEFORE UPDATE ON public.media_ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.media_ai_job_keep_identity();
REVOKE ALL ON FUNCTION public.media_ai_job_keep_identity() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reserve_media_ai_job(
  p_company_id uuid, p_actor_id uuid, p_request_id uuid, p_request_hash text,
  p_kind text, p_property_id text, p_photo_index integer, p_format text, p_provider text, p_model text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  entitlement public.media_ai_entitlements%ROWTYPE;
  job public.media_ai_jobs%ROWTYPE;
  day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  daily_limit integer;
BEGIN
  IF p_company_id IS NULL OR p_actor_id IS NULL OR p_request_id IS NULL
    OR p_request_hash IS NULL OR p_request_hash !~ '^[a-f0-9]{64}$'
    OR p_kind IS NULL OR p_kind NOT IN ('photo', 'video')
    OR p_property_id IS NULL OR p_property_id NOT IN ('demo-casa-jardim', 'demo-apartamento-centro', 'demo-casa-verde', 'demo-apartamento-serra')
    OR p_photo_index IS NULL OR p_photo_index < 0 OR p_photo_index >= (CASE WHEN p_property_id = 'demo-casa-jardim' THEN 3 ELSE 2 END)
    OR p_format IS NULL OR p_format NOT IN ('landscape', 'portrait')
    OR p_provider IS NULL OR p_provider <> (CASE WHEN p_kind = 'photo' THEN 'openai' ELSE 'runway' END)
    OR p_model IS NULL OR p_model !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
  THEN RAISE EXCEPTION 'media_invalid_request'; END IF;

  -- Always global(kind/UTC-day) then tenant. The global cap is shared by all
  -- companies and both kinds share the tenant/idempotency lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('media-ai-global:' || p_kind || ':' || (day_start AT TIME ZONE 'UTC')::date::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('media-ai-company:' || p_company_id::text, 0));
  PERFORM 1 FROM public.broker_accounts
    WHERE company_id = p_company_id AND id = p_actor_id AND active AND role = 'owner' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_forbidden'; END IF;
  SELECT * INTO entitlement FROM public.media_ai_entitlements WHERE company_id = p_company_id FOR SHARE;
  IF NOT FOUND OR NOT entitlement.enabled THEN RAISE EXCEPTION 'media_not_enabled'; END IF;
  IF (p_kind = 'photo' AND NOT entitlement.photo_enabled) OR (p_kind = 'video' AND NOT entitlement.video_enabled)
  THEN RAISE EXCEPTION 'media_feature_disabled'; END IF;

  SELECT * INTO job FROM public.media_ai_jobs
    WHERE company_id = p_company_id AND actor_id = p_actor_id AND request_id = p_request_id;
  IF FOUND THEN
    IF job.request_hash <> p_request_hash OR ROW(job.kind, job.property_id, job.photo_index, job.format, job.provider, job.model)
      IS DISTINCT FROM ROW(p_kind, p_property_id, p_photo_index, p_format, p_provider, p_model)
    THEN RAISE EXCEPTION 'media_request_conflict'; END IF;
    RETURN jsonb_build_object('job', to_jsonb(job), 'reused', true);
  END IF;

  daily_limit := CASE WHEN p_kind = 'photo' THEN entitlement.photo_daily_limit ELSE entitlement.video_daily_limit END;
  IF (SELECT count(*) FROM public.media_ai_jobs WHERE company_id = p_company_id AND kind = p_kind
      AND created_at >= day_start AND created_at < day_start + interval '24 hours') >= daily_limit
  THEN RAISE EXCEPTION 'media_daily_limit'; END IF;
  -- Every reservation consumes quota, including failed/unknown/expired jobs.
  IF (SELECT count(*) FROM public.media_ai_jobs WHERE kind = p_kind
      AND created_at >= day_start AND created_at < day_start + interval '24 hours') >= 100
  THEN RAISE EXCEPTION 'media_global_limit'; END IF;
  INSERT INTO public.media_ai_jobs(company_id, actor_id, request_id, request_hash, kind, property_id, photo_index, format, provider, model)
    VALUES(p_company_id, p_actor_id, p_request_id, p_request_hash, p_kind, p_property_id, p_photo_index, p_format, p_provider, p_model)
    RETURNING * INTO job;
  RETURN jsonb_build_object('job', to_jsonb(job), 'reused', false);
END $$;

CREATE FUNCTION public.claim_media_ai_job(p_company_id uuid, p_actor_id uuid, p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE entitlement public.media_ai_entitlements%ROWTYPE; job public.media_ai_jobs%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.broker_accounts
    WHERE company_id = p_company_id AND id = p_actor_id AND active AND role = 'owner' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_forbidden'; END IF;
  SELECT * INTO entitlement FROM public.media_ai_entitlements WHERE company_id = p_company_id FOR SHARE;
  IF NOT FOUND OR NOT entitlement.enabled THEN RAISE EXCEPTION 'media_not_enabled'; END IF;
  SELECT * INTO job FROM public.media_ai_jobs
    WHERE id = p_job_id AND company_id = p_company_id AND actor_id = p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (job.kind = 'photo' AND NOT entitlement.photo_enabled) OR (job.kind = 'video' AND NOT entitlement.video_enabled)
  THEN RAISE EXCEPTION 'media_feature_disabled'; END IF;
  IF job.status <> 'reserved' OR job.expires_at <= now() OR job.purged_at IS NOT NULL THEN RETURN NULL; END IF;
  -- Quota belongs to the UTC reservation day. An unsubmitted old reservation
  -- cannot spend against yesterday's quota: the caller needs a new request.
  IF job.created_at < (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  THEN RAISE EXCEPTION 'media_reservation_expired'; END IF;
  UPDATE public.media_ai_jobs SET status = 'submitting'
    WHERE id = job.id AND company_id = p_company_id AND actor_id = p_actor_id AND status = 'reserved'
    RETURNING * INTO job;
  RETURN to_jsonb(job);
END $$;

REVOKE ALL ON FUNCTION public.reserve_media_ai_job(uuid,uuid,uuid,text,text,text,integer,text,text,text),
  public.claim_media_ai_job(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_media_ai_job(uuid,uuid,uuid,text,text,text,integer,text,text,text),
  public.claim_media_ai_job(uuid,uuid,uuid) TO service_role;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media-ai', 'media-ai', false, 30000000, ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
ON CONFLICT(id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
-- Restrictive policies deny browser access even if another bucket migration
-- leaves a broad permissive policy. Private signed URLs are issued server-side.
CREATE POLICY media_ai_no_browser_select ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated USING (bucket_id <> 'media-ai');
CREATE POLICY media_ai_no_browser_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> 'media-ai');
CREATE POLICY media_ai_no_browser_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (bucket_id <> 'media-ai') WITH CHECK (bucket_id <> 'media-ai');
CREATE POLICY media_ai_no_browser_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (bucket_id <> 'media-ai');
COMMIT;
