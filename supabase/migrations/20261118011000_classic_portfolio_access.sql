-- The classic panel must apply the same canonical portfolio boundary as the
-- evolution workspace. Calls remain server-only; no browser table grant changes.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION public.read_classic_crm_records(
 p_company_id uuid,p_actor_id uuid,p_table text,p_limit integer DEFAULT 10001
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE actor_role text;
BEGIN
 SELECT role INTO actor_role FROM public.broker_accounts
 WHERE company_id=p_company_id AND id=p_actor_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
 IF p_table IS NULL OR p_table NOT IN ('leads','properties','appointments')
   OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10001 THEN
  RAISE EXCEPTION 'classic_crm_invalid' USING ERRCODE='23514';
 END IF;
 -- Return one scalar JSON array, not a table-valued function: PostgREST's
 -- db_max_rows also caps SETOF results and would silently truncate portfolios.
 IF p_table='leads' THEN
  RETURN (SELECT coalesce(jsonb_agg(row),'[]'::jsonb) FROM (SELECT l.* FROM public.leads l
   WHERE l.company_id=p_company_id AND (actor_role='owner' OR public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,l.id))
   ORDER BY l.created_at DESC,l.id LIMIT p_limit) row);
 ELSIF p_table='appointments' THEN
  RETURN (SELECT coalesce(jsonb_agg(row),'[]'::jsonb) FROM (SELECT a.*,l.name AS lead_name,p.title AS property_title FROM public.appointments a
   JOIN public.leads l ON l.company_id=a.company_id AND l.id=a.lead_id
   LEFT JOIN public.properties p ON p.company_id=a.company_id AND p.id=a.property_id
   WHERE a.company_id=p_company_id AND (actor_role='owner' OR public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,a.lead_id))
   ORDER BY a.scheduled_at ASC,a.id LIMIT p_limit) row);
 ELSE
  -- Every active broker can match the shared catalog; editing stays with its captor.
  RETURN (SELECT coalesce(jsonb_agg(row),'[]'::jsonb) FROM (SELECT p.* FROM public.properties p WHERE p.company_id=p_company_id
   ORDER BY p.created_at DESC,p.id LIMIT p_limit) row);
 END IF;
END $$;

