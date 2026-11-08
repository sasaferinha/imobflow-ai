BEGIN;
SET LOCAL lock_timeout='5s';

-- Social IDs are scoped to the provider account. They are never phone numbers.
CREATE TABLE public.social_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id),
 channel text NOT NULL CHECK(channel IN ('instagram','facebook')), account_id text NOT NULL CHECK(account_id ~ '^\d{1,40}$'),
 page_id text NOT NULL CHECK(page_id ~ '^\d{1,40}$'), name text NOT NULL DEFAULT '', token_ciphertext text,
 enabled boolean NOT NULL DEFAULT false, api_version text NOT NULL DEFAULT 'v26.0' CHECK(api_version ~ '^v\d+\.\d+$'),
 default_mode text NOT NULL DEFAULT 'human' CHECK(default_mode IN ('human','suggestions','automatic')),
 connected_by uuid REFERENCES public.broker_accounts(id), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(channel,account_id), UNIQUE(company_id,channel), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,connected_by) REFERENCES public.broker_accounts(company_id,id)
);
CREATE TABLE public.social_oauth_requests (
 state_hash text PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), broker_id uuid NOT NULL REFERENCES public.broker_accounts(id),
 redirect_uri text NOT NULL, expires_at timestamptz NOT NULL,
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id)
);
CREATE TABLE public.social_authorizations (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id), broker_id uuid NOT NULL REFERENCES public.broker_accounts(id),
 token_ciphertext text NOT NULL, expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id)
);
CREATE TABLE public.social_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id), account_id uuid NOT NULL,
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE, recipient_id text NOT NULL CHECK(recipient_id ~ '^\d{1,40}$'),
 mode text NOT NULL DEFAULT 'human' CHECK(mode IN ('human','suggestions','automatic')),
 assigned_broker_id uuid REFERENCES public.broker_accounts(id), assigned_to text,
 last_message_at timestamptz, last_inbound_at timestamptz, last_inbound_message_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,recipient_id), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,account_id) REFERENCES public.social_accounts(company_id,id),
 FOREIGN KEY(company_id,lead_id) REFERENCES public.leads(company_id,id),
 FOREIGN KEY(company_id,assigned_broker_id) REFERENCES public.broker_accounts(company_id,id)
);
CREATE TABLE public.social_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES public.companies(id), thread_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('incoming','outgoing')), content text NOT NULL DEFAULT '' CHECK(length(content)<=2000),
 media_urls jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(media_urls)='array' AND jsonb_array_length(media_urls)<=1), media_type text,
 external_id text CHECK(length(external_id)<=255), request_key text CHECK(length(request_key)<=255), batch_key text CHECK(length(batch_key)<=240),
 status text NOT NULL CHECK(status IN ('received','pending','sending','sent','failed','unknown')),
 source text NOT NULL DEFAULT 'client' CHECK(source IN ('client','human','ai','workflow')),
 actor_id uuid REFERENCES public.broker_accounts(id), reply_to_id uuid, error_code text, error_message text,
 occurred_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,thread_id) REFERENCES public.social_threads(company_id,id),
 FOREIGN KEY(company_id,actor_id) REFERENCES public.broker_accounts(company_id,id), UNIQUE(thread_id,external_id), UNIQUE(company_id,request_key)
);
CREATE INDEX social_threads_recent ON public.social_threads(company_id,last_message_at DESC,id);
CREATE INDEX social_messages_history ON public.social_messages(thread_id,occurred_at DESC,id);
CREATE INDEX social_messages_batch ON public.social_messages(company_id,batch_key) WHERE batch_key IS NOT NULL;

