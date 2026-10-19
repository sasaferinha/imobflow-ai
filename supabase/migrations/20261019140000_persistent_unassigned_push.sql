BEGIN;
SET LOCAL lock_timeout='5s';

-- Drain intake/reservation writers before installing triggers and backfilling.
-- The legacy intake inserts its lead/priority before its message; use that lock
-- order. No incoming row can slip between the backfill and trigger activation.
LOCK TABLE public.lead_duty_priorities,public.messages IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION public.shorten_duty_priority_on_incoming() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE contact_id uuid; first_arrival timestamptz;
BEGIN
 IF NEW.direction IS NULL OR NEW.direction NOT IN ('incoming','Entrada') OR NEW.created_at IS NULL
  OR NOT isfinite(NEW.created_at) OR NEW.created_at>clock_timestamp() THEN RETURN NEW; END IF;
 SELECT c.lead_id INTO contact_id FROM public.conversations c WHERE c.company_id=NEW.company_id AND c.id=NEW.conversation_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 -- Serialize with a concurrent late reservation INSERT, including the case
 -- where that row does not exist yet. Hash collisions only cause extra waiting.
 PERFORM pg_advisory_xact_lock(hashtextextended('duty-arrival:'||NEW.company_id::text||':'||contact_id::text,0));
 SELECT min(m.created_at) INTO first_arrival FROM public.messages m
  JOIN public.conversations c ON c.company_id=m.company_id AND c.id=m.conversation_id
  WHERE c.company_id=NEW.company_id AND c.lead_id=contact_id AND m.direction IN ('incoming','Entrada')
   AND isfinite(m.created_at) AND m.created_at<=clock_timestamp();
 IF first_arrival IS NOT NULL THEN
  UPDATE public.lead_duty_priorities p SET preferred_until=LEAST(p.preferred_until,first_arrival+interval '5 minutes')
   WHERE p.company_id=NEW.company_id AND p.lead_id=contact_id AND p.preferred_until>first_arrival+interval '5 minutes';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shorten_duty_priority_on_incoming
AFTER INSERT OR UPDATE OF created_at,direction,conversation_id,company_id ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.shorten_duty_priority_on_incoming();

-- Existing records use exactly the same tenant-bound, finite received evidence.
UPDATE public.lead_duty_priorities p SET preferred_until=LEAST(p.preferred_until,arrivals.first_at+interval '5 minutes')
FROM (
 SELECT c.company_id,c.lead_id,min(m.created_at) first_at FROM public.messages m
 JOIN public.conversations c ON c.company_id=m.company_id AND c.id=m.conversation_id
 WHERE m.direction IN ('incoming','Entrada') AND isfinite(m.created_at) AND m.created_at<=clock_timestamp()
 GROUP BY c.company_id,c.lead_id
) arrivals
WHERE p.company_id=arrivals.company_id AND p.lead_id=arrivals.lead_id AND p.preferred_until>arrivals.first_at+interval '5 minutes';

-- Also cover the reverse order: a reservation created after stored messages.
-- Repeated updates may shorten, never extend an existing reservation or roster.
CREATE FUNCTION public.bound_duty_priority_to_first_arrival() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE first_arrival timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('duty-arrival:'||NEW.company_id::text||':'||NEW.lead_id::text,0));
 SELECT min(m.created_at) INTO first_arrival FROM public.messages m
  JOIN public.conversations c ON c.company_id=m.company_id AND c.id=m.conversation_id
  WHERE c.company_id=NEW.company_id AND c.lead_id=NEW.lead_id AND m.direction IN ('incoming','Entrada')
   AND isfinite(m.created_at) AND m.created_at<=clock_timestamp();
 IF first_arrival IS NOT NULL THEN NEW.preferred_until:=LEAST(NEW.preferred_until,first_arrival+interval '5 minutes'); END IF;
 IF TG_OP='UPDATE' THEN NEW.preferred_until:=LEAST(NEW.preferred_until,OLD.preferred_until); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bound_duty_priority_to_first_arrival
