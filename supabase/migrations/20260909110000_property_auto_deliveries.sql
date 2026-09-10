-- Prepared for future activation. Applying this migration does not enable sending.
-- Reservations have no expiry or release operation: an ambiguous provider result
-- must be reconciled with its receipt, never retried as a new send.
BEGIN;

-- Existing CRUD does not consistently advance these versions. A trigger makes
-- the claim's snapshot comparison reliable even for updates outside the app.
CREATE FUNCTION public.touch_property_auto_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_property_auto_snapshot() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER leads_property_auto_snapshot BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_property_auto_snapshot();
CREATE TRIGGER properties_property_auto_snapshot BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.touch_property_auto_snapshot();

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_sender_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_sender_type_check
  CHECK (sender_type IN ('client', 'ai', 'human', 'Cliente', 'Agente de IA', 'Corretor', 'automation'));

CREATE TABLE public.property_auto_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Keep audit identities if a CRM row is later deleted. Do not prevent normal
  -- property/lead deletion or cascade-delete a deduplication reservation.
  -- RPCs verify every company/record relationship before writing.
  lead_id uuid NOT NULL,
  property_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  incoming_message_id uuid NOT NULL,
  incoming_external_message_id text NOT NULL CHECK (length(btrim(incoming_external_message_id)) BETWEEN 1 AND 512),
  recipient_phone text NOT NULL CHECK (length(btrim(recipient_phone)) BETWEEN 1 AND 80),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  state text NOT NULL DEFAULT 'sending' CHECK (state IN ('sending', 'accepted', 'uncertain')),
  provider_message_id text CHECK (length(btrim(provider_message_id)) BETWEEN 1 AND 512),
  outgoing_message_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (company_id, lead_id, property_id),
  UNIQUE (company_id, incoming_message_id),
  -- A provider webhook replay persisted under a second UUID is still one event.
  UNIQUE (company_id, incoming_external_message_id),
  UNIQUE (company_id, provider_message_id),
  CHECK ((state = 'accepted' AND provider_message_id IS NOT NULL
    AND outgoing_message_id IS NOT NULL AND accepted_at IS NOT NULL)
    OR (state IN ('sending', 'uncertain') AND provider_message_id IS NULL
      AND outgoing_message_id IS NULL AND accepted_at IS NULL))
);

ALTER TABLE public.property_auto_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_auto_deliveries FROM PUBLIC, anon, authenticated, service_role;
-- Only the SECURITY DEFINER functions may mutate reservations, including for the
-- service role. In particular, no application caller can delete a claim to retry.
GRANT SELECT ON public.property_auto_deliveries TO service_role;

