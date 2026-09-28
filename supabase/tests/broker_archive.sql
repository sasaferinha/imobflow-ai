-- Isolated fixtures only. Always rolled back, including the history test table.
BEGIN;
CREATE TABLE archive_test_history(id integer PRIMARY KEY, broker_id uuid REFERENCES broker_accounts(id), content text);
DO $$
DECLARE tenant uuid := gen_random_uuid(); other_tenant uuid := gen_random_uuid();
  owner_id uuid := gen_random_uuid(); target_id uuid := gen_random_uuid();
  inactive_id uuid := gen_random_uuid(); foreign_id uuid := gen_random_uuid();
  hash text := 'scrypt-v1$' || repeat('a',32) || '$' || repeat('b',128);
  stamp timestamptz;
BEGIN
  INSERT INTO companies(id,name,slug) VALUES(tenant,'Archive test','archive-test'),(other_tenant,'Other','archive-other');
  INSERT INTO account_companies(company_id,name,name_key) VALUES(tenant,'Archive test','archive-test'),(other_tenant,'Other','archive-other');
  INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active) VALUES
    (owner_id,tenant,'Owner','owner',hash,'owner',true),
    (target_id,tenant,'Broker','broker',hash,'broker',true),
    (inactive_id,tenant,'Inactive','inactive',hash,'broker',false),
    (foreign_id,other_tenant,'Foreign','foreign',hash,'broker',true);
  INSERT INTO archive_test_history VALUES(1,target_id,'Preserved message/sale attribution');
  INSERT INTO account_sessions(token_hash,broker_id,expires_at) VALUES(repeat('a',64),target_id,now()+interval '1 hour');
  INSERT INTO account_password_resets(token_hash,broker_id,password_version) VALUES(repeat('b',64),target_id,hash);
  BEGIN
    PERFORM archive_company_broker(target_id,inactive_id);
    RAISE EXCEPTION 'test_expected_owner_guard';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'owner_required' THEN RAISE; END IF; END;
  BEGIN
    PERFORM archive_company_broker(owner_id,foreign_id);
    RAISE EXCEPTION 'test_expected_tenant_guard';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'broker_not_found' THEN RAISE; END IF; END;
  BEGIN
    PERFORM archive_company_broker(owner_id,owner_id);
    RAISE EXCEPTION 'test_expected_owner_protection';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'broker_not_found' THEN RAISE; END IF; END;
  PERFORM archive_company_broker(owner_id,target_id);
  IF NOT EXISTS(SELECT 1 FROM broker_accounts WHERE id=target_id AND NOT active AND archived_at IS NOT NULL AND auth_version=1) THEN RAISE EXCEPTION 'archive_failed'; END IF;
  IF EXISTS(SELECT 1 FROM account_sessions WHERE broker_id=target_id) THEN RAISE EXCEPTION 'session_retained'; END IF;
  IF EXISTS(SELECT 1 FROM account_password_resets WHERE broker_id=target_id) THEN RAISE EXCEPTION 'reset_retained'; END IF;
  IF NOT EXISTS(SELECT 1 FROM archive_test_history WHERE broker_id=target_id AND content='Preserved message/sale attribution') THEN RAISE EXCEPTION 'history_lost'; END IF;
  IF issue_account_session(target_id,repeat('c',64),hash,1) THEN RAISE EXCEPTION 'archived_login_allowed'; END IF;
  SELECT archived_at INTO stamp FROM broker_accounts WHERE id=target_id;
  PERFORM archive_company_broker(owner_id,target_id);
  IF (SELECT archived_at FROM broker_accounts WHERE id=target_id) IS DISTINCT FROM stamp THEN RAISE EXCEPTION 'not_idempotent'; END IF;
  PERFORM archive_company_broker(owner_id,inactive_id);
  IF (SELECT count(*) FROM broker_accounts WHERE company_id=tenant AND archived_at IS NULL) <> 1 THEN RAISE EXCEPTION 'list_not_filtered'; END IF;
  IF NOT (SELECT active FROM broker_accounts WHERE id=foreign_id) THEN RAISE EXCEPTION 'foreign_changed'; END IF;
  BEGIN
    PERFORM set_company_broker_active(owner_id,target_id,true);
    RAISE EXCEPTION 'test_expected_reactivation_guard';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF has_function_privilege('anon','public.archive_company_broker(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.archive_company_broker(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.archive_company_broker(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'unsafe_grants'; END IF;
END;
$$;
ROLLBACK;
