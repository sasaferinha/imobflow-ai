-- Each completed visit receives its own private rating link. Existing links and
-- responses are preserved; creating/finishing a visit never sends a message.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.property_feedback_requests
  ADD COLUMN visit_key text CHECK(length(visit_key) BETWEEN 1 AND 150),
  ADD COLUMN person_key text CHECK(length(person_key) BETWEEN 1 AND 150),
  ADD COLUMN visit_broker_id uuid,
  ADD COLUMN visit_started_at timestamptz,
  ADD COLUMN visit_ended_at timestamptz,
  ADD CONSTRAINT feedback_visit_broker_fk FOREIGN KEY(company_id,visit_broker_id) REFERENCES public.broker_accounts(company_id,id),
  ADD CONSTRAINT feedback_visit_binding CHECK(visit_key IS NULL OR (person_key IS NOT NULL AND visit_broker_id IS NOT NULL AND visit_started_at IS NOT NULL AND visit_ended_at IS NOT NULL AND visit_ended_at>=visit_started_at));
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='public.property_feedback_requests'::regclass
    AND (pg_get_constraintdef(oid)='UNIQUE (company_id, case_key, property_key)' OR contype='c' AND pg_get_constraintdef(oid) LIKE '%submitted_at IS NULL%')
  LOOP EXECUTE format('ALTER TABLE public.property_feedback_requests DROP CONSTRAINT %I',item.conname); END LOOP;
END $$;
CREATE UNIQUE INDEX feedback_legacy_property ON public.property_feedback_requests(company_id,case_key,property_key) WHERE visit_key IS NULL;
CREATE UNIQUE INDEX feedback_exact_visit ON public.property_feedback_requests(company_id,visit_key) WHERE visit_key IS NOT NULL;
ALTER TABLE public.property_feedback_requests ADD CONSTRAINT feedback_answer_state CHECK(
  (submitted_at IS NULL AND visit_score IS NULL AND property_score IS NULL AND interest IS NULL AND comment IS NULL)
  OR (submitted_at IS NOT NULL AND property_score IS NOT NULL));

