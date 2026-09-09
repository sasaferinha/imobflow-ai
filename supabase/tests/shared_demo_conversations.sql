-- Integration checks against the real RPC. Everything in this script rolls back.
BEGIN;
DO $$
DECLARE
  owner_account public.broker_accounts%ROWTYPE;
  broker_account public.broker_accounts%ROWTYPE;
  outsider public.broker_accounts%ROWTYPE;
  test_thread public.demo_conversation_threads%ROWTYPE;
  first_revision bigint;
  initial_count integer;
  test_id text := gen_random_uuid()::text;
  rejected boolean := false;
BEGIN
  SELECT * INTO owner_account FROM public.broker_accounts a
    WHERE a.active AND a.role='owner' AND EXISTS (
      SELECT 1 FROM public.broker_accounts b WHERE b.company_id=a.company_id AND b.active AND b.role='broker'
    ) LIMIT 1;
  IF owner_account.id IS NULL THEN RAISE EXCEPTION 'Existing owner/broker pair required'; END IF;
  SELECT * INTO broker_account FROM public.broker_accounts
    WHERE company_id=owner_account.company_id AND active AND role='broker' LIMIT 1;
  SELECT * INTO test_thread FROM public.record_demo_conversation_action(owner_account.company_id,broker_account.id,'carla',NULL);
  IF test_thread.assigned_broker_id<>broker_account.id THEN RAISE EXCEPTION 'Broker claim failed'; END IF;
  initial_count := jsonb_array_length(test_thread.messages);
  SELECT * INTO test_thread FROM public.record_demo_conversation_action(owner_account.company_id,broker_account.id,'carla',
    jsonb_build_object('id',test_id,'side','outgoing','text','Temporary transactional verification','time','12:00'));
  IF jsonb_array_length(test_thread.messages)<>initial_count+1 THEN RAISE EXCEPTION 'Message not saved'; END IF;
  SELECT * INTO test_thread FROM public.record_demo_conversation_action(owner_account.company_id,owner_account.id,'carla',NULL);
  first_revision := test_thread.revision;
  SELECT * INTO test_thread FROM public.record_demo_conversation_action(owner_account.company_id,broker_account.id,'carla',
    jsonb_build_object('id',test_id,'side','outgoing','text','Temporary transactional verification','time','12:00'));
  IF test_thread.revision<>first_revision OR test_thread.assigned_broker_id<>owner_account.id
    OR jsonb_array_length(test_thread.messages)<>initial_count+1 THEN RAISE EXCEPTION 'Retry overwrote owner or duplicated message'; END IF;
  SELECT * INTO outsider FROM public.broker_accounts WHERE company_id<>owner_account.company_id LIMIT 1;
  IF outsider.id IS NOT NULL THEN
    BEGIN
      PERFORM * FROM public.record_demo_conversation_action(owner_account.company_id,outsider.id,'carla',NULL);
    EXCEPTION WHEN OTHERS THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Cross-company broker was allowed'; END IF;
  END IF;
  IF has_function_privilege('anon','public.record_demo_conversation_action(uuid,uuid,text,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated','public.record_demo_conversation_action(uuid,uuid,text,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'Public RPC execution was allowed';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'PASS: broker/admin assignments, shared messages, idempotent retries, tenant validation and restricted RPC. All test changes rolled back.' AS result;
