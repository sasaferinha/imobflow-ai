-- Dados operacionais do imóvel. Defaults preservam todos os imóveis existentes.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS key_in_office BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS occupied BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cataloged_on_instagram BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cataloged_on_site BOOLEAN NOT NULL DEFAULT FALSE;
