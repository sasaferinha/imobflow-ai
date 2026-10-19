BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.web_push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL, broker_id uuid NOT NULL,
 session_hash text NOT NULL REFERENCES public.account_sessions(token_hash) ON DELETE CASCADE,
 endpoint_hash text NOT NULL UNIQUE CHECK(endpoint_hash ~ '^[a-f0-9]{64}$'),
 subscription jsonb NOT NULL CHECK(jsonb_typeof(subscription)='object' AND octet_length(subscription::text)<8192),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id) ON DELETE CASCADE
);
CREATE INDEX web_push_session ON public.web_push_subscriptions(session_hash);
CREATE TABLE public.web_push_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 subscription_id uuid REFERENCES public.web_push_subscriptions(id) ON DELETE SET NULL,
 company_id uuid NOT NULL, broker_id uuid NOT NULL, endpoint_hash text NOT NULL,
 lead_id uuid NOT NULL, waiting_message_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','sent','failed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(broker_id,endpoint_hash,waiting_message_id),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_push_subscriptions,public.web_push_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON public.web_push_subscriptions TO service_role;
GRANT SELECT ON public.web_push_attempts TO service_role;

CREATE FUNCTION public.register_web_push(p_company_id uuid,p_broker_id uuid,p_session_hash text,p_endpoint_hash text,p_subscription jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.web_push_subscriptions%ROWTYPE; result uuid;
BEGIN
 PERFORM 1 FROM public.account_sessions s JOIN public.broker_accounts b ON b.id=s.broker_id
  WHERE s.token_hash=p_session_hash AND s.broker_id=p_broker_id AND b.company_id=p_company_id AND b.active AND s.expires_at>now() FOR UPDATE OF s;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_required'; END IF;
 IF p_endpoint_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_subscription) IS DISTINCT FROM 'object' OR octet_length(p_subscription::text)>8000 THEN RAISE EXCEPTION 'invalid_subscription'; END IF;
 SELECT * INTO existing FROM public.web_push_subscriptions WHERE endpoint_hash=p_endpoint_hash FOR UPDATE;
 IF FOUND AND existing.session_hash=p_session_hash AND existing.subscription=p_subscription THEN RETURN existing.id; END IF;
 -- An explicit opt-in on this browser replaces its former account/session binding.
 DELETE FROM public.web_push_subscriptions WHERE endpoint_hash=p_endpoint_hash;
 DELETE FROM public.web_push_subscriptions p USING public.account_sessions s WHERE p.session_hash=s.token_hash AND s.expires_at<=now() AND p.broker_id=p_broker_id;
 IF (SELECT count(*) FROM public.web_push_subscriptions WHERE broker_id=p_broker_id)>=10 THEN RAISE EXCEPTION 'subscription_limit'; END IF;
 INSERT INTO public.web_push_subscriptions(company_id,broker_id,session_hash,endpoint_hash,subscription)
  VALUES(p_company_id,p_broker_id,p_session_hash,p_endpoint_hash,p_subscription) RETURNING id INTO result;
 RETURN result;
END $$;

-- Read current facts only: no client names, text, phone numbers or inferred unread state.
-- Shared by the authenticated in-app banner and push. Never sample global messages:
-- an old unanswered contact must survive activity in unrelated conversations.
CREATE FUNCTION public.broker_unassigned_waiting(p_company_id uuid,p_broker_id uuid)
RETURNS TABLE(company_id uuid,lead_id uuid,waiting_message_id uuid,waiting_since timestamptz,duty_priority_until timestamptz,duty_preferred boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT b.company_id,l.id,first_wait.id,first_wait.created_at,
  CASE WHEN w.document#>>'{settings,operations,dutyPriorityEnabled}'='true' THEN duty.preferred_until END,
  coalesce(b.id=ANY(duty.broker_ids),false)
 FROM public.broker_accounts b
 JOIN public.leads l ON l.company_id=b.company_id AND nullif(btrim(l.assigned_to),'') IS NULL
  AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
 LEFT JOIN public.crm_evolution_workspaces w ON w.company_id=b.company_id
 LEFT JOIN public.lead_duty_priorities duty ON duty.company_id=l.company_id AND duty.lead_id=l.id
 CROSS JOIN LATERAL (
  SELECT m.id,m.created_at,m.direction FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
  WHERE c.company_id=l.company_id AND c.lead_id=l.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1
 ) latest
 LEFT JOIN LATERAL (
  SELECT m.id,m.created_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
  WHERE c.company_id=l.company_id AND c.lead_id=l.id AND m.direction IN ('outgoing','Saída') ORDER BY m.created_at DESC,m.id DESC LIMIT 1
 ) reply ON true
 CROSS JOIN LATERAL (
  SELECT m.id,m.created_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
  WHERE c.company_id=l.company_id AND c.lead_id=l.id AND m.direction IN ('incoming','Entrada')
   AND (reply.id IS NULL OR (m.created_at,m.id)>(reply.created_at,reply.id))
  ORDER BY m.created_at,m.id LIMIT 1
 ) first_wait
 WHERE b.id=p_broker_id AND b.company_id=p_company_id AND b.active
  AND latest.direction IN ('incoming','Entrada') AND isfinite(latest.created_at) AND latest.created_at<=now()
  AND isfinite(first_wait.created_at) AND first_wait.created_at<=now()
  AND NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=l.company_id AND c.lead_id=l.id
   AND (c.assigned_broker_id IS NOT NULL OR nullif(btrim(c.assigned_to),'') IS NOT NULL OR c.status IN ('closed','Encerrada')))
 ORDER BY first_wait.created_at,l.id;
