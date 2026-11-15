BEGIN;
SET LOCAL lock_timeout='5s';

-- Preserve the intended channel through Meta's cross-site return without
-- trusting query parameters. Nullable for previously issued OAuth requests.
ALTER TABLE public.social_oauth_requests ADD COLUMN channel text
 CHECK (channel IS NULL OR channel IN ('facebook','instagram'));

COMMIT;