CREATE FUNCTION public.claim_property_auto_delivery(
  p_company_id uuid,
  p_lead_id uuid,
  p_property_id uuid,
  p_incoming_message_id uuid,
  p_content text,
  p_lead_updated_at timestamptz,
  p_property_updated_at timestamptz,
  p_phone_number_id text,
  p_recipient_phone text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  locked_lead public.leads%ROWTYPE;
  locked_conversation public.conversations%ROWTYPE;
  locked_incoming public.messages%ROWTYPE;
  locked_property public.properties%ROWTYPE;
  incoming_conversation_id uuid;
  latest_incoming_id uuid;
  delivery_id uuid;
  checked_at timestamptz;
BEGIN
  IF p_company_id IS NULL OR p_lead_id IS NULL OR p_property_id IS NULL
    OR p_incoming_message_id IS NULL OR p_lead_updated_at IS NULL OR p_property_updated_at IS NULL
    OR p_phone_number_id IS NULL OR p_phone_number_id !~ '^[0-9]{5,30}$'
    OR p_recipient_phone IS NULL OR p_recipient_phone !~ '^[1-9][0-9]{7,14}$'
    OR coalesce(length(btrim(p_content)), 0) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'invalid_property_auto_delivery' USING ERRCODE = '22023';
  END IF;

  -- Lock the lead first: concurrent automatic claims and normal broker assignment
  -- UPDATEs must finish before eligibility is checked. These are transaction locks,
  -- not a lease held across the provider HTTP request.
  SELECT * INTO locked_lead FROM public.leads
    WHERE id = p_lead_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_auto_delivery_lead_not_found'; END IF;

  SELECT conversation_id INTO incoming_conversation_id FROM public.messages
    WHERE id = p_incoming_message_id AND company_id = p_company_id;
  SELECT * INTO locked_conversation FROM public.conversations
    WHERE id = incoming_conversation_id AND company_id = p_company_id AND lead_id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_auto_delivery_conversation_not_found'; END IF;

  SELECT * INTO locked_incoming FROM public.messages
    WHERE id = p_incoming_message_id AND company_id = p_company_id
      AND conversation_id = locked_conversation.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_auto_delivery_incoming_not_found'; END IF;

  SELECT * INTO locked_property FROM public.properties
    WHERE id = p_property_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_auto_delivery_property_not_found'; END IF;

  -- Ownership has been verified before returning duplicate status.
  IF EXISTS (SELECT 1 FROM public.property_auto_deliveries d WHERE d.company_id = p_company_id
    AND ((d.lead_id = p_lead_id AND d.property_id = p_property_id)
      OR d.incoming_message_id = p_incoming_message_id
      OR d.incoming_external_message_id = locked_incoming.external_message_id)) THEN
    RETURN NULL;
  END IF;

  IF locked_lead.updated_at IS DISTINCT FROM p_lead_updated_at
    OR locked_property.updated_at IS DISTINCT FROM p_property_updated_at THEN
    RAISE EXCEPTION 'property_auto_delivery_stale_snapshot';
  END IF;
  IF nullif(btrim(locked_lead.assigned_to), '') IS NOT NULL
    OR nullif(btrim(locked_conversation.assigned_to), '') IS NOT NULL
    OR locked_conversation.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'property_auto_delivery_human_handoff';
  END IF;
  IF locked_lead.lifecycle_status IS NULL OR locked_lead.lifecycle_status NOT IN ('Novo', 'Em atendimento') THEN
    RAISE EXCEPTION 'property_auto_delivery_inactive_lead';
  END IF;
  IF locked_property.status IS DISTINCT FROM 'Disponível' THEN
    RAISE EXCEPTION 'property_auto_delivery_property_unavailable';
  END IF;
  IF coalesce(length(btrim(locked_lead.phone)), 0) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'property_auto_delivery_invalid_recipient';
  END IF;
  checked_at := clock_timestamp();
  -- Ingestion must preserve the original provider timestamp in messages.created_at;
  -- importing an old event with a new insert timestamp does not establish consent.
  IF lower(locked_conversation.channel) IS DISTINCT FROM 'whatsapp'
    -- The verified inbound connector binds receiving number and sender to the
    -- conversation. Events from another connected number cannot be used to send.
    OR locked_conversation.external_conversation_id IS DISTINCT FROM
      ('meta:' || p_phone_number_id || ':' || p_recipient_phone)
    OR locked_incoming.direction NOT IN ('incoming', 'Entrada') OR locked_incoming.direction IS NULL
    OR locked_incoming.sender_type NOT IN ('client', 'Cliente') OR locked_incoming.sender_type IS NULL
    OR coalesce(length(btrim(locked_incoming.external_message_id)), 0) NOT BETWEEN 1 AND 512
    OR locked_incoming.created_at IS NULL OR locked_incoming.created_at > checked_at
    OR locked_lead.updated_at < locked_incoming.created_at
    OR locked_incoming.created_at <= checked_at - interval '24 hours' THEN
    RAISE EXCEPTION 'property_auto_delivery_invalid_incoming';
  END IF;

  SELECT m.id INTO latest_incoming_id FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id AND c.company_id = m.company_id
    WHERE m.company_id = p_company_id AND c.lead_id = p_lead_id
      AND lower(c.channel) = 'whatsapp' AND m.direction IN ('incoming', 'Entrada')
    ORDER BY m.created_at DESC NULLS FIRST, m.id DESC LIMIT 1;
  IF latest_incoming_id IS DISTINCT FROM p_incoming_message_id THEN
    RAISE EXCEPTION 'property_auto_delivery_superseded_incoming';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lead_property_events
    WHERE company_id = p_company_id AND lead_id = p_lead_id AND property_id = p_property_id
      AND event_type = 'Enviado') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.property_auto_deliveries
    (company_id, lead_id, property_id, conversation_id, incoming_message_id,
      incoming_external_message_id, recipient_phone, content)
    VALUES (p_company_id, p_lead_id, p_property_id, locked_conversation.id, p_incoming_message_id,
      locked_incoming.external_message_id, p_recipient_phone, p_content)
    ON CONFLICT DO NOTHING RETURNING id INTO delivery_id;
  -- The unique keys also serialize provider-event conflicts across different leads.
  RETURN delivery_id;
