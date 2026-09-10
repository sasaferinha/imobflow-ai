-- Run AFTER the matching migration. All fixtures and changes are rolled back.
BEGIN;
DO $$
<<test_account>>
DECLARE
  cid uuid:=gen_random_uuid(); other_cid uuid:=gen_random_uuid();
  owner_id uuid:=gen_random_uuid(); broker_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid();
  old_hash text:='scrypt-v1$'||repeat('a',32)||'$'||repeat('b',128);
  new_hash text:='scrypt-v1$'||repeat('c',32)||'$'||repeat('d',128);
  rejected boolean; n integer;
BEGIN
  INSERT INTO public.companies(id,name,slug) VALUES(cid,'Recovery rollback fixture','recovery-'||cid),(other_cid,'Foreign rollback fixture','recovery-'||other_cid);
  INSERT INTO public.account_companies(company_id,name,name_key,seat_limit) VALUES(cid,'Recovery rollback fixture',cid::text,3),(other_cid,'Foreign rollback fixture',other_cid::text,3);
  INSERT INTO public.broker_accounts(id,company_id,name,name_key,email,email_key,password_hash,role) VALUES
    (owner_id,cid,'Owner fixture','owner','owner@example.invalid','owner@example.invalid',old_hash,'owner'),
    (broker_id,cid,'Broker fixture','broker','broker@example.invalid','broker@example.invalid',old_hash,'broker'),
    (foreign_id,other_cid,'Foreign fixture','foreign','foreign@example.invalid','foreign@example.invalid',old_hash,'broker');
  IF NOT public.issue_account_session(broker_id,repeat('1',64),old_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'valid_session_failed'; END IF;
  IF public.issue_account_session(broker_id,repeat('2',64),new_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'stale_hash_session_allowed'; END IF;
  IF public.issue_account_password_reset(broker_id,repeat('3',64),old_hash,'old@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'changed_email_allowed'; END IF;
  IF NOT public.issue_account_password_reset(broker_id,repeat('3',64),old_hash,'broker@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'issue_failed'; END IF;
  IF NOT public.issue_account_password_reset(broker_id,repeat('4',64),old_hash,'broker@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'supersede_failed'; END IF;
  IF public.consume_account_password_reset(repeat('3',64),new_hash) THEN RAISE EXCEPTION 'superseded_token_allowed'; END IF;
  UPDATE public.account_password_resets SET expires_at=now()-interval '1 second' WHERE token_hash=repeat('4',64);
  IF public.consume_account_password_reset(repeat('4',64),new_hash) THEN RAISE EXCEPTION 'expired_token_allowed'; END IF;
  PERFORM public.issue_account_password_reset(broker_id,repeat('5',64),old_hash,'broker@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id));
  IF NOT public.consume_account_password_reset(repeat('5',64),new_hash) THEN RAISE EXCEPTION 'consume_failed'; END IF;
  IF public.consume_account_password_reset(repeat('5',64),old_hash) THEN RAISE EXCEPTION 'reused_token_allowed'; END IF;
  IF EXISTS(SELECT 1 FROM public.account_sessions s WHERE s.broker_id=test_account.broker_id) THEN RAISE EXCEPTION 'sessions_survived_reset'; END IF;
  IF public.issue_account_session(broker_id,repeat('6',64),old_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'old_login_recreated_session'; END IF;
  IF NOT public.issue_account_session(broker_id,repeat('6',64),new_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'new_password_session_failed'; END IF;
  PERFORM public.issue_account_password_reset(broker_id,repeat('7',64),new_hash,'broker@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id));
  PERFORM public.set_company_broker_active(owner_id,broker_id,false);
  IF EXISTS(SELECT 1 FROM public.account_sessions s WHERE s.broker_id=test_account.broker_id) THEN RAISE EXCEPTION 'sessions_survived_deactivation'; END IF;
  IF public.issue_account_session(broker_id,repeat('8',64),new_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=broker_id)) THEN RAISE EXCEPTION 'inactive_session_allowed'; END IF;
  IF public.consume_account_password_reset(repeat('7',64),old_hash) THEN RAISE EXCEPTION 'inactive_reset_allowed'; END IF;
  PERFORM public.set_company_broker_active(owner_id,broker_id,true);
  IF EXISTS(SELECT 1 FROM public.account_sessions s WHERE s.broker_id=test_account.broker_id) THEN RAISE EXCEPTION 'reactivation_restored_sessions'; END IF;
  IF public.issue_account_session(broker_id,repeat('8',64),new_hash,1) THEN RAISE EXCEPTION 'pre_deactivation_session_allowed'; END IF;
  IF NOT public.issue_company_broker_password_reset(owner_id,old_hash,0,broker_id,repeat('e',64)) THEN RAISE EXCEPTION 'admin_broker_reset_failed'; END IF;
  rejected:=false;
  BEGIN PERFORM public.set_company_broker_active(broker_id,owner_id,false); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'broker_managed_owner'; END IF;
  rejected:=false;
  BEGIN PERFORM public.set_company_broker_active(owner_id,owner_id,false); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'owner_deactivated'; END IF;
  rejected:=false;
  BEGIN PERFORM public.set_company_broker_active(owner_id,foreign_id,false); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'foreign_broker_deactivated'; END IF;
  -- Fill the two remaining seats. Owner does not count toward the three seats.
  FOR n IN 1..2 LOOP
    PERFORM public.create_company_broker(cid,'Broker '||n,'broker-'||n,'broker'||n||'@example.invalid','broker'||n||'@example.invalid',old_hash);
  END LOOP;
  rejected:=false;
  BEGIN PERFORM public.create_company_broker(cid,'Fourth broker','fourth','fourth@example.invalid','fourth@example.invalid',old_hash); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'fourth_seat_created'; END IF;
  PERFORM public.set_company_broker_active(owner_id,broker_id,false);
  PERFORM public.create_company_broker(cid,'Replacement broker','replacement','replacement@example.invalid','replacement@example.invalid',old_hash);
  rejected:=false;
  BEGIN PERFORM public.set_company_broker_active(owner_id,broker_id,true); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'fourth_seat_reactivated'; END IF;
  -- Owner self-service changes also invalidate pending reset links and sessions.
  PERFORM public.issue_account_session(owner_id,repeat('9',64),old_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=owner_id));
  PERFORM public.issue_account_password_reset(owner_id,repeat('a',64),old_hash,'owner@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=owner_id));
  IF public.change_account_password(owner_id,new_hash,old_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=owner_id)) THEN RAISE EXCEPTION 'stale_password_change_allowed'; END IF;
  IF NOT public.change_account_password(owner_id,old_hash,new_hash,(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=owner_id)) THEN RAISE EXCEPTION 'own_password_change_failed'; END IF;
  IF public.consume_account_password_reset(repeat('a',64),old_hash) THEN RAISE EXCEPTION 'old_reset_survived_change'; END IF;
  PERFORM public.issue_account_password_reset(owner_id,repeat('b',64),new_hash,'owner@example.invalid',(SELECT b.auth_version FROM public.broker_accounts b WHERE b.id=owner_id));
  UPDATE public.broker_accounts SET email='new@example.invalid',email_key='new@example.invalid' WHERE id=owner_id;
  IF public.consume_account_password_reset(repeat('b',64),old_hash) THEN RAISE EXCEPTION 'reset_survived_email_change'; END IF;

  -- A stale login cannot survive email changes or deactivate/reactivate cycles.
  SELECT b.auth_version INTO n FROM public.broker_accounts b WHERE b.id=owner_id;
  IF public.issue_account_session(owner_id,repeat('c',64),new_hash,NULL) THEN RAISE EXCEPTION 'missing_version_accepted'; END IF;
  IF public.change_account_email(owner_id,old_hash,n,'stale@example.invalid') THEN RAISE EXCEPTION 'stale_password_email_change'; END IF;
  IF public.change_account_email(owner_id,new_hash,n-1,'stale@example.invalid') THEN RAISE EXCEPTION 'stale_version_email_change'; END IF;
  IF NOT public.change_account_email(owner_id,new_hash,n,'updated@example.invalid') THEN RAISE EXCEPTION 'email_change_failed'; END IF;
  IF public.issue_account_session(owner_id,repeat('c',64),new_hash,n) THEN RAISE EXCEPTION 'old_email_login_recreated_session'; END IF;
  IF public.issue_company_broker_password_reset(owner_id,new_hash,n,foreign_id,repeat('d',64)) THEN RAISE EXCEPTION 'stale_owner_issued_link'; END IF;
  SELECT b.auth_version INTO n FROM public.broker_accounts b WHERE b.id=owner_id;
  IF public.issue_company_broker_password_reset(owner_id,new_hash,n,foreign_id,repeat('d',64)) THEN RAISE EXCEPTION 'foreign_owner_reset'; END IF;
  IF has_function_privilege('anon','public.change_account_email(uuid,text,integer,text)','EXECUTE') OR has_function_privilege('authenticated','public.issue_company_broker_password_reset(uuid,text,integer,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'new_rpc_public'; END IF;
  IF has_function_privilege('anon','public.issue_account_session(uuid,text,text,integer)','EXECUTE') OR has_function_privilege('authenticated','public.set_company_broker_active(uuid,uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'privileged_function_public'; END IF;
  IF has_table_privilege('anon','public.account_password_resets','SELECT') THEN RAISE EXCEPTION 'reset_tokens_public'; END IF;
  -- New paid activations get exactly three seats; five-seat requests fail.
  rejected:=false;
  BEGIN PERFORM public.create_access_license(repeat('f',64),5,NULL); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'five_seat_license_created'; END IF;
  PERFORM public.create_access_license(repeat('f',64),3,NULL);
  PERFORM public.redeem_access_license(repeat('f',64),'Basic fixture','basic-'||cid,'Basic owner','basic owner','basic@example.invalid','basic@example.invalid',old_hash);
  IF (SELECT c.seat_limit FROM public.account_companies c WHERE c.name_key='basic-'||cid) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'activation_not_three_seats'; END IF;
  RAISE NOTICE 'PASS recovery, expiry, single-use, session revocation, email version, owner scope, paid activation and three broker seats';
END; $$;
ROLLBACK;