CREATE FUNCTION public.write_classic_crm_record(
 p_company_id uuid,p_actor_id uuid,p_table text,p_id uuid,p_action text,p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public SET lock_timeout='5s' AS $$
DECLARE
 actor_role text; actor_name text; actor_normalized text; target_id uuid;
 current_row jsonb; next_row jsonb; data jsonb; allowed text[];
 v_lead_id uuid; property_id uuid; capture_id uuid; assigned_id uuid; assignment_count integer;
 columns_sql text; values_sql text; result jsonb;
BEGIN
 SELECT role,name INTO actor_role,actor_name FROM public.broker_accounts
 WHERE company_id=p_company_id AND id=p_actor_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
 IF p_table IS NULL OR p_table NOT IN ('leads','properties','appointments')
   OR p_action IS NULL OR p_action NOT IN ('insert','update','delete','check')
   OR (p_table='leads' AND p_action<>'update') OR (p_action='check' AND p_table<>'properties')
   OR (p_action<>'insert' AND p_id IS NULL)
   OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR octet_length(p_data::text)>2097152 THEN
  RAISE EXCEPTION 'classic_crm_invalid' USING ERRCODE='23514';
 END IF;
 actor_normalized:=regexp_replace(public.match_normalize(actor_name),'\s+',' ','g');
 target_id:=coalesce(p_id,gen_random_uuid());
 data:=p_data;
 allowed:=CASE p_table
  WHEN 'leads' THEN ARRAY['lifecycle_status','last_contact_at','assigned_to']
  WHEN 'properties' THEN ARRAY['code','title','description','purpose','price','district','city','address','property_type','bedrooms','parking_spaces','area','images','public_url','status','key_in_office','occupied','cataloged_on_instagram','cataloged_on_site','captured_by','updated_at']
  WHEN 'appointments' THEN CASE WHEN p_action='insert' THEN ARRAY['lead_id','property_id','scheduled_at','assigned_to','status','notes'] ELSE ARRAY['status'] END
 END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(data) key WHERE NOT key=ANY(allowed))
   OR (p_action IN ('delete','check') AND data<>'{}'::jsonb) THEN
  RAISE EXCEPTION 'classic_crm_invalid' USING ERRCODE='23514';
 END IF;
 -- Table identifiers are from a fixed allowlist; values are always parameters.
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE company_id=$1 AND id=$2 FOR UPDATE',p_table)
  INTO current_row USING p_company_id,target_id;
 IF p_action='insert' THEN
  IF current_row IS NOT NULL THEN RAISE EXCEPTION 'classic_crm_conflict' USING ERRCODE='40001'; END IF;
 ELSE
  IF current_row IS NULL THEN RETURN NULL; END IF;
 END IF;

 IF p_table='properties' THEN
  IF p_action='insert' THEN
   IF actor_role<>'owner' AND data ? 'captured_by' AND (data->>'captured_by') IS DISTINCT FROM p_actor_id::text THEN
    RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501';
   END IF;
   IF NOT data ? 'captured_by' THEN data:=data||jsonb_build_object('captured_by',p_actor_id); END IF;
  ELSIF actor_role<>'owner' AND (
   (current_row->>'captured_by') IS DISTINCT FROM p_actor_id::text
   OR (data ? 'captured_by' AND (data->>'captured_by') IS DISTINCT FROM p_actor_id::text)
  ) THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
  next_row:=coalesce(current_row,'{}'::jsonb)||data;
  IF nullif(next_row->>'captured_by','') IS NOT NULL AND (p_action='insert' OR (data ? 'captured_by' AND data->'captured_by' IS DISTINCT FROM current_row->'captured_by')) THEN
   capture_id:=(next_row->>'captured_by')::uuid;
   PERFORM 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=capture_id AND active FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
  END IF;
  IF p_action='check' THEN RETURN current_row; END IF;
  IF p_action IN ('insert','update') THEN data:=data||jsonb_build_object('updated_at',clock_timestamp()); END IF;
 ELSE
  v_lead_id:=CASE WHEN p_table='leads' THEN target_id ELSE coalesce(data->>'lead_id',current_row->>'lead_id')::uuid END;
  -- Hold all ownership-bearing rows until the mutation commits. A competing
  -- handoff either wins before these locks or waits; stale access cannot write.
  PERFORM 1 FROM public.leads WHERE company_id=p_company_id AND id=v_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.conversations WHERE company_id=p_company_id AND conversations.lead_id=v_lead_id ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.social_threads WHERE company_id=p_company_id AND social_threads.lead_id=v_lead_id ORDER BY id FOR SHARE;
  IF NOT public.crm_evolution_can_edit_lead(p_company_id,p_actor_id,v_lead_id) THEN
   RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501';
  END IF;
  IF p_table='leads' THEN
   IF data ? 'lifecycle_status' AND (data->>'lifecycle_status' IS NULL OR data->>'lifecycle_status' NOT IN ('Novo','Em atendimento','Visita','Proposta','Convertido','Perdido')) THEN
    RAISE EXCEPTION 'classic_crm_invalid' USING ERRCODE='23514';
   END IF;
   IF data ? 'assigned_to' AND data->'assigned_to' IS DISTINCT FROM current_row->'assigned_to' AND (
    EXISTS(SELECT 1 FROM public.conversations WHERE company_id=p_company_id AND conversations.lead_id=v_lead_id)
    OR EXISTS(SELECT 1 FROM public.social_threads WHERE company_id=p_company_id AND social_threads.lead_id=v_lead_id)
   ) THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
  ELSE
   IF p_action<>'insert' AND coalesce(current_row->>'status','') NOT IN ('Aguardando','Agendada','Confirmada') THEN RETURN NULL; END IF;
   IF p_action='insert' THEN
    IF NOT data ? 'assigned_to' AND actor_role<>'owner' THEN data:=data||jsonb_build_object('assigned_to',actor_name); END IF;
    IF NOT data ? 'status' THEN data:=data||jsonb_build_object('status','Aguardando'); END IF;
    IF nullif(data->>'scheduled_at','') IS NULL OR NOT isfinite((data->>'scheduled_at')::timestamptz) THEN
     RAISE EXCEPTION 'classic_crm_invalid' USING ERRCODE='23514';
    END IF;
    property_id:=nullif(data->>'property_id','')::uuid;
    IF property_id IS NOT NULL THEN
     PERFORM 1 FROM public.properties WHERE company_id=p_company_id AND id=property_id AND status NOT IN ('Vendido','Alugado') FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
    END IF;
   END IF;
   IF data ? 'status' AND (data->>'status' IS NULL OR data->>'status' NOT IN ('Aguardando','Agendada','Confirmada')) THEN
    RAISE EXCEPTION 'classic_crm_invalid' USING ERRCODE='23514';
   END IF;
  END IF;
  IF data ? 'assigned_to' THEN
   IF actor_role<>'owner' AND regexp_replace(public.match_normalize(data->>'assigned_to'),'\s+',' ','g') IS DISTINCT FROM actor_normalized THEN
    RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501';
   END IF;
   IF nullif(btrim(data->>'assigned_to'),'') IS NOT NULL THEN
    SELECT count(*),(array_agg(id))[1] INTO assignment_count,assigned_id FROM public.broker_accounts
     WHERE company_id=p_company_id AND active AND regexp_replace(public.match_normalize(name),'\s+',' ','g')=regexp_replace(public.match_normalize(data->>'assigned_to'),'\s+',' ','g');
    IF assignment_count<>1 THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
    PERFORM 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=assigned_id AND active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501'; END IF;
    IF p_table='appointments' AND NOT public.crm_evolution_can_edit_lead(p_company_id,assigned_id,v_lead_id) THEN
     RAISE EXCEPTION 'classic_crm_forbidden' USING ERRCODE='42501';
    END IF;
   END IF;
  END IF;
 END IF;
 IF p_action='delete' THEN
  EXECUTE format('DELETE FROM public.%I WHERE company_id=$1 AND id=$2',p_table) USING p_company_id,target_id;
  RETURN current_row;
 END IF;
 IF p_action='insert' THEN
  data:=data||jsonb_build_object('company_id',p_company_id,'id',target_id);
  SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('typed.%I',key),',' ORDER BY key)
   INTO columns_sql,values_sql FROM jsonb_object_keys(data) key;
  EXECUTE format('INSERT INTO public.%I AS t(%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) typed RETURNING to_jsonb(t)',p_table,columns_sql,values_sql,p_table)
   INTO result USING data;
 ELSE
  IF data='{}'::jsonb THEN RETURN current_row; END IF;
  SELECT string_agg(format('%I=typed.%I',key,key),',' ORDER BY key) INTO columns_sql FROM jsonb_object_keys(data) key;
  EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) typed WHERE t.company_id=$2 AND t.id=$3 RETURNING to_jsonb(t)',p_table,columns_sql,p_table)
   INTO result USING data,p_company_id,target_id;
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.read_classic_crm_records(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.write_classic_crm_record(uuid,uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_classic_crm_records(uuid,uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.write_classic_crm_record(uuid,uuid,text,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