BEFORE INSERT OR UPDATE OF preferred_until ON public.lead_duty_priorities
FOR EACH ROW EXECUTE FUNCTION public.bound_duty_priority_to_first_arrival();
REVOKE ALL ON FUNCTION public.shorten_duty_priority_on_incoming(),public.bound_duty_priority_to_first_arrival() FROM PUBLIC,anon,authenticated,service_role;

-- A bot response is not a broker accepting this contact. Keep the first valid
-- incoming message across this lead's channels until real ownership or closure.
-- Legacy ownership changes have no accepted_at/reopened_at audit: do not infer
-- one from AI attendance leases, replies, or an administrative updated_at.
CREATE OR REPLACE FUNCTION public.broker_unassigned_waiting(p_company_id uuid,p_broker_id uuid)
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
  SELECT m.id,m.created_at FROM public.messages m
  JOIN public.conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
  WHERE c.company_id=l.company_id AND c.lead_id=l.id AND m.direction IN ('incoming','Entrada')
   AND isfinite(m.created_at) AND m.created_at<=now()
  ORDER BY m.created_at,m.id LIMIT 1
 ) first_wait
 WHERE b.id=p_broker_id AND b.company_id=p_company_id AND b.active
  AND NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.company_id=l.company_id AND c.lead_id=l.id
   AND (c.assigned_broker_id IS NOT NULL OR nullif(btrim(c.assigned_to),'') IS NOT NULL OR c.status IN ('closed','Encerrada')))
 ORDER BY first_wait.created_at,l.id;
$$;

-- Cooldown belongs to the broker/device/contact, not a session or a message.
-- Logout/re-login, re-subscription and new incoming messages cannot reset it.
-- Drain old workers before taking the receipt snapshot. Otherwise an old claim
-- could commit between backfill and DROP UNIQUE, escaping the new cooldown.
LOCK TABLE public.web_push_attempts IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.web_push_cooldowns (
 company_id uuid NOT NULL,broker_id uuid NOT NULL,endpoint_hash text NOT NULL,lead_id uuid NOT NULL,
 last_attempt_at timestamptz NOT NULL,
 PRIMARY KEY(company_id,broker_id,endpoint_hash,lead_id),
 CHECK(endpoint_hash ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id) ON DELETE CASCADE,
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.web_push_cooldowns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_push_cooldowns FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.web_push_cooldowns TO service_role;
INSERT INTO public.web_push_cooldowns(company_id,broker_id,endpoint_hash,lead_id,last_attempt_at)
 SELECT company_id,broker_id,endpoint_hash,lead_id,max(created_at)
 FROM public.web_push_attempts GROUP BY company_id,broker_id,endpoint_hash,lead_id;

-- Replace only the former one-shot uniqueness rule; retain every existing receipt.
DO $$
DECLARE old_constraint name;
BEGIN
 SELECT c.conname INTO STRICT old_constraint FROM pg_constraint c
 WHERE c.conrelid='public.web_push_attempts'::regclass AND c.contype='u'
  AND (SELECT array_agg(a.attname::text ORDER BY key.ordinality)
   FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum,ordinality)
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum)
   =ARRAY['broker_id','endpoint_hash','waiting_message_id'];
 EXECUTE format('ALTER TABLE public.web_push_attempts DROP CONSTRAINT %I',old_constraint);
END $$;
CREATE INDEX web_push_attempts_contact_device ON public.web_push_attempts(company_id,broker_id,endpoint_hash,lead_id,created_at DESC);

