BEGIN;
SET LOCAL lock_timeout='5s';

-- Only a verified, newly received webhook advances notification evidence.
-- Retained Instagram history and rows predating this migration stay silent.
ALTER TABLE public.social_messages ADD COLUMN notification_eligible boolean NOT NULL DEFAULT false;
CREATE INDEX social_waiting_evidence ON public.social_messages(company_id,thread_id,occurred_at,id)
 WHERE notification_eligible AND direction='incoming';

CREATE FUNCTION public.mark_social_notification_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE first_arrival timestamptz;
BEGIN
 IF NEW.last_inbound_message_id IS NULL OR NEW.last_inbound_message_id IS NOT DISTINCT FROM OLD.last_inbound_message_id
   OR NEW.last_inbound_at IS NULL OR NOT isfinite(NEW.last_inbound_at) OR NEW.last_inbound_at>now() THEN RETURN NEW; END IF;
 UPDATE public.social_messages SET notification_eligible=true
 WHERE company_id=NEW.company_id AND thread_id=NEW.id AND id=NEW.last_inbound_message_id
  AND direction='incoming' AND status='received' AND occurred_at=NEW.last_inbound_at;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT min(occurred_at) INTO first_arrival FROM public.social_messages
 WHERE company_id=NEW.company_id AND thread_id=NEW.id AND notification_eligible AND direction='incoming';
 UPDATE public.lead_duty_priorities SET preferred_until=least(preferred_until,first_arrival+interval '5 minutes')
 WHERE company_id=NEW.company_id AND lead_id=NEW.lead_id AND preferred_until>first_arrival+interval '5 minutes';
 RETURN NEW;
END $$;
CREATE TRIGGER social_notification_evidence AFTER UPDATE OF last_inbound_message_id,last_inbound_at ON public.social_threads
FOR EACH ROW EXECUTE FUNCTION public.mark_social_notification_evidence();

