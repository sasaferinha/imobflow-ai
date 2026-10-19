BEGIN;
SET LOCAL lock_timeout = '5s';

-- Supersedes the 13/10 policy without rewriting its deployment history.
-- last_contact_at is editable in the classic panel, not proof of an exchange.
CREATE OR REPLACE FUNCTION public.release_inactive_lead_pool(p_company_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE workspace public.crm_evolution_workspaces%ROWTYPE; candidate record; l public.leads%ROWTYPE;
 locked_conversations uuid[]; total_conversations integer; last_contact timestamptz; observed_at timestamptz:=now();
 owners jsonb; protected_case_ids text[]; is_protected boolean; uncertain_history boolean;
 social_message jsonb; social_contact timestamptz; social_history jsonb;
 released integer:=0; protected_leads jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO workspace FROM public.crm_evolution_workspaces WHERE company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR workspace.document#>>'{settings,operations,inactivePoolEnabled}' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('released',0,'protected','[]'::jsonb); END IF;
 FOR candidate IN SELECT source.id FROM public.leads source
  LEFT JOIN public.lead_pool_reviews review ON review.company_id=source.company_id AND review.lead_id=source.id
  WHERE source.company_id=p_company_id AND source.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
   AND (source.created_at IS NULL OR NOT isfinite(source.created_at) OR source.created_at<=observed_at-interval '30 days')
   AND (nullif(btrim(source.assigned_to),'') IS NOT NULL OR EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=p_company_id AND c.lead_id=source.id AND c.assigned_broker_id IS NOT NULL))
  ORDER BY review.last_checked_at NULLS FIRST,source.created_at,source.id LIMIT 25 LOOP
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
   OR EXISTS(SELECT 1 FROM public.attendance_turns WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND lease_until>observed_at) THEN CONTINUE; END IF;

  SELECT max(contact.at) FILTER (WHERE contact.at IS NOT NULL AND isfinite(contact.at) AND contact.at<=observed_at),
   coalesce(bool_or(contact.at IS NULL OR NOT isfinite(contact.at) OR contact.at>observed_at),false)
   INTO last_contact,uncertain_history
   FROM public.messages m LEFT JOIN public.message_outbox o ON o.company_id=m.company_id AND o.id=m.id
   CROSS JOIN LATERAL (SELECT CASE WHEN m.direction IN ('incoming','Entrada') THEN m.created_at
    ELSE greatest(m.created_at,CASE WHEN o.state='sent' THEN o.updated_at END) END AS at) contact
   WHERE m.company_id=p_company_id AND m.conversation_id=ANY(locked_conversations)
    AND (m.direction IN ('incoming','Entrada') OR (m.sender_type IN ('human','Corretor') AND m.direction IN ('outgoing','Saída')
      AND (m.delivery_status='sent' OR (m.delivery_status IS NULL AND m.external_message_id IS NOT NULL))));

  -- Only intake-owned metadata is eligible. The CRM RPC preserves these keys.
  -- contactAt is the original validated webhook time; at may be a display fallback.
  social_history:=l.interest_profile->'socialMessages';
  IF l.source='Instagram Direct' AND (social_history IS NULL OR social_history='[]'::jsonb) THEN uncertain_history:=true; END IF;
  IF social_history IS NOT NULL THEN
   IF jsonb_typeof(social_history) IS DISTINCT FROM 'array'
    OR l.interest_profile->>'socialChannel' IS DISTINCT FROM 'instagram'
    OR coalesce(l.interest_profile->>'socialSenderId','') !~ '^\d{1,40}$' THEN uncertain_history:=true;
   ELSE
    FOR social_message IN SELECT value FROM jsonb_array_elements(social_history) LOOP
     IF jsonb_typeof(social_message) IS DISTINCT FROM 'object'
      OR coalesce(social_message->>'id','')='' OR coalesce(social_message->>'text','')=''
      OR coalesce(social_message->>'contactAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
      uncertain_history:=true; CONTINUE;
     END IF;
     BEGIN social_contact:=(social_message->>'contactAt')::timestamptz;
     EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN uncertain_history:=true; CONTINUE;
     END;
     IF NOT isfinite(social_contact) OR social_contact>observed_at THEN uncertain_history:=true; CONTINUE; END IF;
     last_contact:=greatest(last_contact,social_contact);
    END LOOP;
   END IF;
  END IF;
  -- A verified recent exchange always protects the portfolio. Administrative cache
  -- edits never reset this clock; unsupported historical claims require review.
  IF last_contact>observed_at-interval '30 days' THEN CONTINUE; END IF;
  IF l.created_at IS NULL OR NOT isfinite(l.created_at) OR l.created_at>observed_at THEN uncertain_history:=true;
  ELSE last_contact:=greatest(last_contact,l.created_at); END IF;
  IF l.last_contact_at IS NOT NULL AND (NOT isfinite(l.last_contact_at) OR l.last_contact_at>last_contact) THEN uncertain_history:=true; END IF;
  IF uncertain_history THEN
   protected_leads:=protected_leads||jsonb_build_array(jsonb_build_object('leadId',l.id,'lastContactAt',last_contact,'reason','contact-history-unverified'));
   CONTINUE;
  END IF;
  IF last_contact IS NULL OR last_contact>observed_at-interval '30 days' THEN CONTINUE; END IF;
  SELECT coalesce(array_agg(r->>'id'),'{}'::text[]) INTO protected_case_ids FROM jsonb_array_elements(workspace.document->'records') r
   WHERE r->>'kind'='cases' AND (r#>>'{data,leadId}'='lead:'||l.id::text OR r#>>'{data,personId}'='person:'||l.id::text OR r->>'id'='case:'||l.id::text);
  is_protected:=l.lifecycle_status IN ('Visita','Proposta')
   OR EXISTS(SELECT 1 FROM public.appointments WHERE company_id=p_company_id AND lead_id=l.id AND scheduled_at>=observed_at AND status IN ('Agendada','Aguardando','Pendente','Confirmada'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(workspace.document->'records') r WHERE r#>>'{data,caseId}'=ANY(protected_case_ids)
    AND ((r->>'kind'='proposals' AND r#>>'{data,status}' IN ('Enviada','Em negociação','Aceita'))
      OR (r->>'kind'='tasks' AND r#>>'{data,type}'='Visita' AND r#>>'{data,status}' IN ('Pendente','Confirmada')
       AND CASE WHEN r#>>'{data,dueAt}' ~ '^\d{4}-\d{2}-\d{2}T' THEN (r#>>'{data,dueAt}')::timestamptz>=observed_at ELSE true END)));
  IF is_protected THEN
   protected_leads:=protected_leads||jsonb_build_array(jsonb_build_object('leadId',l.id,'lastContactAt',last_contact,'reason','active-commitment'));
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

CREATE OR REPLACE FUNCTION public.crm_operational_rules_ready(p_company_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'owner_required'; END IF;
 RETURN jsonb_build_object('dutyPriority',to_regclass('public.lead_duty_priorities') IS NOT NULL,
  'inactivePool',to_regclass('public.lead_pool_releases') IS NOT NULL AND to_regprocedure('public.release_inactive_lead_pool(uuid,uuid)') IS NOT NULL,
  'verifiedInactiveContacts',true);
END $$;
REVOKE ALL ON FUNCTION public.crm_operational_rules_ready(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_operational_rules_ready(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
