BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE public.lead_pool_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
 lead_id uuid NOT NULL, last_contact_at timestamptz NOT NULL,
 previous_owners jsonb NOT NULL, released_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id),
 CHECK(jsonb_typeof(previous_owners)='array')
);
ALTER TABLE public.lead_pool_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_pool_releases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.lead_pool_releases TO service_role;
CREATE INDEX lead_pool_releases_history ON public.lead_pool_releases(company_id,lead_id,released_at DESC);

-- Persist scan fairness: protected/busy contacts must not starve the rest of a large portfolio.
CREATE TABLE public.lead_pool_reviews (
 company_id uuid NOT NULL, lead_id uuid NOT NULL, last_checked_at timestamptz NOT NULL,
 PRIMARY KEY(company_id,lead_id),
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id)
);
ALTER TABLE public.lead_pool_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_pool_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.lead_pool_reviews TO service_role;

-- Fixed, user-approved 30-day policy. No messages, deletion or bot reactivation.
CREATE FUNCTION public.release_inactive_lead_pool(p_company_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE workspace public.crm_evolution_workspaces%ROWTYPE; candidate record; l public.leads%ROWTYPE;
 locked_conversations uuid[]; total_conversations integer; last_contact timestamptz;
 owners jsonb; protected_case_ids text[]; is_protected boolean;
 released integer:=0; protected_leads jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'owner_required'; END IF;
 -- Same workspace-before-canonical-row order as the integrated CRM transaction.
 SELECT * INTO workspace FROM public.crm_evolution_workspaces WHERE company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR workspace.document#>>'{settings,operations,inactivePoolEnabled}' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('released',0,'protected','[]'::jsonb); END IF;
 FOR candidate IN SELECT source.id FROM public.leads source
  LEFT JOIN public.lead_pool_reviews review ON review.company_id=source.company_id AND review.lead_id=source.id
  WHERE source.company_id=p_company_id AND source.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
   AND coalesce(source.last_contact_at,source.created_at)<=now()-interval '30 days'
   AND (nullif(btrim(source.assigned_to),'') IS NOT NULL OR EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=p_company_id AND c.lead_id=source.id AND c.assigned_broker_id IS NOT NULL))
  ORDER BY review.last_checked_at NULLS FIRST,coalesce(source.last_contact_at,source.created_at),source.id LIMIT 25 LOOP
  INSERT INTO public.lead_pool_reviews(company_id,lead_id,last_checked_at) VALUES(p_company_id,candidate.id,clock_timestamp())
   ON CONFLICT(company_id,lead_id) DO UPDATE SET last_checked_at=excluded.last_checked_at;
  SELECT count(*) INTO total_conversations FROM public.conversations WHERE company_id=p_company_id AND lead_id=candidate.id;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO locked_conversations FROM (
   SELECT id FROM public.conversations WHERE company_id=p_company_id AND lead_id=candidate.id ORDER BY id FOR UPDATE SKIP LOCKED
  ) locked;
  IF cardinality(locked_conversations)<>total_conversations THEN CONTINUE; END IF;
  SELECT * INTO l FROM public.leads WHERE company_id=p_company_id AND id=candidate.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR l.lifecycle_status NOT IN ('Novo','Em atendimento','Visita','Proposta') THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND state IN ('pending','sending','uncertain'))
   OR EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND state='reserved')
   OR EXISTS(SELECT 1 FROM public.attendance_turns WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND lease_until>now()) THEN CONTINUE; END IF;
  SELECT greatest(coalesce(l.last_contact_at,l.created_at),max(greatest(m.created_at,CASE WHEN o.state='sent' THEN o.updated_at END))) INTO last_contact
   FROM public.messages m LEFT JOIN public.message_outbox o ON o.company_id=m.company_id AND o.id=m.id
   WHERE m.company_id=p_company_id AND m.conversation_id=ANY(locked_conversations)
    AND (m.direction IN ('incoming','Entrada') OR (m.sender_type IN ('human','Corretor') AND m.direction IN ('outgoing','Saída')
      AND (m.delivery_status='sent' OR (m.delivery_status IS NULL AND m.external_message_id IS NOT NULL))));
  IF last_contact>now()-interval '30 days' THEN CONTINUE; END IF;
  SELECT coalesce(array_agg(r->>'id'),'{}'::text[]) INTO protected_case_ids FROM jsonb_array_elements(workspace.document->'records') r
   WHERE r->>'kind'='cases' AND (r#>>'{data,leadId}'='lead:'||l.id::text OR r#>>'{data,personId}'='person:'||l.id::text OR r->>'id'='case:'||l.id::text);
  is_protected:=l.lifecycle_status IN ('Visita','Proposta')
   OR EXISTS(SELECT 1 FROM public.appointments WHERE company_id=p_company_id AND lead_id=l.id AND scheduled_at>=now() AND status IN ('Agendada','Aguardando','Pendente','Confirmada'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(workspace.document->'records') r WHERE r#>>'{data,caseId}'=ANY(protected_case_ids)
    AND ((r->>'kind'='proposals' AND r#>>'{data,status}' IN ('Enviada','Em negociação','Aceita'))
      OR (r->>'kind'='tasks' AND r#>>'{data,type}'='Visita' AND r#>>'{data,status}' IN ('Pendente','Confirmada')
       AND CASE WHEN r#>>'{data,dueAt}' ~ '^\d{4}-\d{2}-\d{2}T' THEN (r#>>'{data,dueAt}')::timestamptz>=now() ELSE true END)));
  IF is_protected THEN
   protected_leads:=protected_leads||jsonb_build_array(jsonb_build_object('leadId',l.id,'lastContactAt',last_contact));
   CONTINUE;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('conversationId',id,'brokerId',assigned_broker_id,'name',assigned_to)),'[]'::jsonb) INTO owners
   FROM public.conversations WHERE company_id=p_company_id AND id=ANY(locked_conversations);
  INSERT INTO public.lead_pool_releases(company_id,lead_id,last_contact_at,previous_owners)
   VALUES(p_company_id,l.id,last_contact,owners||jsonb_build_array(jsonb_build_object('leadAssignedTo',l.assigned_to)));
  UPDATE public.conversations SET assigned_broker_id=NULL,assigned_to=NULL,bot_paused=true
   WHERE company_id=p_company_id AND id=ANY(locked_conversations);
  UPDATE public.leads SET assigned_to=NULL WHERE company_id=p_company_id AND id=l.id;
  released:=released+1;
 END LOOP;
 RETURN jsonb_build_object('released',released,'protected',protected_leads);
END $$;
REVOKE ALL ON FUNCTION public.release_inactive_lead_pool(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_inactive_lead_pool(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