-- Read the same admission rule for the button and again inside the transaction.
-- A compliance hold blocks new work, never completion of an existing portfolio.
CREATE FUNCTION public.social_claim_policy(p_company_id uuid,p_actor_id uuid,p_thread_id uuid)
RETURNS TABLE(duty_priority_until timestamptz,duty_preferred boolean,blocked_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH context AS (
  SELECT b.id,b.role,b.name,t.assigned_broker_id,l.assigned_to,
   CASE WHEN w.document#>>'{settings,operations,dutyPriorityEnabled}'='true'
    AND t.assigned_broker_id IS NULL AND nullif(btrim(l.assigned_to),'') IS NULL
    AND EXISTS(SELECT 1 FROM public.broker_presence bp JOIN public.broker_accounts active ON active.company_id=bp.company_id AND active.id=bp.broker_id
     WHERE bp.company_id=p_company_id AND bp.broker_id=ANY(d.broker_ids) AND active.active
      AND bp.last_seen_at>now()-interval '2 minutes' AND NOT public.broker_management_blocked(p_company_id,bp.broker_id))
    THEN least(d.preferred_until,coalesce(first_wait.at+interval '5 minutes',d.preferred_until)) END AS until_at,
   coalesce(b.id=ANY(d.broker_ids) AND presence.last_seen_at>now()-interval '2 minutes',false) AS preferred
  FROM public.broker_accounts b JOIN public.social_threads t ON t.company_id=b.company_id AND t.id=p_thread_id
  JOIN public.leads l ON l.company_id=t.company_id AND l.id=t.lead_id
  LEFT JOIN public.crm_evolution_workspaces w ON w.company_id=t.company_id
  LEFT JOIN public.lead_duty_priorities d ON d.company_id=t.company_id AND d.lead_id=t.lead_id
  LEFT JOIN public.broker_presence presence ON presence.company_id=b.company_id AND presence.broker_id=b.id
  LEFT JOIN LATERAL(SELECT min(m.occurred_at) at FROM public.social_messages m
   WHERE m.company_id=t.company_id AND m.thread_id=t.id AND m.notification_eligible AND m.direction='incoming') first_wait ON true
  WHERE b.company_id=p_company_id AND b.id=p_actor_id AND b.active
 )
 SELECT until_at,preferred,CASE
  WHEN role='owner' THEN NULL
  WHEN (assigned_broker_id IS NOT NULL AND assigned_broker_id<>id)
    OR (nullif(btrim(assigned_to),'') IS NOT NULL AND assigned_to<>name) THEN 'social_forbidden'
  WHEN assigned_broker_id IS DISTINCT FROM id AND public.broker_management_blocked(p_company_id,id) THEN 'broker_compliance_pending'
  WHEN assigned_broker_id IS NULL AND until_at>now() AND NOT preferred THEN 'duty_priority_wait'
  ELSE NULL END FROM context;
$$;

CREATE FUNCTION public.broker_social_waiting(p_company_id uuid,p_broker_id uuid)
RETURNS TABLE(company_id uuid,lead_id uuid,waiting_message_id uuid,waiting_since timestamptz,duty_priority_until timestamptz,duty_preferred boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT b.company_id,l.id,waiting.id,waiting.occurred_at,policy.duty_priority_until,policy.duty_preferred
 FROM public.broker_accounts b
 JOIN public.social_threads t ON t.company_id=b.company_id
 JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id AND a.enabled
 JOIN public.leads l ON l.company_id=t.company_id AND l.id=t.lead_id AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
 LEFT JOIN public.crm_evolution_workspaces w ON w.company_id=b.company_id
 LEFT JOIN public.broker_presence presence ON presence.company_id=b.company_id AND presence.broker_id=b.id
 CROSS JOIN LATERAL public.social_claim_policy(b.company_id,b.id,t.id) policy
 CROSS JOIN LATERAL (
  SELECT m.id,m.occurred_at FROM public.social_messages m
  WHERE m.company_id=t.company_id AND m.thread_id=t.id AND m.direction='incoming' AND m.notification_eligible
   AND isfinite(m.occurred_at) AND m.occurred_at<=now()
  ORDER BY m.occurred_at,m.id LIMIT 1
 ) waiting
 WHERE b.company_id=p_company_id AND b.id=p_broker_id AND b.active
  AND t.assigned_broker_id IS NULL AND nullif(btrim(t.assigned_to),'') IS NULL AND nullif(btrim(l.assigned_to),'') IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=l.company_id AND c.lead_id=l.id
   AND (c.assigned_broker_id IS NOT NULL OR nullif(btrim(c.assigned_to),'') IS NOT NULL OR c.status IN ('closed','Encerrada')))
  AND (b.role='owner' OR NOT public.broker_management_blocked(b.company_id,b.id))
  AND (b.role='owner' OR w.document#>>'{settings,operations,dutyPriorityEnabled}' IS DISTINCT FROM 'true'
   OR presence.last_seen_at>now()-interval '2 minutes'
   OR waiting.occurred_at<=now()-make_interval(mins=>greatest(5,least(60,coalesce((w.document#>>'{settings,management,offlineFallbackMinutes}')::integer,5)))))
 UNION ALL
 SELECT b.company_id,l.id,waiting.id,waiting.occurred_at,NULL::timestamptz,false
 FROM public.broker_accounts b
 JOIN public.social_threads t ON t.company_id=b.company_id
 JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id AND a.enabled
 JOIN public.leads l ON l.company_id=t.company_id AND l.id=t.lead_id AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
 LEFT JOIN public.crm_evolution_workspaces w ON w.company_id=b.company_id
 CROSS JOIN LATERAL (
  SELECT m.id,m.occurred_at FROM public.social_messages m
  WHERE m.company_id=t.company_id AND m.thread_id=t.id AND m.direction='incoming' AND m.notification_eligible
   AND isfinite(m.occurred_at) AND m.occurred_at<=now()
   AND NOT EXISTS(SELECT 1 FROM public.social_messages reply
    WHERE reply.company_id=t.company_id AND reply.thread_id=t.id AND reply.direction='outgoing'
     AND reply.source IN ('human','workflow') AND reply.actor_id IS NOT NULL AND reply.status='sent'
     AND isfinite(reply.updated_at) AND reply.updated_at<=now() AND reply.updated_at>=m.occurred_at)
  ORDER BY m.occurred_at,m.id LIMIT 1
 ) waiting
 WHERE b.company_id=p_company_id AND b.id=p_broker_id AND b.active AND b.role='owner'
  AND (t.assigned_broker_id IS NOT NULL OR nullif(btrim(t.assigned_to),'') IS NOT NULL OR nullif(btrim(l.assigned_to),'') IS NOT NULL)
  AND waiting.occurred_at<=now()-make_interval(hours=>greatest(1,least(8760,coalesce((w.document#>>'{settings,operations,contactLimitHours}')::integer,48))));
$$;

-- Keep the established WhatsApp query unchanged, then extend its common entry
-- point. Push admission, last-moment revalidation and the in-app endpoint all
-- share the same union; no duplicate scheduler, receipts or cooldowns.
CREATE FUNCTION public.broker_whatsapp_waiting(p_company_id uuid,p_broker_id uuid)
RETURNS TABLE(company_id uuid,lead_id uuid,waiting_message_id uuid,waiting_since timestamptz,duty_priority_until timestamptz,duty_preferred boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT b.company_id,l.id,first_wait.id,first_wait.created_at,
  CASE WHEN w.document#>>'{settings,operations,dutyPriorityEnabled}'='true' THEN duty.preferred_until END,
  coalesce(b.id=ANY(duty.broker_ids) AND presence.last_seen_at>now()-interval '2 minutes',false)
 FROM public.broker_accounts b
 JOIN public.leads l ON l.company_id=b.company_id AND nullif(btrim(l.assigned_to),'') IS NULL
  AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
 LEFT JOIN public.crm_evolution_workspaces w ON w.company_id=b.company_id
 LEFT JOIN public.lead_duty_priorities duty ON duty.company_id=l.company_id AND duty.lead_id=l.id
 LEFT JOIN public.broker_presence presence ON presence.company_id=b.company_id AND presence.broker_id=b.id
 CROSS JOIN LATERAL (
  SELECT m.id,m.created_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
  WHERE c.company_id=l.company_id AND c.lead_id=l.id AND m.direction IN ('incoming','Entrada') AND isfinite(m.created_at) AND m.created_at<=now()
  ORDER BY m.created_at,m.id LIMIT 1
 ) first_wait
 WHERE b.id=p_broker_id AND b.company_id=p_company_id AND b.active AND (b.role='owner' OR NOT public.broker_management_blocked(b.company_id,b.id))
  AND (b.role='owner' OR w.document#>>'{settings,operations,dutyPriorityEnabled}' IS DISTINCT FROM 'true' OR presence.last_seen_at>now()-interval '2 minutes' OR first_wait.created_at<=now()-make_interval(mins=>greatest(5,least(60,coalesce((w.document#>>'{settings,management,offlineFallbackMinutes}')::integer,5)))))
  AND NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=l.company_id AND c.lead_id=l.id
   AND (c.assigned_broker_id IS NOT NULL OR nullif(btrim(c.assigned_to),'') IS NOT NULL OR c.status IN ('closed','Encerrada')))
 UNION ALL
 SELECT b.company_id,l.id,waiting.id,waiting.created_at,NULL::timestamptz,false
 FROM public.broker_accounts b JOIN public.leads l ON l.company_id=b.company_id AND (nullif(btrim(l.assigned_to),'') IS NOT NULL OR EXISTS(SELECT 1 FROM public.conversations assigned WHERE assigned.company_id=l.company_id AND assigned.lead_id=l.id AND (assigned.assigned_broker_id IS NOT NULL OR nullif(btrim(assigned.assigned_to),'') IS NOT NULL)))
  AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
 LEFT JOIN public.crm_evolution_workspaces w ON w.company_id=b.company_id
 CROSS JOIN LATERAL (
  SELECT m.id,m.created_at FROM public.messages m JOIN public.conversations c ON c.company_id=m.company_id AND c.id=m.conversation_id
  WHERE c.company_id=l.company_id AND c.lead_id=l.id AND c.status NOT IN ('closed','Encerrada') AND m.direction IN ('incoming','Entrada') AND isfinite(m.created_at) AND m.created_at<=now()
   AND NOT EXISTS(SELECT 1 FROM public.messages reply JOIN public.conversations rc ON rc.company_id=reply.company_id AND rc.id=reply.conversation_id
    WHERE rc.company_id=l.company_id AND rc.lead_id=l.id AND reply.direction IN ('outgoing','Saída','Saida') AND reply.sender_type IN ('human','Corretor')
     AND (reply.delivery_status IN ('sent','delivered','read') OR reply.delivery_status IS NULL AND nullif(reply.external_message_id,'') IS NOT NULL)
     AND isfinite(reply.created_at) AND reply.created_at>=m.created_at AND reply.created_at<=now())
  ORDER BY m.created_at,m.id LIMIT 1
 ) waiting
 WHERE b.company_id=p_company_id AND b.id=p_broker_id AND b.active AND b.role='owner'
  AND waiting.created_at<=now()-make_interval(hours=>greatest(1,least(8760,coalesce((w.document#>>'{settings,operations,contactLimitHours}')::integer,48))));
$$;

CREATE OR REPLACE FUNCTION public.broker_unassigned_waiting(p_company_id uuid,p_broker_id uuid)
RETURNS TABLE(company_id uuid,lead_id uuid,waiting_message_id uuid,waiting_since timestamptz,duty_priority_until timestamptz,duty_preferred boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT * FROM public.broker_whatsapp_waiting(p_company_id,p_broker_id)
 UNION ALL SELECT * FROM public.broker_social_waiting(p_company_id,p_broker_id);
$$;

CREATE FUNCTION public.social_attention_state(p_company_id uuid,p_actor_id uuid,p_channel text,p_thread_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; open_now boolean;
BEGIN
 SELECT * INTO actor FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
 IF NOT FOUND OR p_channel NOT IN ('instagram','facebook') OR coalesce(cardinality(p_thread_ids),0)>101 THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 open_now:=public.web_push_business_hours_open(p_company_id,now());
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('threadId',t.id,'dutyPriorityUntil',policy.duty_priority_until,
  'dutyPreferred',policy.duty_preferred,'claimBlockedReason',policy.blocked_reason,'waitingSince',waiting.waiting_since,
  'urgent',coalesce(open_now AND waiting.waiting_since<=now()-CASE
    WHEN waiting.duty_priority_until IS NOT NULL AND waiting.waiting_since<waiting.duty_priority_until AND waiting.duty_preferred
    THEN interval '2 minutes' ELSE interval '5 minutes' END,false)))
 FROM public.social_threads t JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id
 JOIN public.leads l ON l.company_id=t.company_id AND l.id=t.lead_id
 CROSS JOIN LATERAL public.social_claim_policy(p_company_id,p_actor_id,t.id) policy
 LEFT JOIN LATERAL(SELECT w.* FROM public.broker_social_waiting(p_company_id,p_actor_id) w WHERE w.lead_id=t.lead_id ORDER BY w.waiting_since LIMIT 1) waiting ON true
 WHERE t.company_id=p_company_id AND a.channel=p_channel AND (p_thread_ids IS NULL OR t.id=ANY(p_thread_ids))
  AND (actor.role='owner' OR ((t.assigned_broker_id IS NULL OR t.assigned_broker_id=actor.id)
   AND (nullif(btrim(l.assigned_to),'') IS NULL OR l.assigned_to=actor.name)))), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.social_handoff(p_company_id uuid,p_actor_id uuid,p_thread_id uuid,p_mode text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE actor public.broker_accounts%ROWTYPE; t public.social_threads%ROWTYPE; policy record;
BEGIN
 SELECT * INTO actor FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active FOR SHARE;
 IF NOT FOUND OR p_mode NOT IN ('human','suggestions','automatic') THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=p_thread_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 PERFORM 1 FROM public.leads WHERE company_id=p_company_id AND id=t.lead_id FOR UPDATE;
 SELECT * INTO policy FROM public.social_claim_policy(p_company_id,p_actor_id,p_thread_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 IF policy.blocked_reason IS NOT NULL THEN RAISE EXCEPTION '%',policy.blocked_reason; END IF;
 IF p_mode='automatic' AND actor.role<>'owner' THEN RAISE EXCEPTION 'social_owner_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.social_messages WHERE company_id=p_company_id AND thread_id=t.id AND status='sending' AND updated_at>now()-interval '2 minutes') THEN RAISE EXCEPTION 'social_sending'; END IF;
 UPDATE public.social_threads SET mode=p_mode,assigned_broker_id=CASE WHEN p_mode='automatic' THEN NULL ELSE actor.id END,
  assigned_to=CASE WHEN p_mode='automatic' THEN NULL ELSE actor.name END WHERE company_id=p_company_id AND id=t.id;
 UPDATE public.leads SET assigned_to=CASE WHEN p_mode='automatic' THEN NULL ELSE actor.name END WHERE company_id=p_company_id AND id=t.lead_id;
 UPDATE public.social_messages SET status='failed',error_code='handoff',error_message='O atendimento mudou antes do envio.',updated_at=now()
  WHERE company_id=p_company_id AND thread_id=t.id AND status='pending';
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.mark_social_notification_evidence() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.social_claim_policy(uuid,uuid,uuid),public.broker_social_waiting(uuid,uuid),public.broker_whatsapp_waiting(uuid,uuid),public.social_attention_state(uuid,uuid,text,uuid[]),public.broker_unassigned_waiting(uuid,uuid),public.social_handoff(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_claim_policy(uuid,uuid,uuid),public.broker_social_waiting(uuid,uuid),public.broker_whatsapp_waiting(uuid,uuid),public.social_attention_state(uuid,uuid,text,uuid[]),public.broker_unassigned_waiting(uuid,uuid),public.social_handoff(uuid,uuid,uuid,text) TO service_role;
-- Extend the existing 30-day pool with canonical social evidence. No outbound
-- messages, deletion, automatic replies or reassignment to another broker.
CREATE OR REPLACE FUNCTION public.release_inactive_lead_pool(p_company_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='3s' AS $$
DECLARE workspace public.crm_evolution_workspaces%ROWTYPE; candidate record; l public.leads%ROWTYPE;
 locked_conversations uuid[]; total_conversations integer; last_contact timestamptz; observed_at timestamptz:=now();
 owners jsonb; protected_case_ids text[]; is_protected boolean; uncertain_history boolean;
 social_message jsonb; social_contact timestamptz; social_history jsonb;
 locked_social_threads uuid[]; total_social_threads integer; canonical_contact timestamptz; canonical_uncertain boolean; social_owners jsonb;
 released integer:=0; protected_leads jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO workspace FROM public.crm_evolution_workspaces WHERE company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR workspace.document#>>'{settings,operations,inactivePoolEnabled}' IS DISTINCT FROM 'true' THEN RETURN jsonb_build_object('released',0,'protected','[]'::jsonb); END IF;
 FOR candidate IN SELECT source.id FROM public.leads source
  LEFT JOIN public.lead_pool_reviews review ON review.company_id=source.company_id AND review.lead_id=source.id
  WHERE source.company_id=p_company_id AND source.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
   AND (source.created_at IS NULL OR NOT isfinite(source.created_at) OR source.created_at<=observed_at-interval '30 days')
   AND (nullif(btrim(source.assigned_to),'') IS NOT NULL OR EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=p_company_id AND c.lead_id=source.id AND c.assigned_broker_id IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.social_threads t WHERE t.company_id=p_company_id AND t.lead_id=source.id AND (t.assigned_broker_id IS NOT NULL OR nullif(btrim(t.assigned_to),'') IS NOT NULL)))
  ORDER BY review.last_checked_at NULLS FIRST,source.created_at,source.id LIMIT 25 LOOP
  INSERT INTO public.lead_pool_reviews(company_id,lead_id,last_checked_at) VALUES(p_company_id,candidate.id,clock_timestamp())
   ON CONFLICT(company_id,lead_id) DO UPDATE SET last_checked_at=excluded.last_checked_at;
  SELECT count(*) INTO total_conversations FROM public.conversations WHERE company_id=p_company_id AND lead_id=candidate.id;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO locked_conversations FROM (
   SELECT id FROM public.conversations WHERE company_id=p_company_id AND lead_id=candidate.id ORDER BY id FOR UPDATE SKIP LOCKED
  ) locked;
  IF cardinality(locked_conversations)<>total_conversations THEN CONTINUE; END IF;
  -- Match social intake/handoff ordering: thread before its canonical lead.
  SELECT count(*) INTO total_social_threads FROM public.social_threads WHERE company_id=p_company_id AND lead_id=candidate.id;
  SELECT coalesce(array_agg(id),'{}'::uuid[]) INTO locked_social_threads FROM (
   SELECT id FROM public.social_threads WHERE company_id=p_company_id AND lead_id=candidate.id ORDER BY id FOR UPDATE SKIP LOCKED
  ) locked;
  IF cardinality(locked_social_threads)<>total_social_threads THEN CONTINUE; END IF;
  SELECT * INTO l FROM public.leads WHERE company_id=p_company_id AND id=candidate.id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR l.lifecycle_status NOT IN ('Novo','Em atendimento','Visita','Proposta') THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.message_outbox WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND state IN ('pending','sending','uncertain'))
   OR EXISTS(SELECT 1 FROM public.attendance_replies WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND state='reserved')
   OR EXISTS(SELECT 1 FROM public.attendance_turns WHERE company_id=p_company_id AND conversation_id=ANY(locked_conversations) AND lease_until>observed_at)
   OR EXISTS(SELECT 1 FROM public.social_messages WHERE company_id=p_company_id AND thread_id=ANY(locked_social_threads) AND direction='outgoing' AND status IN ('pending','sending','unknown'))
   OR EXISTS(SELECT 1 FROM public.social_ai_jobs WHERE company_id=p_company_id AND thread_id=ANY(locked_social_threads) AND status IN ('pending','running')) THEN CONTINUE; END IF;

  SELECT max(contact.at) FILTER (WHERE contact.at IS NOT NULL AND isfinite(contact.at) AND contact.at<=observed_at),
   coalesce(bool_or(contact.at IS NULL OR NOT isfinite(contact.at) OR contact.at>observed_at),false)
   INTO last_contact,uncertain_history
   FROM public.messages m LEFT JOIN public.message_outbox o ON o.company_id=m.company_id AND o.id=m.id
   CROSS JOIN LATERAL (SELECT CASE WHEN m.direction IN ('incoming','Entrada') THEN m.created_at
    ELSE greatest(m.created_at,CASE WHEN o.state='sent' THEN o.updated_at END) END AS at) contact
   WHERE m.company_id=p_company_id AND m.conversation_id=ANY(locked_conversations)
    AND (m.direction IN ('incoming','Entrada') OR (m.sender_type IN ('human','Corretor') AND m.direction IN ('outgoing','Saída')
      AND (m.delivery_status='sent' OR (m.delivery_status IS NULL AND m.external_message_id IS NOT NULL))));

  -- Canonical social rows keep provider-account/tenant identity separate from
  -- editable lead fields. Only verified inbound events and confirmed human
  -- sends advance the clock; failed attempts and automatic replies do not.
  SELECT max(contact.at) FILTER(WHERE contact.at IS NOT NULL AND isfinite(contact.at) AND contact.at<=observed_at),
   coalesce(bool_or(contact.at IS NULL OR NOT isfinite(contact.at) OR contact.at>observed_at),false)
   INTO canonical_contact,canonical_uncertain
   FROM public.social_messages m
   JOIN public.social_threads t ON t.company_id=m.company_id AND t.id=m.thread_id AND t.lead_id=l.id
   JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id AND a.channel IN ('instagram','facebook')
   CROSS JOIN LATERAL(SELECT CASE WHEN m.direction='incoming' THEN m.occurred_at
    WHEN isfinite(m.occurred_at) AND isfinite(m.updated_at) THEN greatest(m.occurred_at,m.updated_at) END AS at) contact
   WHERE m.company_id=p_company_id AND m.thread_id=ANY(locked_social_threads)
    AND nullif(m.external_id,'') IS NOT NULL
    AND ((m.direction='incoming' AND m.status='received' AND m.notification_eligible)
     OR (m.direction='outgoing' AND m.source IN ('human','workflow') AND m.actor_id IS NOT NULL AND m.status='sent'));
  last_contact:=greatest(last_contact,canonical_contact);
  uncertain_history:=uncertain_history OR canonical_uncertain;
  -- A delayed older event need not move the latest verified inbound watermark.
  -- An unverified newer/display-only timestamp still requires owner review.
  IF cardinality(locked_social_threads)>0 AND (canonical_contact IS NULL OR EXISTS(
   SELECT 1 FROM public.social_messages m WHERE m.company_id=p_company_id AND m.thread_id=ANY(locked_social_threads)
    AND m.direction='incoming' AND (NOT m.notification_eligible OR nullif(m.external_id,'') IS NULL)
    AND (NOT isfinite(m.occurred_at) OR m.occurred_at>observed_at OR m.occurred_at>canonical_contact)
  )) THEN uncertain_history:=true; END IF;

  -- Only intake-owned metadata is eligible. The CRM RPC preserves these keys.
  -- contactAt is the original validated webhook time; at may be a display fallback.
  social_history:=l.interest_profile->'socialMessages';
  IF l.source IN ('Instagram Direct','Facebook Messenger') AND (social_history IS NULL OR social_history='[]'::jsonb) AND canonical_contact IS NULL THEN uncertain_history:=true; END IF;
  IF social_history IS NOT NULL THEN
   IF jsonb_typeof(social_history) IS DISTINCT FROM 'array'
    OR l.interest_profile->>'socialChannel' IS DISTINCT FROM 'instagram'
    OR coalesce(l.interest_profile->>'socialSenderId','') !~ '^\d{1,40}$' THEN uncertain_history:=true;
   ELSE
    FOR social_message IN SELECT value FROM jsonb_array_elements(social_history) LOOP
     IF jsonb_typeof(social_message) IS DISTINCT FROM 'object'
      OR coalesce(social_message->>'id','')='' OR coalesce(social_message->>'text','')=''
      OR coalesce(social_message->>'contactAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN
      uncertain_history:=true; CONTINUE;
     END IF;
     BEGIN social_contact:=(social_message->>'contactAt')::timestamptz;
     EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN uncertain_history:=true; CONTINUE;
     END;
     IF NOT isfinite(social_contact) OR social_contact>observed_at THEN uncertain_history:=true; CONTINUE; END IF;
     last_contact:=greatest(last_contact,social_contact);
    END LOOP;
   END IF;
  END IF;
  -- A verified recent exchange always protects the portfolio. Administrative cache
  -- edits never reset this clock; unsupported historical claims require review.
  IF last_contact>observed_at-interval '30 days' THEN CONTINUE; END IF;
  IF l.created_at IS NULL OR NOT isfinite(l.created_at) OR l.created_at>observed_at THEN uncertain_history:=true;
  ELSE last_contact:=greatest(last_contact,l.created_at); END IF;
  IF l.last_contact_at IS NOT NULL AND (NOT isfinite(l.last_contact_at) OR l.last_contact_at>last_contact) THEN uncertain_history:=true; END IF;
  IF uncertain_history THEN
   protected_leads:=protected_leads||jsonb_build_array(jsonb_build_object('leadId',l.id,'lastContactAt',last_contact,'reason','contact-history-unverified'));
   CONTINUE;
  END IF;
  IF last_contact IS NULL OR last_contact>observed_at-interval '30 days' THEN CONTINUE; END IF;
  SELECT coalesce(array_agg(r->>'id'),'{}'::text[]) INTO protected_case_ids FROM jsonb_array_elements(workspace.document->'records') r
   WHERE r->>'kind'='cases' AND (r#>>'{data,leadId}'='lead:'||l.id::text OR r#>>'{data,personId}'='person:'||l.id::text OR r->>'id'='case:'||l.id::text);
  is_protected:=l.lifecycle_status IN ('Visita','Proposta')
   OR EXISTS(SELECT 1 FROM public.appointments WHERE company_id=p_company_id AND lead_id=l.id AND scheduled_at>=observed_at AND status IN ('Agendada','Aguardando','Pendente','Confirmada'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(workspace.document->'records') r WHERE r#>>'{data,caseId}'=ANY(protected_case_ids)
    AND ((r->>'kind'='proposals' AND r#>>'{data,status}' IN ('Enviada','Em negociação','Aceita'))
      OR (r->>'kind'='tasks' AND r#>>'{data,type}'='Visita' AND r#>>'{data,status}' IN ('Pendente','Confirmada')
       AND CASE WHEN r#>>'{data,dueAt}' ~ '^\d{4}-\d{2}-\d{2}T' THEN (r#>>'{data,dueAt}')::timestamptz>=observed_at ELSE true END)));
  IF is_protected THEN
   protected_leads:=protected_leads||jsonb_build_array(jsonb_build_object('leadId',l.id,'lastContactAt',last_contact,'reason','active-commitment'));
   CONTINUE;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('conversationId',id,'brokerId',assigned_broker_id,'name',assigned_to)),'[]'::jsonb) INTO owners
   FROM public.conversations WHERE company_id=p_company_id AND id=ANY(locked_conversations);
  SELECT coalesce(jsonb_agg(jsonb_build_object('socialThreadId',t.id,'channel',a.channel,'brokerId',t.assigned_broker_id,'name',t.assigned_to)),'[]'::jsonb) INTO social_owners
   FROM public.social_threads t JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id
   WHERE t.company_id=p_company_id AND t.id=ANY(locked_social_threads);
  INSERT INTO public.lead_pool_releases(company_id,lead_id,last_contact_at,previous_owners)
   VALUES(p_company_id,l.id,last_contact,owners||social_owners||jsonb_build_array(jsonb_build_object('leadAssignedTo',l.assigned_to)));
  UPDATE public.conversations SET assigned_broker_id=NULL,assigned_to=NULL,bot_paused=true
   WHERE company_id=p_company_id AND id=ANY(locked_conversations);
  UPDATE public.social_threads SET assigned_broker_id=NULL,assigned_to=NULL,mode='human'
   WHERE company_id=p_company_id AND id=ANY(locked_social_threads);
  UPDATE public.leads SET assigned_to=NULL WHERE company_id=p_company_id AND id=l.id;
  released:=released+1;
 END LOOP;
 RETURN jsonb_build_object('released',released,'protected',protected_leads);
END $$;
REVOKE ALL ON FUNCTION public.release_inactive_lead_pool(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_inactive_lead_pool(uuid,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