$$;

CREATE FUNCTION public.web_push_waiting(p_subscription_id uuid,p_lead_id uuid DEFAULT NULL)
RETURNS TABLE(subscription_id uuid,company_id uuid,lead_id uuid,waiting_message_id uuid,waiting_since timestamptz,duty_priority_until timestamptz,duty_preferred boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT s.id,w.* FROM public.web_push_subscriptions s
 JOIN public.account_sessions session ON session.token_hash=s.session_hash AND session.broker_id=s.broker_id AND session.expires_at>now()
 CROSS JOIN LATERAL public.broker_unassigned_waiting(s.company_id,s.broker_id) w
 WHERE s.id=p_subscription_id AND (p_lead_id IS NULL OR w.lead_id=p_lead_id);
$$;

CREATE FUNCTION public.list_web_push_candidates(p_limit integer DEFAULT 40)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) FROM (
  SELECT waiting.* FROM public.web_push_subscriptions subscription
  CROSS JOIN LATERAL public.web_push_waiting(subscription.id) waiting
  WHERE NOT EXISTS(SELECT 1 FROM public.web_push_attempts a WHERE a.broker_id=subscription.broker_id AND a.endpoint_hash=subscription.endpoint_hash AND a.waiting_message_id=waiting.waiting_message_id)
  ORDER BY waiting.waiting_since,waiting.subscription_id LIMIT greatest(1,least(p_limit,100))
 ) candidate;
$$;

CREATE FUNCTION public.claim_web_push(p_subscription_id uuid,p_lead_id uuid,p_waiting_message_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE waiting record; result uuid; device public.web_push_subscriptions%ROWTYPE;
BEGIN
 SELECT * INTO waiting FROM public.web_push_waiting(p_subscription_id,p_lead_id) WHERE waiting_message_id=p_waiting_message_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO device FROM public.web_push_subscriptions WHERE id=p_subscription_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.web_push_attempts(subscription_id,company_id,broker_id,endpoint_hash,lead_id,waiting_message_id)
  VALUES(p_subscription_id,waiting.company_id,device.broker_id,device.endpoint_hash,p_lead_id,p_waiting_message_id)
  ON CONFLICT(broker_id,endpoint_hash,waiting_message_id) DO NOTHING RETURNING id INTO result;
 RETURN result;
END $$;

CREATE FUNCTION public.web_push_dispatch_target(p_attempt_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('bindingId',s.id,'subscription',s.subscription,'waitingSince',w.waiting_since,
  'dutyPriorityUntil',w.duty_priority_until,'dutyPreferred',w.duty_preferred)
 FROM public.web_push_attempts a JOIN public.web_push_subscriptions s ON s.id=a.subscription_id
 CROSS JOIN LATERAL public.web_push_waiting(s.id,a.lead_id) w
 WHERE a.id=p_attempt_id AND a.state='claimed' AND a.created_at>now()-interval '1 minute' AND w.waiting_message_id=a.waiting_message_id;
$$;

CREATE FUNCTION public.finish_web_push(p_attempt_id uuid,p_state text,p_expired boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target uuid;
BEGIN
 IF p_state NOT IN ('sent','failed','cancelled') THEN RAISE EXCEPTION 'invalid_push_state'; END IF;
 UPDATE public.web_push_attempts SET state=p_state,finished_at=now() WHERE id=p_attempt_id AND state='claimed' RETURNING subscription_id INTO target;
 IF p_expired AND target IS NOT NULL THEN DELETE FROM public.web_push_subscriptions WHERE id=target; END IF;
END $$;
REVOKE ALL ON FUNCTION public.register_web_push(uuid,uuid,text,text,jsonb),public.broker_unassigned_waiting(uuid,uuid),public.web_push_waiting(uuid,uuid),public.list_web_push_candidates(integer),public.claim_web_push(uuid,uuid,uuid),public.web_push_dispatch_target(uuid),public.finish_web_push(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_web_push(uuid,uuid,text,text,jsonb),public.broker_unassigned_waiting(uuid,uuid),public.web_push_waiting(uuid,uuid),public.list_web_push_candidates(integer),public.claim_web_push(uuid,uuid,uuid),public.web_push_dispatch_target(uuid),public.finish_web_push(uuid,text,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
