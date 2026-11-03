-- One response per property/negotiation. Public callers use a hashed capability;
-- no tenant identifiers, contacts or addresses are exposed by the public API.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.property_feedback_requests (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  case_key text NOT NULL CHECK (length(case_key) BETWEEN 1 AND 150),
  property_key text NOT NULL CHECK (length(property_key) BETWEEN 1 AND 150),
  lead_id uuid,
  requested_by uuid NOT NULL,
  property_name text NOT NULL CHECK (length(property_name) BETWEEN 1 AND 300),
  purpose text NOT NULL CHECK (purpose IN ('Venda','Aluguel')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
  outbox_message_id uuid,
  visit_score smallint CHECK (visit_score BETWEEN 0 AND 5),
  property_score smallint CHECK (property_score BETWEEN 1 AND 5),
  interest text CHECK (interest IN ('Sim','Talvez','Não')),
  comment text CHECK (length(comment)<=2000),
  submitted_at timestamptz,
  UNIQUE(company_id,id),
  UNIQUE(company_id,case_key,property_key),
  FOREIGN KEY(company_id,requested_by) REFERENCES public.broker_accounts(company_id,id),
  FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id),
  FOREIGN KEY(company_id,outbox_message_id) REFERENCES public.messages(company_id,id),
  CHECK (expires_at>created_at),
  CHECK ((submitted_at IS NULL AND visit_score IS NULL AND property_score IS NULL AND interest IS NULL AND comment IS NULL)
    OR (submitted_at IS NOT NULL AND visit_score IS NOT NULL AND property_score IS NOT NULL AND interest IS NOT NULL))
);
ALTER TABLE public.property_feedback_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_feedback_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.property_feedback_requests TO service_role;
CREATE POLICY property_feedback_server_only ON public.property_feedback_requests
  AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false);
CREATE INDEX property_feedback_tenant_case ON public.property_feedback_requests(company_id,case_key,created_at DESC);

CREATE FUNCTION public.ensure_property_feedback_request(
  p_company_id uuid,p_actor_id uuid,p_id uuid,p_case_key text,p_property_key text,p_lead_id uuid,
  p_property_name text,p_purpose text,p_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result public.property_feedback_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active)
    OR (p_lead_id IS NOT NULL AND NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,p_lead_id)) THEN
    RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_lead_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.crm_evolution_workspaces w
    CROSS JOIN LATERAL jsonb_array_elements(w.document->'records') r
    JOIN public.broker_accounts b ON b.company_id=w.company_id AND b.id=p_actor_id AND b.active
    WHERE w.company_id=p_company_id AND r->>'id'=p_case_key AND r->>'kind'='cases'
      AND (b.role='owner' OR r->'data'->>'assignedTo'=p_actor_id::text)) THEN
    RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.property_feedback_requests(id,company_id,case_key,property_key,lead_id,requested_by,property_name,purpose,token_hash)
    VALUES(p_id,p_company_id,p_case_key,p_property_key,p_lead_id,p_actor_id,p_property_name,p_purpose,p_token_hash)
    ON CONFLICT(company_id,case_key,property_key) DO NOTHING;
  SELECT * INTO result FROM public.property_feedback_requests
    WHERE company_id=p_company_id AND case_key=p_case_key AND property_key=p_property_key;
  RETURN to_jsonb(result);
END $$;

CREATE FUNCTION public.submit_property_feedback(p_token_hash text,p_visit_score integer,p_property_score integer,p_interest text,p_comment text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR p_visit_score IS NULL OR p_visit_score NOT BETWEEN 0 AND 5
    OR p_property_score IS NULL OR p_property_score NOT BETWEEN 1 AND 5
    OR p_interest IS NULL OR p_interest NOT IN ('Sim','Talvez','Não')
    OR length(coalesce(p_comment,''))>2000 THEN RETURN false; END IF;
  UPDATE public.property_feedback_requests SET visit_score=p_visit_score,property_score=p_property_score,
    interest=p_interest,comment=nullif(btrim(p_comment),''),submitted_at=now()
    WHERE token_hash=p_token_hash AND expires_at>now() AND submitted_at IS NULL;
  RETURN FOUND;
END $$;

-- Reuse the same queue, idempotency, conversation ownership and 24h policy as
-- normal messages. An unavailable window leaves the link ready for manual use.
CREATE FUNCTION public.queue_property_feedback(p_company_id uuid,p_actor_id uuid,p_request_id uuid,p_content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.property_feedback_requests%ROWTYPE; c public.conversations%ROWTYPE; message_id uuid; conversation_count integer;
BEGIN
  SELECT * INTO r FROM public.property_feedback_requests WHERE company_id=p_company_id AND id=p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active)
    OR (r.lead_id IS NOT NULL AND NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,r.lead_id)) THEN
    RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
  END IF;
  IF r.outbox_message_id IS NOT NULL THEN RETURN jsonb_build_object('outboxId',r.outbox_message_id); END IF;
  IF r.submitted_at IS NOT NULL OR r.expires_at<=now() THEN RETURN jsonb_build_object('reason','Pesquisa encerrada.'); END IF;
  SELECT count(*) INTO conversation_count FROM public.conversations WHERE company_id=p_company_id AND lead_id=r.lead_id AND channel='WhatsApp';
  IF conversation_count<>1 THEN RETURN jsonb_build_object('reason','Copie o link e escolha a conversa do cliente para enviar.'); END IF;
  SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND lead_id=r.lead_id AND channel='WhatsApp' FOR UPDATE;
  IF c.assigned_broker_id IS NULL OR NOT public.crm_evolution_can_edit_lead(p_company_id,c.assigned_broker_id,r.lead_id) THEN
    RETURN jsonb_build_object('reason','Assuma a conversa para enviar a avaliação.');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE company_id=p_company_id AND conversation_id=c.id AND direction='incoming'
    AND created_at>now()-interval '24 hours' AND created_at<=now()+interval '5 minutes') THEN
    RETURN jsonb_build_object('reason','Fora da janela do WhatsApp. Copie o link ou aguarde uma nova mensagem do cliente.');
  END IF;
  message_id:=public.enqueue_conversation_message(p_company_id,c.id,'property-feedback:'||r.id::text,p_content,c.assigned_broker_id,NULL);
  UPDATE public.messages SET sender_type='ai' WHERE company_id=p_company_id AND id=message_id;
  UPDATE public.property_feedback_requests SET outbox_message_id=message_id WHERE company_id=p_company_id AND id=r.id;
  RETURN jsonb_build_object('outboxId',message_id);
END $$;
REVOKE ALL ON FUNCTION public.ensure_property_feedback_request(uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.submit_property_feedback(text,integer,integer,text,text),public.queue_property_feedback(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_property_feedback_request(uuid,uuid,uuid,text,text,uuid,text,text,text),
  public.submit_property_feedback(text,integer,integer,text,text),public.queue_property_feedback(uuid,uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
