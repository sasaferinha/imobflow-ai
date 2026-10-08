-- Additive, explicitly opt-in workspace for the CRM evolution evaluation.
-- No legacy table is rewritten and no history or production fixtures are seeded.
-- Apply only to the approved isolated database first. Switching off the feature
-- does not drop this table: its documents remain available for a later rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.crm_evolution_workspaces (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id),
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  document jsonb NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, updated_by) REFERENCES public.broker_accounts(company_id, id),
  CHECK (jsonb_typeof(document) = 'object'),
  CHECK ((document->>'companyId') IS NOT DISTINCT FROM company_id::text),
  CHECK (jsonb_typeof(document->'version') = 'number' AND document->>'version' = version::text),
  CHECK (jsonb_typeof(document->'records') = 'array'),
  CHECK (jsonb_typeof(document->'events') = 'array'),
  CHECK (jsonb_typeof(document->'settings') = 'object'),
  CHECK (jsonb_typeof(document->'members') = 'array'),
  CHECK (octet_length(document::text) <= 2097152)
);

ALTER TABLE public.crm_evolution_workspaces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_evolution_workspaces FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.crm_evolution_workspaces TO service_role;
CREATE POLICY crm_evolution_server_only ON public.crm_evolution_workspaces
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER preserve_company_identity BEFORE UPDATE OF company_id
  ON public.crm_evolution_workspaces FOR EACH ROW
  EXECUTE FUNCTION public.prevent_company_reassignment();

-- All mutations use compare-and-swap. Authorization is checked in the server
-- model; this boundary additionally verifies a current actor from this company.
-- An old version can never overwrite a concurrent accepted command.
CREATE FUNCTION public.save_crm_evolution_workspace(
  p_company_id uuid, p_actor_id uuid, p_expected_version bigint, p_document jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE current_row public.crm_evolution_workspaces%ROWTYPE; affected integer; old_events jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.broker_accounts
    WHERE id = p_actor_id AND company_id = p_company_id AND active
  ) THEN
    RAISE EXCEPTION 'crm_actor_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_expected_version >= 9007199254740991
    OR jsonb_typeof(p_document) IS DISTINCT FROM 'object'
    OR (p_document->>'companyId') IS DISTINCT FROM p_company_id::text
    OR (p_document->>'version') IS DISTINCT FROM (p_expected_version + 1)::text
    OR jsonb_typeof(p_document->'records') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_document->'events') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_document->'settings') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_document->'members') IS DISTINCT FROM 'array'
    OR octet_length(p_document::text) > 2097152
  THEN
    RAISE EXCEPTION 'crm_document_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO current_row FROM public.crm_evolution_workspaces
    WHERE company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_expected_version <> 0 THEN RETURN false; END IF;
    INSERT INTO public.crm_evolution_workspaces(company_id, version, document, updated_by)
      VALUES (p_company_id, 1, p_document, p_actor_id) ON CONFLICT (company_id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected = 1;
  END IF;
  IF current_row.version <> p_expected_version THEN RETURN false; END IF;

  -- Even a faulty caller cannot silently replace or truncate audit history.
  SELECT coalesce(jsonb_agg(item.value ORDER BY item.ordinality), '[]'::jsonb)
    INTO old_events FROM jsonb_array_elements(p_document->'events') WITH ORDINALITY AS item(value, ordinality)
    WHERE item.ordinality <= jsonb_array_length(current_row.document->'events');
  IF old_events IS DISTINCT FROM current_row.document->'events' THEN
    RAISE EXCEPTION 'crm_history_immutable' USING ERRCODE = '23514';
  END IF;

  UPDATE public.crm_evolution_workspaces SET version = p_expected_version + 1,
    document = p_document, updated_by = p_actor_id, updated_at = now()
    WHERE company_id = p_company_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_crm_evolution_workspace(uuid,uuid,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_evolution_workspace(uuid,uuid,bigint,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
