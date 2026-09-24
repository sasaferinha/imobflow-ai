-- Keep the existing matching, tenant, locking and deduplication rules.
-- The legacy parameter stays compatible with existing workers.
DO $migration$
DECLARE definition text;
  condition text := 'AND coalesce(l.last_contact_at,l.created_at)<=now()-make_interval(days=>p_inactive_days)';
BEGIN
  SELECT pg_get_functiondef('public.generate_property_opportunities(uuid,uuid,integer)'::regprocedure) INTO definition;
  IF strpos(definition, condition) > 0 THEN
    EXECUTE replace(definition, condition, '-- Activity age does not exclude a compatible lead.');
  ELSIF strpos(definition, '-- Activity age does not exclude a compatible lead.') = 0 THEN
    RAISE EXCEPTION 'Unexpected opportunity generator definition; inspect before migrating';
  END IF;
END $migration$;

-- Reconsider existing listings on the next scheduled sweep.
UPDATE public.opportunity_sweeps SET cursor=NULL, complete=false;
