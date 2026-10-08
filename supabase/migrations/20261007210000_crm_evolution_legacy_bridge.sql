-- Additive bridge only. No rows are imported, re-assigned, deleted or seeded.
-- Apply after 20261007190000_crm_evolution_workspace.sql. Turning off the new
-- interface keeps both the canonical rows and the workspace/audit history.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Deliberately narrower than the legacy read permissions: ambiguous ownership
-- is administrator-only, and an authoritative conversation UUID wins over names.
CREATE FUNCTION public.crm_evolution_can_edit_lead(p_company_id uuid, p_actor_id uuid, p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor_name text; actor_role text; assigned_ids uuid[]; assigned_names text[]; identity_name text;
BEGIN
  SELECT name, role INTO actor_name, actor_role FROM public.broker_accounts
    WHERE company_id=p_company_id AND id=p_actor_id AND active;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id) THEN RETURN false; END IF;
  IF actor_role='owner' THEN RETURN true; END IF;
  SELECT array_agg(DISTINCT assigned_broker_id) FILTER (WHERE assigned_broker_id IS NOT NULL)
    INTO assigned_ids FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id;
  IF cardinality(assigned_ids)>0 THEN
    RETURN cardinality(assigned_ids)=1 AND assigned_ids[1]=p_actor_id AND NOT EXISTS (
      SELECT 1 FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id
        AND assigned_broker_id IS NULL AND nullif(btrim(assigned_to),'') IS NOT NULL
        AND regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g')<>
          regexp_replace(public.match_normalize(actor_name),'\s+',' ','g')
    );
  END IF;
  SELECT array_agg(DISTINCT normalized) FILTER (WHERE normalized<>'') INTO assigned_names FROM (
    SELECT regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g') normalized
      FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id
    UNION ALL
    SELECT regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g')
      FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id
  ) names;
  identity_name := regexp_replace(public.match_normalize(actor_name),'\s+',' ','g');
  RETURN coalesce(cardinality(assigned_names)=1 AND assigned_names[1]=identity_name AND
    (SELECT count(*)=1 FROM public.broker_accounts WHERE company_id=p_company_id AND active AND
      regexp_replace(public.match_normalize(name),'\s+',' ','g')=identity_name),false);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_evolution_can_edit_lead(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.commit_crm_evolution_changes(
  p_company_id uuid, p_actor_id uuid, p_expected_version bigint, p_document jsonb, p_writes jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public SET lock_timeout = '5s' AS $$
DECLARE
  actor_name text; actor_role text; item jsonb; data jsonb; expected jsonb; current_data jsonb; next_data jsonb;
  target_table text; target_id uuid; operation text; allowed text[]; field text; columns_sql text; values_sql text;
  related_lead_id uuid; related_property_id uuid; assigned_name text; assigned_actor uuid; assignments integer; affected integer;
  profile_fields text[] := ARRAY['purpose','propertyType','regions','budgetMin','budgetMax','features'];
BEGIN
  SELECT name, role INTO actor_name, actor_role FROM public.broker_accounts
    WHERE company_id=p_company_id AND id=p_actor_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'crm_actor_forbidden' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_writes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_writes)>100
    OR octet_length(p_writes::text)>2097152 THEN
    RAISE EXCEPTION 'crm_bridge_invalid' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_writes) value
    GROUP BY value->>'table',value->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'crm_bridge_duplicate_write' USING ERRCODE='23514';
  END IF;

  -- The exception block is a subtransaction: conflicts roll back the workspace
  -- CAS AND every preceding canonical write, not just the last statement.
  BEGIN
    IF NOT public.save_crm_evolution_workspace(p_company_id,p_actor_id,p_expected_version,p_document) THEN RETURN false; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_writes) LOOP
      target_table := item->>'table'; operation := item->>'operation'; data := item->'data'; expected := item->'expected';
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR target_table IS NULL
        OR target_table NOT IN ('leads','properties','appointments') OR operation IS NULL OR operation NOT IN ('insert','update')
        OR jsonb_typeof(data) IS DISTINCT FROM 'object'
        OR coalesce(item->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(item) key WHERE key NOT IN ('table','id','operation','expected','data')) THEN
        RAISE EXCEPTION 'crm_bridge_invalid' USING ERRCODE='23514';
      END IF;
      target_id := (item->>'id')::uuid;
      allowed := CASE target_table
        WHEN 'leads' THEN ARRAY['name','phone','email','goal','property_type','region','budget_min','budget_max','details','summary','score','temperature','lifecycle_status','source','assigned_to','interest_profile']
        WHEN 'properties' THEN ARRAY['code','title','description','purpose','price','district','city','address','property_type','bedrooms','parking_spaces','area','images','public_url','status','key_in_office','occupied','cataloged_on_instagram','cataloged_on_site']
        WHEN 'appointments' THEN ARRAY['lead_id','property_id','scheduled_at','assigned_to','status','notes'] END;
      IF operation='insert' THEN allowed := allowed || ARRAY['id','company_id']; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(data) key WHERE NOT key=ANY(allowed)) THEN
        RAISE EXCEPTION 'crm_bridge_field_forbidden' USING ERRCODE='23514';
      END IF;
      IF operation='insert' AND (expected IS DISTINCT FROM 'null'::jsonb
        OR (data->>'id') IS DISTINCT FROM target_id::text OR (data->>'company_id') IS DISTINCT FROM p_company_id::text) THEN
        RAISE EXCEPTION 'crm_bridge_identity_invalid' USING ERRCODE='23514';
      END IF;
      current_data := NULL;
      EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 AND company_id=$2 FOR UPDATE',target_table)
        INTO current_data USING target_id,p_company_id;
      IF operation='update' THEN
        IF current_data IS NULL THEN RAISE EXCEPTION 'crm_source_conflict' USING ERRCODE='40001'; END IF;
        IF jsonb_typeof(expected) IS DISTINCT FROM 'object' OR (expected->>'id') IS DISTINCT FROM target_id::text
          OR (expected->>'company_id') IS DISTINCT FROM p_company_id::text
          OR EXISTS (SELECT 1 FROM jsonb_each(expected) e WHERE NOT current_data ? e.key) THEN
          RAISE EXCEPTION 'crm_bridge_expected_invalid' USING ERRCODE='23514';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_each(expected) e WHERE current_data->e.key IS DISTINCT FROM e.value) THEN
          RAISE EXCEPTION 'crm_source_conflict' USING ERRCODE='40001';
        END IF;
      ELSIF current_data IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.leads WHERE target_table='leads' AND id=target_id
        UNION ALL SELECT 1 FROM public.properties WHERE target_table='properties' AND id=target_id
        UNION ALL SELECT 1 FROM public.appointments WHERE target_table='appointments' AND id=target_id
      ) THEN RAISE EXCEPTION 'crm_source_conflict' USING ERRCODE='40001';
      END IF;
      next_data := coalesce(current_data,'{}'::jsonb) || data;

      IF data ? 'assigned_to' AND nullif(data->>'assigned_to','') IS NOT NULL THEN
        assigned_name := regexp_replace(public.match_normalize(data->>'assigned_to'),'\s+',' ','g');
        SELECT count(*), (array_agg(id))[1] INTO assignments,assigned_actor FROM public.broker_accounts
          WHERE company_id=p_company_id AND active AND regexp_replace(public.match_normalize(name),'\s+',' ','g')=assigned_name;
        IF assignments<>1 THEN RAISE EXCEPTION 'crm_assignee_forbidden' USING ERRCODE='42501'; END IF;
        PERFORM 1 FROM public.broker_accounts WHERE id=assigned_actor AND company_id=p_company_id AND active FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'crm_assignee_forbidden' USING ERRCODE='42501'; END IF;
      END IF;
      IF target_table='properties' THEN
        IF actor_role<>'owner' THEN RAISE EXCEPTION 'crm_catalog_forbidden' USING ERRCODE='42501'; END IF;
      ELSIF target_table='leads' THEN
        PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND conversations.lead_id=target_id FOR SHARE;
        IF operation='update' AND NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,target_id) THEN
          RAISE EXCEPTION 'crm_portfolio_forbidden' USING ERRCODE='42501';
        END IF;
        IF actor_role<>'owner' AND (operation='insert' OR data ? 'assigned_to') AND
          regexp_replace(public.match_normalize(next_data->>'assigned_to'),'\s+',' ','g')<>
          regexp_replace(public.match_normalize(actor_name),'\s+',' ','g') THEN
          RAISE EXCEPTION 'crm_reassignment_forbidden' USING ERRCODE='42501';
        END IF;
        IF operation='update' AND data ? 'assigned_to' AND data->'assigned_to' IS DISTINCT FROM current_data->'assigned_to'
          AND EXISTS (SELECT 1 FROM public.conversations WHERE company_id=p_company_id AND conversations.lead_id=target_id) THEN
          RAISE EXCEPTION 'crm_use_conversation_handoff' USING ERRCODE='42501';
        END IF;
        IF operation='update' AND data ? 'interest_profile' AND
          ((data->'interest_profile') - profile_fields) IS DISTINCT FROM ((current_data->'interest_profile') - profile_fields) THEN
          RAISE EXCEPTION 'crm_qualification_history_immutable' USING ERRCODE='23514';
        END IF;
      ELSE
        IF operation='update' AND data ? 'lead_id' AND data->'lead_id' IS DISTINCT FROM current_data->'lead_id' THEN
          RAISE EXCEPTION 'crm_appointment_client_immutable' USING ERRCODE='23514';
        END IF;
        related_lead_id := (next_data->>'lead_id')::uuid; related_property_id := nullif(next_data->>'property_id','')::uuid;
        PERFORM 1 FROM public.leads WHERE id=related_lead_id AND company_id=p_company_id FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'crm_related_client_forbidden' USING ERRCODE='42501'; END IF;
        PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND conversations.lead_id=related_lead_id FOR SHARE;
        IF NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,related_lead_id) THEN
          RAISE EXCEPTION 'crm_portfolio_forbidden' USING ERRCODE='42501';
        END IF;
        IF related_property_id IS NOT NULL THEN
          PERFORM 1 FROM public.properties WHERE id=related_property_id AND company_id=p_company_id FOR SHARE;
          IF NOT FOUND THEN RAISE EXCEPTION 'crm_related_property_forbidden' USING ERRCODE='42501'; END IF;
        END IF;
        IF actor_role<>'owner' AND data ? 'assigned_to' AND
          regexp_replace(public.match_normalize(data->>'assigned_to'),'\s+',' ','g')<>
          regexp_replace(public.match_normalize(actor_name),'\s+',' ','g') THEN
          RAISE EXCEPTION 'crm_reassignment_forbidden' USING ERRCODE='42501';
        END IF;
      END IF;

      IF data='{}'::jsonb THEN CONTINUE; END IF;
      -- Identifiers come exclusively from the allowlist. Values are bound JSON,
      -- cast with the table's actual types (including production text[] photos).
      SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('typed.%I',key),',' ORDER BY key)
        INTO columns_sql,values_sql FROM jsonb_object_keys(data) key;
      IF operation='insert' THEN
        EXECUTE format('INSERT INTO public.%I(%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) typed',
          target_table,columns_sql,values_sql,target_table) USING data;
      ELSE
        SELECT string_agg(format('%I=typed.%I',key,key),',' ORDER BY key) INTO columns_sql FROM jsonb_object_keys(data) key;
        EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) typed WHERE t.id=$2 AND t.company_id=$3',
          target_table,columns_sql,target_table) USING data,target_id,p_company_id;
      END IF;
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected<>1 THEN RAISE EXCEPTION 'crm_source_conflict' USING ERRCODE='40001'; END IF;
    END LOOP;
    RETURN true;
  EXCEPTION WHEN serialization_failure OR unique_violation THEN
    RETURN false;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_crm_evolution_changes(uuid,uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_crm_evolution_changes(uuid,uuid,bigint,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
