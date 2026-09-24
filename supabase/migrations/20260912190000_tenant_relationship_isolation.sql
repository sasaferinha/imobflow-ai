-- Custom ImobFlow sessions are resolved on the server. Browser Supabase roles
-- have no CRM access; this is NOT a per-company JWT policy for service_role.
-- Apply after the pilot/WhatsApp migrations. All validation is transactional:
-- inconsistent legacy rows abort the migration and must be reviewed, not moved
-- or deleted automatically. No existing service_role grant is removed.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'companies','leads','properties','appointments','conversations','messages',
    'lead_property_events','account_companies','broker_accounts','account_sessions',
    'account_invitations','account_password_resets','access_licenses','api_rate_limits',
    'demo_conversation_threads','property_auto_deliveries','opportunities',
    'opportunity_notifications','opportunity_notification_reads','opportunity_sweeps',
    'attendance_replies','conversation_media','conversation_settings',
    'message_delivery_events','message_outbox'
  ] LOOP
    -- This retired/future auto-offer feature was not installed in every
    -- production project. All other named tables are required and fail closed.
    IF table_name = 'property_auto_deliveries' AND to_regclass('public.property_auto_deliveries') IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    -- A restrictive policy also blocks old permissive policies or accidental
    -- future table/column grants to the browser roles. Service grants survive.
    EXECUTE format('CREATE POLICY imobflow_server_only ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', table_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX messages_company_identity ON public.messages(company_id,id);
CREATE UNIQUE INDEX messages_company_conversation_identity ON public.messages(company_id,conversation_id,id);

-- Lead expression indexes invoke this pure normalizer as the writing role.
-- The core migration revoked PUBLIC execution without granting the server,
-- which otherwise makes legitimate service-role lead writes fail.
GRANT EXECUTE ON FUNCTION public.match_normalize(text) TO service_role;

-- Preserve the existing single-column FKs and their deletion behavior. These
-- additional constraints enforce company ownership, including privileged writes.
-- NULL company IDs would bypass a composite FK, so refuse them explicitly.
ALTER TABLE public.leads ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.properties ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.broker_accounts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.conversations ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.messages ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE public.lead_property_events ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE public.conversations ADD CONSTRAINT conversations_tenant_lead_fk
  FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id);
ALTER TABLE public.conversations ADD CONSTRAINT conversations_tenant_broker_fk
  FOREIGN KEY(company_id,assigned_broker_id) REFERENCES public.broker_accounts(company_id,id);
ALTER TABLE public.messages ADD CONSTRAINT messages_tenant_conversation_fk
  FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_tenant_lead_fk
  FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_tenant_property_fk
  FOREIGN KEY(company_id,property_id) REFERENCES public.properties(company_id,id);
ALTER TABLE public.lead_property_events ADD CONSTRAINT lead_property_events_tenant_lead_fk
  FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id);
ALTER TABLE public.lead_property_events ADD CONSTRAINT lead_property_events_tenant_property_fk
  FOREIGN KEY(company_id,property_id) REFERENCES public.properties(company_id,id);
ALTER TABLE public.account_invitations ADD CONSTRAINT account_invitations_tenant_creator_fk
  FOREIGN KEY(company_id,created_by) REFERENCES public.broker_accounts(company_id,id);
ALTER TABLE public.demo_conversation_threads ADD CONSTRAINT demo_threads_tenant_broker_fk
  FOREIGN KEY(company_id,assigned_broker_id) REFERENCES public.broker_accounts(company_id,id);
ALTER TABLE public.message_outbox ADD CONSTRAINT message_outbox_tenant_message_fk
  FOREIGN KEY(company_id,conversation_id,id) REFERENCES public.messages(company_id,conversation_id,id);
ALTER TABLE public.message_outbox ADD CONSTRAINT message_outbox_tenant_broker_fk
  FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id);

CREATE INDEX conversations_tenant_lead_fk_idx ON public.conversations(company_id,lead_id);
CREATE INDEX conversations_tenant_broker_fk_idx ON public.conversations(company_id,assigned_broker_id) WHERE assigned_broker_id IS NOT NULL;
CREATE INDEX messages_tenant_conversation_fk_idx ON public.messages(company_id,conversation_id);
CREATE INDEX appointments_tenant_lead_fk_idx ON public.appointments(company_id,lead_id);
CREATE INDEX appointments_tenant_property_fk_idx ON public.appointments(company_id,property_id) WHERE property_id IS NOT NULL;
CREATE INDEX lead_property_events_tenant_lead_fk_idx ON public.lead_property_events(company_id,lead_id);
CREATE INDEX lead_property_events_tenant_property_fk_idx ON public.lead_property_events(company_id,property_id);
CREATE INDEX account_invitations_tenant_creator_fk_idx ON public.account_invitations(company_id,created_by);
CREATE INDEX demo_threads_tenant_broker_fk_idx ON public.demo_conversation_threads(company_id,assigned_broker_id);
CREATE INDEX message_outbox_tenant_broker_fk_idx ON public.message_outbox(company_id,broker_id) WHERE broker_id IS NOT NULL;

CREATE FUNCTION public.prevent_company_reassignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company_reassignment_forbidden' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prevent_company_reassignment() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'leads','properties','appointments','conversations','messages','lead_property_events',
    'account_companies','broker_accounts','account_invitations','demo_conversation_threads',
    'property_auto_deliveries','opportunities','opportunity_notifications',
    'opportunity_notification_reads','opportunity_sweeps','attendance_replies',
    'conversation_media','conversation_settings','message_delivery_events','message_outbox'
  ] LOOP
    IF table_name = 'property_auto_deliveries' AND to_regclass('public.property_auto_deliveries') IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('CREATE TRIGGER preserve_company_identity BEFORE UPDATE OF company_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_company_reassignment()', table_name);
  END LOOP;
END $$;

-- property_auto_deliveries intentionally keeps historical UUIDs after CRM
-- deletion. Its existing service-only RPCs check relationships under locks;
-- adding FKs there would break audit/dedup retention and normal property removal.
-- access_licenses can legitimately acquire/lose company_id during redemption
-- or company deletion, so it intentionally has no immutability trigger.
NOTIFY pgrst, 'reload schema';
COMMIT;