-- Keep the old RPC available to previously loaded clients and historical sales.
CREATE OR REPLACE FUNCTION public.ensure_property_feedback_request(
  p_company_id uuid,p_actor_id uuid,p_id uuid,p_case_key text,p_property_key text,p_lead_id uuid,
  p_property_name text,p_purpose text,p_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
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
    ON CONFLICT(company_id,case_key,property_key) WHERE visit_key IS NULL DO NOTHING;
  SELECT * INTO result FROM public.property_feedback_requests
    WHERE company_id=p_company_id AND case_key=p_case_key AND property_key=p_property_key AND visit_key IS NULL;
  RETURN to_jsonb(result);
END $$;

CREATE FUNCTION public.ensure_visit_feedback_request(
  p_company_id uuid,p_actor_id uuid,p_id uuid,p_case_key text,p_property_key text,p_lead_id uuid,
  p_property_name text,p_purpose text,p_token_hash text,p_visit_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE doc jsonb; visit jsonb; deal jsonb; person jsonb; property jsonb; actor_role text;
  appointment public.appointments%ROWTYPE; catalog public.properties%ROWTYPE; canonical_name text; matching_brokers uuid[];
  person_id text; broker_id uuid; canonical_lead uuid; started_at timestamptz; ended_at timestamptz;
  result public.property_feedback_requests%ROWTYPE;
BEGIN
  SELECT role INTO actor_role FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active FOR SHARE;
  IF actor_role IS NULL THEN RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501'; END IF;
  SELECT document INTO doc FROM public.crm_evolution_workspaces WHERE company_id=p_company_id FOR SHARE;
  SELECT r INTO visit FROM jsonb_array_elements(doc->'records') r WHERE r->>'id'=p_visit_key AND r->>'kind'='tasks';
  IF visit IS NULL THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
  IF visit#>>'{legacy,table}'='appointments' THEN
    -- Integrated workspaces retain only overlays; links/status/title come from
    -- canonical tenant-scoped rows, not removed JSON fields or caller input.
    SELECT * INTO appointment FROM public.appointments WHERE company_id=p_company_id AND id=(visit#>>'{legacy,id}')::uuid;
    -- Match the ownership writer's conversation -> lead lock order. The lead
    -- lock also serializes social handoff, which changes lead and thread in one
    -- transaction. Workspace SHARE prevents a simultaneous CRM rewrite.
    PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND lead_id=appointment.lead_id ORDER BY id FOR SHARE;
    PERFORM 1 FROM public.leads WHERE company_id=p_company_id AND id=appointment.lead_id FOR SHARE;
    SELECT * INTO appointment FROM public.appointments WHERE company_id=p_company_id AND id=(visit#>>'{legacy,id}')::uuid FOR SHARE;
    IF NOT FOUND OR appointment.status IS DISTINCT FROM 'Realizada'
      OR p_visit_key IS DISTINCT FROM 'appointment:'||appointment.id::text
      OR p_lead_id IS DISTINCT FROM appointment.lead_id
      OR p_property_key IS DISTINCT FROM 'property:'||appointment.property_id::text
      OR p_case_key IS DISTINCT FROM coalesce(nullif(visit->>'negotiationCaseId',''),'case:'||appointment.lead_id::text)
      THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    IF NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,appointment.lead_id)
      THEN RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501'; END IF;
    person_id:='person:'||appointment.lead_id::text;
    IF nullif(visit#>>'{data,visitPersonId}','') IS NOT NULL AND visit#>>'{data,visitPersonId}' IS DISTINCT FROM person_id
      THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    IF nullif(visit->>'negotiationCaseId','') IS NOT NULL THEN
      SELECT r INTO deal FROM jsonb_array_elements(doc->'records') r WHERE r->>'id'=p_case_key AND r->>'kind'='cases';
      IF deal#>>'{data,personId}' IS DISTINCT FROM person_id OR deal#>>'{data,leadId}' IS DISTINCT FROM 'lead:'||appointment.lead_id::text
        THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    END IF;
    SELECT * INTO catalog FROM public.properties WHERE company_id=p_company_id AND id=appointment.property_id;
    IF NOT FOUND OR catalog.purpose IS DISTINCT FROM p_purpose THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    canonical_name:=catalog.title;
    broker_id:=nullif(visit#>>'{data,visitBrokerId}','')::uuid;
    IF broker_id IS NULL THEN
      SELECT array_agg(id) INTO matching_brokers FROM public.broker_accounts WHERE company_id=p_company_id AND (id::text=appointment.assigned_to OR name=appointment.assigned_to);
      IF cardinality(matching_brokers)=1 THEN broker_id:=matching_brokers[1]; END IF;
    END IF;
  ELSE
    SELECT r INTO deal FROM jsonb_array_elements(doc->'records') r WHERE r->>'id'=p_case_key AND r->>'kind'='cases';
    SELECT r INTO property FROM jsonb_array_elements(doc->'records') r WHERE r->>'id'=p_property_key AND r->>'kind'='properties';
    IF deal IS NULL OR property IS NULL OR visit#>>'{data,caseId}' IS DISTINCT FROM p_case_key OR visit#>>'{data,propertyId}' IS DISTINCT FROM p_property_key
      OR visit#>>'{data,type}' IS DISTINCT FROM 'Visita' OR visit#>>'{data,status}' IS DISTINCT FROM 'Realizada'
      OR property#>>'{data,purpose}' IS DISTINCT FROM p_purpose THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    person_id:=coalesce(nullif(visit#>>'{data,visitPersonId}',''),deal#>>'{data,personId}');
    IF person_id IS DISTINCT FROM deal#>>'{data,personId}' THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    SELECT r INTO person FROM jsonb_array_elements(doc->'records') r WHERE r->>'id'=person_id AND r->>'kind'='people';
    canonical_lead:=CASE WHEN person_id ~ '^person:[0-9a-fA-F-]{36}$' THEN substring(person_id from 8)::uuid
      WHEN person#>>'{legacy,table}'='leads' THEN (person#>>'{legacy,id}')::uuid
      WHEN deal#>>'{legacy,table}'='leads' THEN (deal#>>'{legacy,id}')::uuid END;
    IF person IS NULL AND canonical_lead IS NULL THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
    IF canonical_lead IS NOT NULL OR p_lead_id IS NOT NULL THEN
      IF p_lead_id IS DISTINCT FROM canonical_lead THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
      PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND lead_id=canonical_lead ORDER BY id FOR SHARE;
      PERFORM 1 FROM public.leads WHERE company_id=p_company_id AND id=canonical_lead FOR SHARE;
      IF NOT FOUND OR NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,canonical_lead)
        THEN RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501'; END IF;
    ELSIF actor_role<>'owner' AND deal#>>'{data,assignedTo}' IS DISTINCT FROM p_actor_id::text THEN
      RAISE EXCEPTION 'feedback_forbidden' USING ERRCODE='42501';
    END IF;
    broker_id:=coalesce(nullif(visit#>>'{data,visitBrokerId}',''),visit#>>'{data,assignedTo}')::uuid;
    canonical_name:=property#>>'{data,name}';
  END IF;
  started_at:=nullif(visit#>>'{data,visitStartedAt}','')::timestamptz;
  ended_at:=nullif(visit#>>'{data,visitEndedAt}','')::timestamptz;
  IF broker_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=broker_id)
    OR started_at IS NULL OR ended_at IS NULL OR NOT isfinite(started_at) OR NOT isfinite(ended_at) OR ended_at<started_at OR ended_at>now()+interval '5 minutes'
    THEN RAISE EXCEPTION 'feedback_visit_incomplete'; END IF;
  INSERT INTO public.property_feedback_requests(id,company_id,case_key,property_key,lead_id,requested_by,property_name,purpose,token_hash,
    visit_key,person_key,visit_broker_id,visit_started_at,visit_ended_at)
  VALUES(p_id,p_company_id,p_case_key,p_property_key,p_lead_id,p_actor_id,left(canonical_name,300),p_purpose,p_token_hash,
    p_visit_key,person_id,broker_id,started_at,ended_at)
  ON CONFLICT(company_id,visit_key) WHERE visit_key IS NOT NULL DO NOTHING;
  SELECT * INTO result FROM public.property_feedback_requests WHERE company_id=p_company_id AND visit_key=p_visit_key;
  IF result.case_key IS DISTINCT FROM p_case_key OR result.property_key IS DISTINCT FROM p_property_key
    OR result.person_key IS DISTINCT FROM person_id OR result.visit_broker_id IS DISTINCT FROM broker_id
    OR result.visit_started_at IS DISTINCT FROM started_at OR result.visit_ended_at IS DISTINCT FROM ended_at
    THEN RAISE EXCEPTION 'feedback_visit_mismatch'; END IF;
  RETURN to_jsonb(result);
END $$;

CREATE OR REPLACE FUNCTION public.submit_property_feedback(p_token_hash text,p_visit_score integer,p_property_score integer,p_interest text,p_comment text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
    OR (p_visit_score IS NOT NULL AND p_visit_score NOT BETWEEN 0 AND 5)
    OR p_property_score IS NULL OR p_property_score NOT BETWEEN 1 AND 5
    OR (p_interest IS NOT NULL AND p_interest NOT IN ('Sim','Talvez','Não'))
    OR length(coalesce(p_comment,''))>2000 THEN RETURN false; END IF;
  UPDATE public.property_feedback_requests SET visit_score=p_visit_score,property_score=p_property_score,
    interest=p_interest,comment=nullif(btrim(p_comment),''),submitted_at=now()
    WHERE token_hash=p_token_hash AND expires_at>now() AND submitted_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.ensure_visit_feedback_request(uuid,uuid,uuid,text,text,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_visit_feedback_request(uuid,uuid,uuid,text,text,uuid,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
