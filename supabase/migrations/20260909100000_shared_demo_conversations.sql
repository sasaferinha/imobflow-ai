BEGIN;
CREATE TABLE IF NOT EXISTS public.demo_conversation_threads (
  company_id uuid NOT NULL REFERENCES public.account_companies(company_id),
  contact_id text NOT NULL,
  assigned_broker_id uuid NOT NULL REFERENCES public.broker_accounts(id),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages) = 'array'),
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, contact_id)
);
ALTER TABLE public.demo_conversation_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_conversation_threads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.demo_conversation_threads TO service_role;

-- Row locking serializes simultaneous sends. A repeated message id is a retry,
-- not a second message or a new claim of the conversation.
CREATE OR REPLACE FUNCTION public.record_demo_conversation_action(
  p_company_id uuid, p_broker_id uuid, p_contact_id text, p_message jsonb DEFAULT NULL
) RETURNS SETOF public.demo_conversation_threads
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_thread public.demo_conversation_threads%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.broker_accounts
    WHERE id=p_broker_id AND company_id=p_company_id AND active=true) THEN
    RAISE EXCEPTION 'invalid_broker';
  END IF;
  IF p_contact_id NOT IN ('mariana','ricardo-juliana','beatriz','eduardo','joao','camila','lucas','ana','rafael','carla') THEN
    RAISE EXCEPTION 'invalid_demo_contact';
  END IF;
  IF p_message IS NOT NULL AND (jsonb_typeof(p_message) IS DISTINCT FROM 'object'
    OR coalesce(length(p_message->>'id'),0) NOT BETWEEN 1 AND 100
    OR coalesce(length(p_message->>'text'),0) NOT BETWEEN 1 AND 4000) THEN
    RAISE EXCEPTION 'invalid_message';
  END IF;
  INSERT INTO public.demo_conversation_threads(company_id,contact_id,assigned_broker_id)
    VALUES(p_company_id,p_contact_id,p_broker_id) ON CONFLICT DO NOTHING;
  SELECT * INTO current_thread FROM public.demo_conversation_threads
    WHERE company_id=p_company_id AND contact_id=p_contact_id FOR UPDATE;
  IF p_message IS NOT NULL AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(current_thread.messages) AS item WHERE item->>'id'=p_message->>'id'
  ) THEN
    RETURN NEXT current_thread;
    RETURN;
  END IF;
  UPDATE public.demo_conversation_threads SET
    assigned_broker_id=p_broker_id,
    messages=messages || CASE WHEN p_message IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(p_message) END,
    revision=revision+1, updated_at=now()
    WHERE company_id=p_company_id AND contact_id=p_contact_id RETURNING * INTO current_thread;
  RETURN NEXT current_thread;
END;
$$;
REVOKE ALL ON FUNCTION public.record_demo_conversation_action(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_demo_conversation_action(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
