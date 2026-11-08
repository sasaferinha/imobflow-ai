BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.conversation_owner_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 conversation_id uuid NOT NULL, actor_id uuid NOT NULL, previous_broker_id uuid, next_broker_id uuid,
 action text NOT NULL CHECK(action IN ('release','claim')), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_owner_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_owner_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.conversation_owner_events TO service_role;
CREATE OR REPLACE FUNCTION public.change_conversation_owner(p_company_id uuid,p_lead_id uuid,p_broker_id uuid,p_release boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE c public.conversations%ROWTYPE; broker_name text; administrator boolean;
BEGIN
 SELECT name,role='owner' INTO broker_name,administrator FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO c FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT administrator AND c.assigned_broker_id IS NOT NULL AND c.assigned_broker_id<>p_broker_id THEN RETURN false; END IF;
 IF NOT administrator AND c.assigned_broker_id IS NULL AND coalesce(c.assigned_to,'') NOT IN ('',broker_name) THEN RETURN false; END IF;
 IF NOT administrator AND NOT p_release AND c.assigned_broker_id IS NULL AND EXISTS(
  SELECT 1 FROM public.lead_duty_priorities p JOIN public.crm_evolution_workspaces w ON w.company_id=p.company_id
  WHERE p.company_id=p_company_id AND p.lead_id=p_lead_id AND p.preferred_until>clock_timestamp()
   AND w.document#>>'{settings,operations,dutyPriorityEnabled}'='true' AND NOT p_broker_id=ANY(p.broker_ids)
   AND EXISTS(SELECT 1 FROM public.broker_presence bp JOIN public.broker_accounts active_broker ON active_broker.company_id=bp.company_id AND active_broker.id=bp.broker_id AND active_broker.active WHERE bp.company_id=p_company_id AND bp.broker_id=ANY(p.broker_ids) AND bp.last_seen_at>clock_timestamp()-interval '2 minutes' AND NOT public.broker_management_blocked(p_company_id,bp.broker_id))
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
 INSERT INTO public.conversation_owner_events(company_id,conversation_id,actor_id,previous_broker_id,next_broker_id,action)
 VALUES(p_company_id,c.id,p_broker_id,c.assigned_broker_id,CASE WHEN p_release THEN NULL ELSE p_broker_id END,CASE WHEN p_release THEN 'release' ELSE 'claim' END);
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.change_conversation_owner(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_conversation_owner(uuid,uuid,uuid,boolean) TO service_role;
COMMIT;
