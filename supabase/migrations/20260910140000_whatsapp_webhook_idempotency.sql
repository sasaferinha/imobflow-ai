-- Incoming WhatsApp events are retried by Meta. Guarantee that one provider
-- message can be stored only once per company, without changing existing rows.
create unique index if not exists messages_company_external_message_id_unique
  on public.messages (company_id, external_message_id)
  where external_message_id is not null;
