BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.lead_duty_priorities (
 company_id uuid NOT NULL,lead_id uuid NOT NULL,broker_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),preferred_until timestamptz NOT NULL,
 PRIMARY KEY(company_id,lead_id),
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id) ON DELETE CASCADE,
 CHECK(cardinality(broker_ids)>0)
);
ALTER TABLE public.lead_duty_priorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_duty_priorities FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.lead_duty_priorities TO service_role;

-- Snapshot the active duty roster at intake. Never assign a broker or send messages.
CREATE FUNCTION public.snapshot_lead_duty_priority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE document jsonb; shift jsonb; member_id uuid; start_at timestamptz; end_at timestamptz;
 eligible uuid[]:='{}'::uuid[]; arrived timestamptz:=clock_timestamp(); objective text;
BEGIN
 IF nullif(btrim(NEW.assigned_to),'') IS NOT NULL THEN RETURN NEW; END IF;
 SELECT w.document INTO document FROM public.crm_evolution_workspaces w WHERE w.company_id=NEW.company_id;
 IF document#>>'{settings,operations,dutyPriorityEnabled}' IS DISTINCT FROM 'true' THEN RETURN NEW; END IF;
 objective:=CASE WHEN lower(NEW.goal) IN ('comprar','compra','venda') THEN 'Venda' WHEN lower(NEW.goal) IN ('alugar','aluguel','locação','locacao') THEN 'Aluguel' END;
 FOR shift IN SELECT value FROM jsonb_array_elements(document->'records')
  WHERE value->>'kind'='shifts' AND value#>>'{data,status}'='Ativo' LOOP
  BEGIN
   start_at:=(shift#>>'{data,startsAt}')::timestamptz;end_at:=(shift#>>'{data,endsAt}')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
  END;
  IF start_at IS NULL OR end_at IS NULL OR start_at>arrived OR end_at<=arrived
   OR (objective IS NOT NULL AND coalesce(shift#>>'{data,purpose}' NOT IN (objective,'Ambos'),true)) THEN CONTINUE; END IF;
  SELECT id INTO member_id FROM public.broker_accounts WHERE company_id=NEW.company_id AND active AND id::text=shift#>>'{data,assignedTo}';
  IF FOUND AND NOT member_id=ANY(eligible) THEN eligible:=array_append(eligible,member_id); END IF;
 END LOOP;
 IF cardinality(eligible)>0 THEN
  INSERT INTO public.lead_duty_priorities(company_id,lead_id,broker_ids,created_at,preferred_until)
   VALUES(NEW.company_id,NEW.id,eligible,arrived,arrived+interval '5 minutes');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_lead_duty_priority() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER snapshot_lead_duty_priority AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION public.snapshot_lead_duty_priority();

CREATE OR REPLACE FUNCTION public.change_conversation_owner(p_company_id uuid,p_lead_id uuid,p_broker_id uuid,p_release boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE c public.conversations%ROWTYPE; broker_name text;
BEGIN
 SELECT name INTO broker_name FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF c.assigned_broker_id IS NOT NULL AND c.assigned_broker_id<>p_broker_id THEN RETURN false; END IF;
 IF c.assigned_broker_id IS NULL AND coalesce(c.assigned_to,'') NOT IN ('',broker_name) THEN RETURN false; END IF;
 IF NOT p_release AND c.assigned_broker_id IS NULL AND EXISTS(
  SELECT 1 FROM public.lead_duty_priorities p JOIN public.crm_evolution_workspaces w ON w.company_id=p.company_id
  WHERE p.company_id=p_company_id AND p.lead_id=p_lead_id AND p.preferred_until>clock_timestamp()
   AND w.document#>>'{settings,operations,dutyPriorityEnabled}'='true' AND NOT p_broker_id=ANY(p.broker_ids)
 ) THEN RAISE EXCEPTION 'duty_priority_wait'; END IF;
 UPDATE public.attendance_replies SET state='uncertain' WHERE company_id=p_company_id AND conversation_id=c.id AND state='reserved' AND created_at<now()-interval '2 minutes';
 IF EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=p_company_id AND conversation_id=c.id AND state='reserved') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=c.id AND state='sending') THEN RETURN false; END IF;
 UPDATE public.messages SET delivery_status='failed',delivery_error_code=0 WHERE company_id=p_company_id AND id IN
  (SELECT id FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=c.id AND state='pending');
 UPDATE public.message_outbox SET state='cancelled' WHERE company_id=p_company_id AND conversation_id=c.id AND state='pending';
 UPDATE public.conversations SET assigned_broker_id=CASE WHEN p_release THEN NULL ELSE p_broker_id END,
  assigned_to=CASE WHEN p_release THEN NULL ELSE broker_name END,bot_paused=NOT p_release WHERE company_id=p_company_id AND id=c.id;
 UPDATE public.leads SET assigned_to=CASE WHEN p_release THEN NULL ELSE broker_name END WHERE company_id=p_company_id AND id=p_lead_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.change_conversation_owner(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_conversation_owner(uuid,uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_conversation_inbox(p_company_id uuid,p_broker_id uuid,p_lead_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE priority_enabled boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active) THEN RAISE EXCEPTION 'account_required'; END IF;
 SELECT coalesce(w.document#>>'{settings,operations,dutyPriorityEnabled}'='true',false) INTO priority_enabled FROM public.crm_evolution_workspaces w WHERE w.company_id=p_company_id;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'conversationId',c.id,'leadId',c.lead_id,'lastMessageId',i.last_message_id,
  'lastMessageAt',i.last_message_at,'lastMessageText',left(m.content,300),
  'incomingCount',i.incoming_count,'unread',greatest(0,i.incoming_count-COALESCE(r.read_position,0)),
  'dutyPriorityUntil',CASE WHEN priority_enabled AND c.assigned_broker_id IS NULL AND coalesce(c.assigned_to,'')='' THEN p.preferred_until END,
  'dutyPreferred',coalesce(p_broker_id=ANY(p.broker_ids),false)
 ) ORDER BY i.last_message_at DESC,i.last_message_id DESC)
 FROM public.conversation_inbox i JOIN public.conversations c ON c.id=i.conversation_id AND c.company_id=i.company_id
 JOIN public.messages m ON m.id=i.last_message_id AND m.company_id=i.company_id
 LEFT JOIN public.conversation_reads r ON r.conversation_id=i.conversation_id AND r.broker_id=p_broker_id AND r.company_id=p_company_id
 LEFT JOIN public.lead_duty_priorities p ON p.lead_id=c.lead_id AND p.company_id=c.company_id
 WHERE i.company_id=p_company_id AND (p_lead_id IS NULL OR c.lead_id=p_lead_id)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_conversation_inbox(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_inbox(uuid,uuid,uuid) TO service_role;
-- Activation must prove the additive server schema is installed, not just save a checkbox.
CREATE FUNCTION public.crm_operational_rules_ready(p_company_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'owner_required'; END IF;
 RETURN jsonb_build_object('dutyPriority',to_regclass('public.lead_duty_priorities') IS NOT NULL,
  'inactivePool',to_regclass('public.lead_pool_releases') IS NOT NULL AND to_regprocedure('public.release_inactive_lead_pool(uuid,uuid)') IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.crm_operational_rules_ready(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_operational_rules_ready(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
