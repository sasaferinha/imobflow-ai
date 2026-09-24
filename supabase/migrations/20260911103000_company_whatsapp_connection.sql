BEGIN;

ALTER TABLE public.conversation_settings
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_api_version text DEFAULT 'v26.0',
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_settings_whatsapp_api_version_check'
      AND conrelid = 'public.conversation_settings'::regclass
  ) THEN
    ALTER TABLE public.conversation_settings
      ADD CONSTRAINT conversation_settings_whatsapp_api_version_check
      CHECK (whatsapp_api_version IS NULL OR whatsapp_api_version ~ '^v[0-9]+[.][0-9]+$');
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_settings_whatsapp_phone_number_id_key
  ON public.conversation_settings(whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

COMMIT;