-- Canonical CRM permissions must see social attendance too. This function does
-- not grant admission to an unassigned lead: duty/online/compliance admission
-- stays in social_handoff, and only an established portfolio permits editing.
CREATE OR REPLACE FUNCTION public.crm_evolution_can_edit_lead(p_company_id uuid,p_actor_id uuid,p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor_name text; actor_role text; assigned_ids uuid[]; assigned_names text[]; identity_name text; has_social boolean;
BEGIN
 SELECT name,role INTO actor_name,actor_role FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id) THEN RETURN false; END IF;
 IF actor_role='owner' THEN RETURN true; END IF;
 identity_name:=regexp_replace(public.match_normalize(actor_name),'\s+',' ','g');
 SELECT EXISTS(SELECT 1 FROM public.social_threads WHERE company_id=p_company_id AND lead_id=p_lead_id) INTO has_social;
 SELECT array_agg(DISTINCT assigned_broker_id) FILTER(WHERE assigned_broker_id IS NOT NULL) INTO assigned_ids FROM (
  SELECT assigned_broker_id FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id
  UNION ALL SELECT assigned_broker_id FROM public.social_threads WHERE company_id=p_company_id AND lead_id=p_lead_id
 ) assignments;
 IF cardinality(assigned_ids)>0 THEN
  RETURN cardinality(assigned_ids)=1 AND assigned_ids[1]=p_actor_id
   AND NOT EXISTS(SELECT 1 FROM (
    SELECT assigned_broker_id,assigned_to FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id
    UNION ALL SELECT assigned_broker_id,assigned_to FROM public.social_threads WHERE company_id=p_company_id AND lead_id=p_lead_id
   ) attendance WHERE assigned_broker_id IS NULL AND nullif(btrim(assigned_to),'') IS NOT NULL AND regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g')<>identity_name)
   -- A CRM reassignment revokes the old social broker even before the thread
   -- is refreshed. Preserve the pre-existing UUID precedence for WhatsApp-only leads.
   AND (NOT has_social OR NOT EXISTS(SELECT 1 FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id AND nullif(btrim(assigned_to),'') IS NOT NULL AND regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g')<>identity_name));
 END IF;
 SELECT array_agg(DISTINCT normalized) FILTER(WHERE normalized<>'') INTO assigned_names FROM (
  SELECT regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g') normalized FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id
  UNION ALL SELECT regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g') FROM public.conversations WHERE company_id=p_company_id AND lead_id=p_lead_id
  UNION ALL SELECT regexp_replace(public.match_normalize(assigned_to),'\s+',' ','g') FROM public.social_threads WHERE company_id=p_company_id AND lead_id=p_lead_id
 ) names;
 RETURN coalesce(cardinality(assigned_names)=1 AND assigned_names[1]=identity_name AND (SELECT count(*)=1 FROM public.broker_accounts WHERE company_id=p_company_id AND active AND regexp_replace(public.match_normalize(name),'\s+',' ','g')=identity_name),false);
END $$;
REVOKE ALL ON FUNCTION public.crm_evolution_can_edit_lead(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- The opportunity table remains inaccessible to service_role directly. Reuse
-- its existing authorization/availability checks before returning a binding.
CREATE FUNCTION public.opportunity_delivery_context(p_company_id uuid,p_broker_id uuid,p_opportunity_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.opportunity_action(p_company_id,p_broker_id,p_opportunity_id,'draft');
 SELECT jsonb_build_object('lead_id',lead_id,'property_id',property_id) INTO result
 FROM public.opportunities WHERE company_id=p_company_id AND id=p_opportunity_id;
 IF result IS NULL THEN RAISE EXCEPTION 'opportunity_not_found'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.opportunity_delivery_context(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_delivery_context(uuid,uuid,uuid) TO service_role;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['social_accounts','social_oauth_requests','social_authorizations','social_threads','social_messages'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY social_server_only ON public.%I AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)',t);
 END LOOP;
END $$;

CREATE FUNCTION public.bind_social_account(p_company_id uuid,p_actor_id uuid,p_channel text,p_account_id text,p_page_id text,p_name text,p_token text,p_api_version text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.social_accounts%ROWTYPE; result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('social-page:'||p_page_id,0));
 IF p_actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.account_companies WHERE company_id=p_company_id) THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM public.social_accounts WHERE page_id=p_page_id AND company_id<>p_company_id) THEN RAISE EXCEPTION 'social_account_bound'; END IF;
 SELECT * INTO existing FROM public.social_accounts WHERE channel=p_channel AND account_id=p_account_id;
 IF FOUND AND existing.company_id<>p_company_id THEN RAISE EXCEPTION 'social_account_bound'; END IF;
 IF existing.id IS NOT NULL AND p_actor_id IS NULL THEN
  IF NOT existing.enabled THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
  RETURN existing.id;
 END IF;
 -- Switching account cannot move old conversations to a new recipient namespace.
 IF EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel AND account_id<>p_account_id) THEN RAISE EXCEPTION 'social_account_change_requires_support'; END IF;
 INSERT INTO public.social_accounts(company_id,channel,account_id,page_id,name,token_ciphertext,enabled,connected_by,api_version)
 VALUES(p_company_id,p_channel,p_account_id,p_page_id,left(p_name,200),p_token,true,p_actor_id,p_api_version)
 ON CONFLICT(channel,account_id) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,enabled=true,name=excluded.name,page_id=excluded.page_id,connected_by=coalesce(excluded.connected_by,social_accounts.connected_by),api_version=excluded.api_version,updated_at=now()
 RETURNING id INTO result; RETURN result;
END $$;

CREATE FUNCTION public.read_social_inbox(p_company_id uuid,p_actor_id uuid,p_channel text,p_thread_id uuid DEFAULT NULL,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_contacts_before_at timestamptz DEFAULT NULL,p_contacts_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
 IF NOT FOUND OR p_channel NOT IN ('instagram','facebook') THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',t.id,'leadId',t.lead_id,'channel',a.channel,'name',l.name,'assignedTo',t.assigned_to,'assignedBrokerId',t.assigned_broker_id,'lastMessageAt',t.last_message_at,'lastInboundAt',t.last_inbound_at,'mode',t.mode,'enabled',a.enabled AND a.token_ciphertext IS NOT NULL AND (a.channel<>'instagram' OR a.page_id<>a.account_id),
   'leadProfile',jsonb_build_object('goal',l.goal,'region',l.region,'propertyType',l.property_type,'budgetMin',l.budget_min,'budgetMax',l.budget_max,'interestProfile',l.interest_profile),
   'messages',(SELECT coalesce(jsonb_agg(m),'[]'::jsonb) FROM (
    SELECT id,content,occurred_at,created_at,direction,status,error_message,media_urls,media_type,source
    FROM public.social_messages WHERE company_id=p_company_id AND thread_id=t.id
     AND (p_thread_id IS NULL OR p_before_at IS NULL OR (occurred_at,id)<(p_before_at,p_before_id))
    ORDER BY occurred_at DESC,id DESC LIMIT 41) m)) item
  FROM public.social_threads t JOIN public.social_accounts a ON a.id=t.account_id AND a.company_id=t.company_id
  JOIN public.leads l ON l.id=t.lead_id AND l.company_id=t.company_id
  WHERE t.company_id=p_company_id AND a.channel=p_channel AND (p_thread_id IS NULL OR t.id=p_thread_id)
   AND (actor.role='owner' OR ((t.assigned_broker_id IS NULL OR t.assigned_broker_id=actor.id) AND (nullif(btrim(l.assigned_to),'') IS NULL OR l.assigned_to=actor.name)))
   AND (p_contacts_before_at IS NULL OR (coalesce(t.last_message_at,t.created_at),t.id)<(p_contacts_before_at,p_contacts_before_id))
  ORDER BY coalesce(t.last_message_at,t.created_at) DESC,t.id DESC LIMIT 101
 ) q;
 RETURN result;
END $$;

CREATE FUNCTION public.receive_social_message(p_account_id uuid,p_lead_id uuid,p_recipient_id text,p_external_id text,p_content text,p_media jsonb,p_media_type text,p_occurred_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.social_accounts%ROWTYPE; t public.social_threads%ROWTYPE; mid uuid; observed timestamptz; event_time timestamptz; origin text; legacy jsonb; legacy_at timestamptz;
BEGIN
 SELECT * INTO a FROM public.social_accounts WHERE id=p_account_id AND enabled FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
 IF p_recipient_id IS NULL OR p_recipient_id !~ '^\d{1,40}$' OR p_recipient_id=a.account_id OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 255 OR p_content IS NULL OR length(p_content)>2000 OR jsonb_typeof(p_media)<>'array' OR jsonb_array_length(p_media)>1 THEN RAISE EXCEPTION 'social_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('social-thread:'||a.id::text||':'||p_recipient_id,0));
 observed:=CASE WHEN p_occurred_at IS NOT NULL AND isfinite(p_occurred_at) AND p_occurred_at>='2000-01-01' AND p_occurred_at<=now()+interval '5 minutes' THEN least(p_occurred_at,now()) ELSE NULL END;
 event_time:=coalesce(observed,now()); origin:=CASE WHEN a.channel='instagram' THEN 'Instagram Direct' ELSE 'Facebook Messenger' END;
 SELECT * INTO t FROM public.social_threads WHERE account_id=a.id AND recipient_id=p_recipient_id FOR UPDATE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.leads WHERE id=p_lead_id AND company_id<>a.company_id) THEN RAISE EXCEPTION 'social_forbidden'; END IF;
  INSERT INTO public.leads(id,company_id,name,phone,goal,property_type,region,details,summary,score,temperature,source,lifecycle_status,interest_profile)
  VALUES(p_lead_id,a.company_id,CASE WHEN a.channel='instagram' THEN 'Contato do Instagram' ELSE 'Contato do Facebook' END,'','Não informado','Não informado','Não informado',p_content,'Contato recebido pelo canal '||origin,0,'Frio',origin,'Novo',jsonb_build_object('socialChannel',a.channel,'socialAccountId',a.account_id,'socialSenderId',p_recipient_id))
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.social_threads(company_id,account_id,lead_id,recipient_id,mode) VALUES(a.company_id,a.id,p_lead_id,p_recipient_id,a.default_mode) RETURNING * INTO t;
  -- The deterministic lead identity includes the company, Instagram account
  -- and scoped sender. Preserve its retained history without treating an old
  -- display timestamp as a fresh interaction or triggering retrospective AI.
  IF a.channel='instagram' THEN
   FOR legacy IN SELECT value FROM public.leads l CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(l.interest_profile->'socialMessages')='array' THEN l.interest_profile->'socialMessages' ELSE '[]'::jsonb END) WHERE l.company_id=a.company_id AND l.id=t.lead_id LIMIT 40 LOOP
    BEGIN
     legacy_at:=(legacy->>'at')::timestamptz;
     IF isfinite(legacy_at) AND legacy_at<=now()+interval '5 minutes' AND length(legacy->>'id') BETWEEN 1 AND 255 AND length(legacy->>'text') BETWEEN 1 AND 2000 THEN
      INSERT INTO public.social_messages(company_id,thread_id,direction,content,external_id,status,occurred_at) VALUES(a.company_id,t.id,'incoming',legacy->>'text',legacy->>'id','received',legacy_at) ON CONFLICT(thread_id,external_id) DO NOTHING;
     END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN NULL;
    END;
   END LOOP;
  END IF;
 END IF;
 INSERT INTO public.social_messages(company_id,thread_id,direction,content,media_urls,media_type,external_id,status,occurred_at)
 VALUES(a.company_id,t.id,'incoming',p_content,p_media,p_media_type,p_external_id,'received',event_time)
 ON CONFLICT(thread_id,external_id) DO NOTHING RETURNING id INTO mid;
 IF mid IS NULL THEN RETURN jsonb_build_object('saved',false,'threadId',t.id,'leadId',t.lead_id); END IF;
 UPDATE public.social_threads SET last_message_at=greatest(last_message_at,event_time),last_inbound_at=greatest(last_inbound_at,observed),
 last_inbound_message_id=CASE WHEN observed IS NOT NULL AND (last_inbound_at IS NULL OR observed>=last_inbound_at) THEN mid ELSE last_inbound_message_id END WHERE id=t.id;
 UPDATE public.leads SET last_contact_at=greatest(last_contact_at,observed),interest_profile=coalesce(interest_profile,'{}'::jsonb)||jsonb_build_object('socialChannel',a.channel,'socialAccountId',a.account_id,'socialSenderId',p_recipient_id) WHERE company_id=a.company_id AND id=t.lead_id;
 RETURN jsonb_build_object('saved',true,'companyId',a.company_id,'threadId',t.id,'leadId',t.lead_id,'messageId',mid,'mode',t.mode);
END $$;

CREATE FUNCTION public.social_handoff(p_company_id uuid,p_actor_id uuid,p_thread_id uuid,p_mode text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; t public.social_threads%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
 IF NOT FOUND OR p_mode NOT IN ('human','suggestions','automatic') THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=p_thread_id FOR UPDATE;
 IF NOT FOUND OR (actor.role<>'owner' AND t.assigned_broker_id IS NOT NULL AND t.assigned_broker_id<>actor.id) THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 IF actor.role<>'owner' AND EXISTS(SELECT 1 FROM public.leads WHERE company_id=p_company_id AND id=t.lead_id AND nullif(btrim(assigned_to),'') IS NOT NULL AND assigned_to<>actor.name) THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 IF p_mode='automatic' AND actor.role<>'owner' THEN RAISE EXCEPTION 'social_owner_required'; END IF;
 -- Once provider dispatch started we cannot honestly promise to retract it.
 IF EXISTS(SELECT 1 FROM public.social_messages WHERE thread_id=t.id AND status='sending' AND updated_at>now()-interval '2 minutes') THEN RAISE EXCEPTION 'social_sending'; END IF;
 UPDATE public.social_threads SET mode=p_mode,assigned_broker_id=CASE WHEN p_mode='automatic' THEN NULL ELSE actor.id END,assigned_to=CASE WHEN p_mode='automatic' THEN NULL ELSE actor.name END WHERE id=t.id;
 UPDATE public.leads SET assigned_to=CASE WHEN p_mode='automatic' THEN NULL ELSE actor.name END WHERE company_id=p_company_id AND id=t.lead_id;
 UPDATE public.social_messages SET status='failed',error_code='handoff',error_message='O atendimento mudou antes do envio.',updated_at=now() WHERE thread_id=t.id AND status='pending';
 RETURN true;
END $$;

CREATE FUNCTION public.enqueue_social_message(p_company_id uuid,p_thread_id uuid,p_actor_id uuid,p_key text,p_content text,p_media jsonb,p_source text,p_reply_to uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.social_threads%ROWTYPE; m public.social_messages%ROWTYPE; actor public.broker_accounts%ROWTYPE; mid uuid;
BEGIN
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=p_thread_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.social_accounts WHERE id=t.account_id AND company_id=p_company_id AND enabled) THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
 IF p_source='ai' THEN
  IF p_actor_id IS NOT NULL OR t.mode<>'automatic' OR p_reply_to IS NULL OR t.last_inbound_message_id IS DISTINCT FROM p_reply_to THEN RAISE EXCEPTION 'social_handoff'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=p_company_id AND document#>>'{settings,ai,automaticMode}'='human') THEN RAISE EXCEPTION 'social_handoff'; END IF;
 ELSE
  SELECT * INTO actor FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
  IF NOT FOUND OR t.assigned_broker_id IS DISTINCT FROM p_actor_id OR t.mode='automatic' OR p_source NOT IN ('human','workflow') THEN RAISE EXCEPTION 'social_claim_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.leads WHERE company_id=p_company_id AND id=t.lead_id AND (actor.role='owner' OR nullif(btrim(assigned_to),'') IS NULL OR assigned_to=actor.name)) THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 END IF;
 SELECT * INTO m FROM public.social_messages WHERE company_id=p_company_id AND request_key=p_key;
 IF FOUND THEN
  IF m.thread_id<>t.id OR m.content IS DISTINCT FROM p_content OR m.media_urls IS DISTINCT FROM p_media OR m.source IS DISTINCT FROM p_source OR m.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'social_idempotency_conflict'; END IF;
  RETURN m.id;
 END IF;
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 255 OR p_content IS NULL OR length(p_content)>2000 OR jsonb_typeof(p_media)<>'array' OR jsonb_array_length(p_media)>1 OR (btrim(p_content)='' AND jsonb_array_length(p_media)=0) OR (btrim(p_content)<>'' AND jsonb_array_length(p_media)>0) THEN RAISE EXCEPTION 'social_invalid'; END IF;
 IF t.last_inbound_at IS NULL OR t.last_inbound_at<now()-interval '24 hours' THEN RAISE EXCEPTION 'social_window_closed'; END IF;
 IF (SELECT count(*) FROM public.social_messages WHERE thread_id=t.id AND direction='outgoing' AND created_at>now()-interval '1 minute')>=20 THEN RAISE EXCEPTION 'social_rate_limited'; END IF;
 INSERT INTO public.social_messages(company_id,thread_id,direction,content,media_urls,media_type,request_key,status,source,actor_id,reply_to_id)
 VALUES(p_company_id,t.id,'outgoing',p_content,p_media,CASE WHEN jsonb_array_length(p_media)>0 THEN 'image' ELSE NULL END,p_key,'pending',p_source,p_actor_id,p_reply_to) RETURNING id INTO mid;
 RETURN mid;
END $$;

CREATE FUNCTION public.claim_social_message(p_company_id uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.social_threads%ROWTYPE; m public.social_messages%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=(SELECT thread_id FROM public.social_messages WHERE company_id=p_company_id AND id=p_message_id) FOR UPDATE;
 SELECT * INTO m FROM public.social_messages WHERE company_id=p_company_id AND id=p_message_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF m.status='sending' AND m.updated_at<=now()-interval '2 minutes' THEN
  UPDATE public.social_messages SET status='unknown',error_code='dispatch_interrupted',error_message='O envio pode ter ocorrido. Confira no canal antes de enviar novamente.',updated_at=now() WHERE id=m.id; RETURN NULL;
 END IF;
 IF m.status<>'pending' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.social_accounts WHERE id=t.account_id AND company_id=p_company_id AND enabled)
  OR (m.source='ai' AND (t.mode<>'automatic' OR t.last_inbound_message_id IS DISTINCT FROM m.reply_to_id OR EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=p_company_id AND document#>>'{settings,ai,automaticMode}'='human')))
  OR (m.source<>'ai' AND (t.assigned_broker_id IS DISTINCT FROM m.actor_id OR t.mode='automatic' OR NOT EXISTS(SELECT 1 FROM public.broker_accounts b JOIN public.leads l ON l.company_id=b.company_id AND l.id=t.lead_id WHERE b.id=m.actor_id AND b.company_id=p_company_id AND b.active AND (b.role='owner' OR nullif(btrim(l.assigned_to),'') IS NULL OR l.assigned_to=b.name))))
  OR t.last_inbound_at IS NULL OR t.last_inbound_at<now()-interval '24 hours' THEN
  UPDATE public.social_messages SET status='failed',error_code='dispatch_precondition',error_message='O atendimento, a conexão ou a janela de resposta mudou.',updated_at=now() WHERE id=m.id; RETURN NULL;
 END IF;
 UPDATE public.social_messages SET status='sending',updated_at=now() WHERE id=m.id;
 RETURN jsonb_build_object('messageId',m.id,'threadId',t.id,'accountId',t.account_id,'recipientId',t.recipient_id,'content',m.content,'mediaUrls',m.media_urls);
END $$;

CREATE FUNCTION public.enqueue_social_batch(p_company_id uuid,p_thread_id uuid,p_actor_id uuid,p_key text,p_parts jsonb,p_source text,p_reply_to uuid)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_parts jsonb; ids uuid[]; part jsonb; mid uuid; index integer:=0;
BEGIN
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 240 OR jsonb_typeof(p_parts)<>'array' OR jsonb_array_length(p_parts) NOT BETWEEN 1 AND 6 THEN RAISE EXCEPTION 'social_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('social-batch:'||p_company_id::text||':'||p_key,0));
 SELECT jsonb_agg(jsonb_build_object('content',content,'media',media_urls) ORDER BY request_key),array_agg(id ORDER BY request_key) INTO old_parts,ids FROM public.social_messages WHERE company_id=p_company_id AND batch_key=p_key;
 IF old_parts IS NOT NULL THEN
  IF old_parts IS DISTINCT FROM p_parts OR EXISTS(SELECT 1 FROM public.social_messages WHERE company_id=p_company_id AND batch_key=p_key AND (thread_id<>p_thread_id OR source IS DISTINCT FROM p_source OR actor_id IS DISTINCT FROM p_actor_id)) THEN RAISE EXCEPTION 'social_idempotency_conflict'; END IF;
  -- Replay still requires the current portfolio/attendance permission.
  PERFORM public.enqueue_social_message(p_company_id,p_thread_id,p_actor_id,p_key||':0',p_parts->0->>'content',p_parts->0->'media',p_source,p_reply_to);
  RETURN ids;
 END IF;
 ids:='{}'::uuid[];
 FOR part IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
  mid:=public.enqueue_social_message(p_company_id,p_thread_id,p_actor_id,p_key||':'||index::text,part->>'content',part->'media',p_source,p_reply_to);
  UPDATE public.social_messages SET batch_key=p_key WHERE id=mid;
  ids:=array_append(ids,mid); index:=index+1;
 END LOOP;
 RETURN ids;
END $$;

CREATE FUNCTION public.configure_social_account(p_company_id uuid,p_actor_id uuid,p_channel text,p_action text,p_mode text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'social_owner_required'; END IF;
 SELECT id INTO account FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
 IF p_action='disconnect' THEN
  UPDATE public.social_accounts SET enabled=false,token_ciphertext=NULL,default_mode='human',updated_at=now() WHERE id=account;
  UPDATE public.social_threads SET mode='human' WHERE company_id=p_company_id AND account_id=account;
  UPDATE public.social_messages SET status='failed',error_code='disconnected',error_message='O canal foi desconectado antes do envio.',updated_at=now() WHERE company_id=p_company_id AND thread_id IN(SELECT id FROM public.social_threads WHERE account_id=account) AND status='pending';
  DELETE FROM public.social_authorizations WHERE company_id=p_company_id;
 ELSIF p_action='mode' AND p_mode IN ('human','suggestions','automatic') THEN
  UPDATE public.social_accounts SET default_mode=p_mode,updated_at=now() WHERE id=account;
 ELSE RAISE EXCEPTION 'social_invalid'; END IF;
 RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.bind_social_account(uuid,uuid,text,text,text,text,text,text),public.receive_social_message(uuid,uuid,text,text,text,jsonb,text,timestamptz),public.social_handoff(uuid,uuid,uuid,text),public.enqueue_social_message(uuid,uuid,uuid,text,text,jsonb,text,uuid),public.claim_social_message(uuid,uuid),public.read_social_inbox(uuid,uuid,text,uuid,timestamptz,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_social_account(uuid,uuid,text,text,text,text,text,text),public.receive_social_message(uuid,uuid,text,text,text,jsonb,text,timestamptz),public.social_handoff(uuid,uuid,uuid,text),public.enqueue_social_message(uuid,uuid,uuid,text,text,jsonb,text,uuid),public.claim_social_message(uuid,uuid),public.read_social_inbox(uuid,uuid,text,uuid,timestamptz,uuid,timestamptz,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.enqueue_social_batch(uuid,uuid,uuid,text,jsonb,text,uuid),public.configure_social_account(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_social_batch(uuid,uuid,uuid,text,jsonb,text,uuid),public.configure_social_account(uuid,uuid,text,text,text) TO service_role;
COMMIT;
