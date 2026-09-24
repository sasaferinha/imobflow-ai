BEGIN;
-- UI tombstones, NOT data erasure. Preserve inbound IDs, outbox and delivery audit.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS dashboard_hidden_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS dashboard_hidden_by uuid;
ALTER TABLE public.messages ADD CONSTRAINT messages_dashboard_hidden_broker_fk
  FOREIGN KEY(company_id,dashboard_hidden_by) REFERENCES public.broker_accounts(company_id,id);
ALTER TABLE public.messages ADD CONSTRAINT messages_dashboard_visibility_pair
  CHECK ((dashboard_hidden_at IS NULL) = (dashboard_hidden_by IS NULL));

CREATE FUNCTION public.hide_dashboard_message(p_company_id uuid,p_broker_id uuid,p_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor_role text; c public.conversations%ROWTYPE; target_conversation uuid;
BEGIN
  SELECT role INTO actor_role FROM public.broker_accounts
    WHERE company_id=p_company_id AND id=p_broker_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broker'; END IF;
  SELECT conversation_id INTO target_conversation FROM public.messages
    WHERE company_id=p_company_id AND id=p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_missing'; END IF;
  -- Same conversation lock as enqueue/handoff, preventing stale ownership checks.
  SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND id=target_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'message_missing'; END IF;
  IF actor_role<>'owner' AND c.assigned_broker_id IS DISTINCT FROM p_broker_id THEN
    RAISE EXCEPTION 'visibility_forbidden';
  END IF;
  IF EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND id=p_message_id AND dashboard_hidden_at IS NOT NULL) THEN RETURN; END IF;
  -- Hiding is not a cancellation control. Keep unresolved outbound sends visible.
  IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=p_company_id AND id=p_message_id AND state IN ('pending','sending','uncertain')) THEN
    RAISE EXCEPTION 'message_in_flight';
  END IF;
  UPDATE public.messages SET dashboard_hidden_at=now(),dashboard_hidden_by=p_broker_id
    WHERE company_id=p_company_id AND id=p_message_id AND dashboard_hidden_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.hide_dashboard_message(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hide_dashboard_message(uuid,uuid,uuid) TO service_role;

ALTER TABLE public.demo_conversation_threads ADD COLUMN IF NOT EXISTS hidden_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(hidden_message_ids)='array');
CREATE FUNCTION public.hide_demo_dashboard_message(p_company_id uuid,p_broker_id uuid,p_contact_id text,p_message_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor_role text; t public.demo_conversation_threads%ROWTYPE; seed_count integer;
BEGIN
  SELECT role INTO actor_role FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_broker_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_broker'; END IF;
  seed_count:=CASE WHEN p_contact_id IN ('mariana','ricardo-juliana','beatriz','eduardo','joao','camila') THEN 5
    WHEN p_contact_id IN ('lucas','ana') THEN 4 WHEN p_contact_id IN ('rafael','carla') THEN 3 ELSE 0 END;
  IF seed_count=0 THEN RAISE EXCEPTION 'message_missing'; END IF;
  SELECT * INTO t FROM public.demo_conversation_threads WHERE company_id=p_company_id AND contact_id=p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'demo_claim_required'; END IF;
  IF actor_role<>'owner' AND t.assigned_broker_id IS DISTINCT FROM p_broker_id THEN RAISE EXCEPTION 'visibility_forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.messages) m WHERE m->>'id'=p_message_id)
    AND NOT EXISTS(SELECT 1 FROM generate_series(0,seed_count-1) n WHERE 'example-'||n=p_message_id) THEN
    RAISE EXCEPTION 'message_missing';
  END IF;
  IF t.hidden_message_ids ? p_message_id THEN RETURN; END IF;
  UPDATE public.demo_conversation_threads SET hidden_message_ids=hidden_message_ids||jsonb_build_array(p_message_id),
    revision=revision+1,updated_at=now() WHERE company_id=p_company_id AND contact_id=p_contact_id;
END $$;
REVOKE ALL ON FUNCTION public.hide_demo_dashboard_message(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hide_demo_dashboard_message(uuid,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