-- Explicit comparison, not time buckets: adjacent minute boundaries cannot
-- produce a burst. Also used by deterministic millisecond-boundary tests.
CREATE FUNCTION public.web_push_retry_due(p_last_attempt_at timestamptz,p_checked_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(isfinite(p_checked_at) AND (p_last_attempt_at IS NULL
  OR (isfinite(p_last_attempt_at) AND p_last_attempt_at<=p_checked_at-interval '5 minutes')),false);
$$;

-- Replace the signature (rather than overload it) to avoid PostgREST ambiguity.
-- Callers that only send p_limit keep working through the offset default.
DROP FUNCTION public.list_web_push_candidates(integer);
CREATE FUNCTION public.list_web_push_candidates(p_limit integer DEFAULT 40,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) FROM (
  SELECT waiting.* FROM public.web_push_subscriptions subscription
  CROSS JOIN LATERAL public.web_push_waiting(subscription.id) waiting
  LEFT JOIN public.web_push_cooldowns cooldown ON cooldown.company_id=subscription.company_id
   AND cooldown.broker_id=subscription.broker_id AND cooldown.endpoint_hash=subscription.endpoint_hash AND cooldown.lead_id=waiting.lead_id
  WHERE public.web_push_retry_due(cooldown.last_attempt_at,now())
  ORDER BY cooldown.last_attempt_at NULLS FIRST,waiting.waiting_since,waiting.subscription_id,waiting.lead_id
  LIMIT greatest(1,least(p_limit,100)) OFFSET greatest(0,least(coalesce(p_offset,0),10000))
 ) candidate;
$$;

CREATE OR REPLACE FUNCTION public.claim_web_push(p_subscription_id uuid,p_lead_id uuid,p_waiting_message_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE waiting record; result uuid; device public.web_push_subscriptions%ROWTYPE; admitted_at timestamptz;
BEGIN
 SELECT * INTO device FROM public.web_push_subscriptions WHERE id=p_subscription_id FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO waiting FROM public.web_push_waiting(p_subscription_id,p_lead_id) WHERE waiting_message_id=p_waiting_message_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- ON CONFLICT serializes concurrent admissions for the same stable device key.
 -- This remains safe under stronger isolation (conflict raises, never double sends).
 INSERT INTO public.web_push_cooldowns AS cooldown(company_id,broker_id,endpoint_hash,lead_id,last_attempt_at)
  VALUES(device.company_id,device.broker_id,device.endpoint_hash,p_lead_id,clock_timestamp())
 ON CONFLICT(company_id,broker_id,endpoint_hash,lead_id) DO UPDATE
  SET last_attempt_at=EXCLUDED.last_attempt_at
  WHERE public.web_push_retry_due(cooldown.last_attempt_at,EXCLUDED.last_attempt_at)
 RETURNING last_attempt_at INTO admitted_at;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO public.web_push_attempts(subscription_id,company_id,broker_id,endpoint_hash,lead_id,waiting_message_id,created_at)
  VALUES(p_subscription_id,waiting.company_id,device.broker_id,device.endpoint_hash,p_lead_id,p_waiting_message_id,admitted_at)
  RETURNING id INTO result;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.web_push_dispatch_target(p_attempt_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('bindingId',s.id,'companyId',s.company_id,'subscription',s.subscription,'waitingSince',w.waiting_since,
  'dutyPriorityUntil',w.duty_priority_until,'dutyPreferred',w.duty_preferred)
 FROM public.web_push_attempts a JOIN public.web_push_subscriptions s ON s.id=a.subscription_id
  AND s.company_id=a.company_id AND s.broker_id=a.broker_id AND s.endpoint_hash=a.endpoint_hash
 CROSS JOIN LATERAL public.web_push_waiting(s.id,a.lead_id) w
 WHERE a.id=p_attempt_id AND a.state='claimed' AND a.created_at>now()-interval '1 minute' AND w.waiting_message_id=a.waiting_message_id;
$$;

CREATE FUNCTION public.urgent_alert_policy_version()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT 2; $$;
REVOKE ALL ON FUNCTION public.broker_unassigned_waiting(uuid,uuid),public.web_push_retry_due(timestamptz,timestamptz),
 public.list_web_push_candidates(integer,integer),public.claim_web_push(uuid,uuid,uuid),public.web_push_dispatch_target(uuid),public.urgent_alert_policy_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.broker_unassigned_waiting(uuid,uuid),public.web_push_retry_due(timestamptz,timestamptz),
 public.list_web_push_candidates(integer,integer),public.claim_web_push(uuid,uuid,uuid),public.web_push_dispatch_target(uuid),public.urgent_alert_policy_version() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