END;
$$;

CREATE FUNCTION public.finish_property_auto_delivery(
  p_company_id uuid, p_delivery_id uuid, p_provider_message_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  delivery public.property_auto_deliveries%ROWTYPE;
  outgoing_id uuid;
  receipt_at timestamptz := clock_timestamp();
BEGIN
  IF p_company_id IS NULL OR p_delivery_id IS NULL
    OR coalesce(length(btrim(p_provider_message_id)), 0) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'invalid_property_auto_delivery_receipt' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO delivery FROM public.property_auto_deliveries
    WHERE id = p_delivery_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_auto_delivery_not_found'; END IF;
  IF delivery.state = 'accepted' THEN
    IF delivery.provider_message_id IS DISTINCT FROM p_provider_message_id THEN
      RAISE EXCEPTION 'property_auto_delivery_receipt_conflict';
    END IF;
    RETURN delivery.outgoing_message_id;
  END IF;

  -- A receipt describes an already accepted provider send. Record it even if a
  -- broker took ownership or the property changed after reservation; never claim
  -- the lead on behalf of automation. Recheck only the tenant relationships.
  IF NOT EXISTS (SELECT 1 FROM public.leads WHERE id = delivery.lead_id AND company_id = p_company_id)
    OR NOT EXISTS (SELECT 1 FROM public.properties WHERE id = delivery.property_id AND company_id = p_company_id)
    OR NOT EXISTS (SELECT 1 FROM public.conversations
      WHERE id = delivery.conversation_id AND company_id = p_company_id AND lead_id = delivery.lead_id)
    OR NOT EXISTS (SELECT 1 FROM public.messages
      WHERE id = delivery.incoming_message_id AND company_id = p_company_id AND conversation_id = delivery.conversation_id) THEN
    RAISE EXCEPTION 'property_auto_delivery_tenant_mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.messages WHERE company_id = p_company_id AND external_message_id = p_provider_message_id)
    OR EXISTS (SELECT 1 FROM public.property_auto_deliveries
      WHERE company_id = p_company_id AND provider_message_id = p_provider_message_id AND id <> delivery.id) THEN
    RAISE EXCEPTION 'property_auto_delivery_receipt_conflict';
  END IF;

  INSERT INTO public.messages
    (company_id, conversation_id, direction, sender_type, content, external_message_id, created_at)
    VALUES (p_company_id, delivery.conversation_id, 'outgoing', 'automation', delivery.content, p_provider_message_id, receipt_at)
    RETURNING id INTO outgoing_id;
  UPDATE public.conversations SET last_message_at = greatest(last_message_at, receipt_at)
    WHERE id = delivery.conversation_id AND company_id = p_company_id;
  INSERT INTO public.lead_property_events (company_id, lead_id, property_id, event_type)
    VALUES (p_company_id, delivery.lead_id, delivery.property_id, 'Enviado');
  UPDATE public.property_auto_deliveries SET state = 'accepted', provider_message_id = p_provider_message_id,
    outgoing_message_id = outgoing_id, accepted_at = receipt_at
    WHERE id = delivery.id AND company_id = p_company_id;
  RETURN outgoing_id;
END;
$$;

CREATE FUNCTION public.mark_property_auto_delivery_uncertain(p_company_id uuid, p_delivery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- A timeout may happen after provider acceptance. This state never releases any
  -- unique key and cannot downgrade an already recorded receipt.
  UPDATE public.property_auto_deliveries SET state = 'uncertain'
    WHERE id = p_delivery_id AND company_id = p_company_id AND state = 'sending';
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.property_auto_deliveries
    WHERE id = p_delivery_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'property_auto_delivery_not_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_property_auto_delivery(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_property_auto_delivery(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_property_auto_delivery_uncertain(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_property_auto_delivery(uuid, uuid, uuid, uuid, text, timestamptz, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_property_auto_delivery(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_property_auto_delivery_uncertain(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
