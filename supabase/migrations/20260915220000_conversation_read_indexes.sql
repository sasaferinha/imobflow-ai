-- Additive only: support bounded, tenant-scoped conversation pages.
CREATE INDEX IF NOT EXISTS messages_company_recent_page_idx
  ON public.messages(company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_company_thread_page_idx
  ON public.messages(company_id, conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS delivery_events_company_external_idx
  ON public.message_delivery_events(company_id, external_message_id);
