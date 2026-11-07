BEGIN;
SET LOCAL lock_timeout = '5s';
-- Public marketing assets only. Uploads use the server after checking the site
-- editor session and tenant; there is no browser write policy for this bucket.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('website-media', 'website-media', true, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
CREATE POLICY website_media_no_browser_insert ON storage.objects AS RESTRICTIVE
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id <> 'website-media');
CREATE POLICY website_media_no_browser_update ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO anon, authenticated USING (bucket_id <> 'website-media') WITH CHECK (bucket_id <> 'website-media');
CREATE POLICY website_media_no_browser_delete ON storage.objects AS RESTRICTIVE
  FOR DELETE TO anon, authenticated USING (bucket_id <> 'website-media');
COMMIT;
