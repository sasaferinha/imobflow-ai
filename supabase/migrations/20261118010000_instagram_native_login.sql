BEGIN;
SET LOCAL lock_timeout = '5s';

-- Existing records stay in the Facebook Login namespace. Instagram Login
-- scopes recipients differently and must never inherit that old history.
ALTER TABLE public.social_accounts
  ADD COLUMN login_provider text NOT NULL DEFAULT 'facebook' CHECK (login_provider IN ('facebook','instagram')),
  ADD COLUMN token_expires_at timestamptz,
  ADD CONSTRAINT social_accounts_native_instagram CHECK (
    login_provider <> 'instagram' OR (
      channel = 'instagram' AND page_id = account_id
      AND token_expires_at IS NOT NULL AND isfinite(token_expires_at)
    )
  );
ALTER TABLE public.social_accounts DROP CONSTRAINT social_accounts_channel_account_id_key;
ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_provider_identity UNIQUE(channel,login_provider,account_id);
ALTER TABLE public.social_oauth_requests
  ADD COLUMN login_provider text NOT NULL DEFAULT 'facebook' CHECK (login_provider IN ('facebook','instagram')),
  ADD CONSTRAINT social_oauth_provider_channel CHECK (login_provider <> 'instagram' OR channel IS NOT DISTINCT FROM 'instagram');

-- A provider namespace is immutable, but the same external Instagram account
-- remains owned by one tenant across both namespaces, including archived rows.
CREATE FUNCTION public.guard_social_account_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW.company_id,NEW.channel,NEW.account_id,NEW.login_provider)
    IS DISTINCT FROM ROW(OLD.id,OLD.company_id,OLD.channel,OLD.account_id,OLD.login_provider)
  THEN RAISE EXCEPTION 'social_account_identity_immutable'; END IF;
  -- Updates already hold a row lock. Identity cannot change, so never invert
  -- bind's identity->row lock order just to renew/revoke a credential.
  IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('social-identity:' || NEW.channel || ':' || NEW.account_id,0));
  IF EXISTS(SELECT 1 FROM public.social_accounts
    WHERE channel = NEW.channel AND account_id = NEW.account_id AND company_id <> NEW.company_id)
  THEN RAISE EXCEPTION 'social_account_bound'; END IF;
  -- Native page_id is an explicit IG-ID sentinel, not a Facebook Page claim.
  IF NEW.login_provider = 'facebook' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('social-page:' || NEW.page_id,0));
    IF EXISTS(SELECT 1 FROM public.social_accounts
      WHERE login_provider = 'facebook' AND page_id = NEW.page_id AND company_id <> NEW.company_id)
    THEN RAISE EXCEPTION 'social_account_bound'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER social_account_identity_guard BEFORE INSERT OR UPDATE OF id,company_id,channel,account_id,login_provider ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_social_account_identity();
REVOKE ALL ON FUNCTION public.guard_social_account_identity() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.social_account_is_ready(a public.social_accounts)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT a.enabled AND nullif(btrim(a.token_ciphertext),'') IS NOT NULL
    AND (a.token_expires_at IS NULL OR a.token_expires_at > now())
    AND (a.channel <> 'instagram' OR
      (a.login_provider = 'facebook' AND a.page_id <> a.account_id) OR
      (a.login_provider = 'instagram' AND a.page_id = a.account_id AND a.token_expires_at IS NOT NULL))
$$;
REVOKE ALL ON FUNCTION public.social_account_is_ready(public.social_accounts) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_account_is_ready(public.social_accounts) TO service_role;

CREATE OR REPLACE FUNCTION public.bind_social_account(p_company_id uuid,p_actor_id uuid,p_channel text,p_account_id text,p_page_id text,p_name text,p_token text,p_api_version text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE existing public.social_accounts%ROWTYPE; result uuid;
BEGIN
  IF p_company_id IS NULL OR p_channel IS NULL OR p_channel NOT IN ('instagram','facebook')
    OR p_account_id IS NULL OR p_account_id !~ '^\d{1,40}$' OR p_page_id IS NULL OR p_page_id !~ '^\d{1,40}$'
  THEN RAISE EXCEPTION 'social_invalid'; END IF;
  IF p_actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'social_forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account_companies WHERE company_id=p_company_id) THEN RAISE EXCEPTION 'social_forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('social-channel:'||p_company_id::text||':'||p_channel,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('social-identity:'||p_channel||':'||p_account_id,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('social-page:'||p_page_id,0));
  IF EXISTS(SELECT 1 FROM public.social_accounts WHERE login_provider='facebook' AND page_id=p_page_id AND company_id<>p_company_id)
    OR EXISTS(SELECT 1 FROM public.social_accounts WHERE channel=p_channel AND account_id=p_account_id AND company_id<>p_company_id)
  THEN RAISE EXCEPTION 'social_account_bound'; END IF;
  SELECT * INTO existing FROM public.social_accounts WHERE channel=p_channel AND login_provider='facebook' AND account_id=p_account_id FOR UPDATE;
  IF p_actor_id IS NULL THEN
    IF existing.id IS NOT NULL THEN
      IF NOT existing.enabled THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
      RETURN existing.id;
    END IF;
    IF EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel) THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel AND enabled
    AND (account_id<>p_account_id OR login_provider<>'facebook'))
  THEN RAISE EXCEPTION 'social_account_disconnect_required'; END IF;
  INSERT INTO public.social_accounts(company_id,channel,account_id,page_id,name,token_ciphertext,enabled,connected_by,api_version,login_provider,token_expires_at)
  VALUES(p_company_id,p_channel,p_account_id,p_page_id,left(p_name,200),p_token,true,p_actor_id,p_api_version,'facebook',NULL)
  ON CONFLICT(channel,login_provider,account_id) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,enabled=true,name=excluded.name,page_id=excluded.page_id,
    connected_by=coalesce(excluded.connected_by,social_accounts.connected_by),api_version=excluded.api_version,token_expires_at=NULL,updated_at=now()
  WHERE social_accounts.company_id=excluded.company_id RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'social_account_bound'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.bind_instagram_account(p_company_id uuid,p_actor_id uuid,p_account_id text,p_name text,p_token text,p_api_version text,p_expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE result uuid;
BEGIN
  IF p_company_id IS NULL OR p_account_id IS NULL OR p_account_id !~ '^\d{1,40}$'
    OR p_token IS NULL OR length(btrim(p_token)) = 0 OR length(p_token) > 32768
    OR p_api_version IS NULL OR p_api_version !~ '^v\d+\.\d+$'
    OR p_expires_at IS NULL OR NOT isfinite(p_expires_at) OR p_expires_at <= now() OR p_expires_at > now()+interval '61 days'
  THEN RAISE EXCEPTION 'social_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner')
  THEN RAISE EXCEPTION 'social_forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('social-channel:'||p_company_id::text||':instagram',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('social-identity:instagram:'||p_account_id,0));
  IF EXISTS(SELECT 1 FROM public.social_accounts WHERE channel='instagram' AND account_id=p_account_id AND company_id<>p_company_id)
  THEN RAISE EXCEPTION 'social_account_bound'; END IF;
  IF EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND channel='instagram' AND enabled
    AND (account_id<>p_account_id OR login_provider<>'instagram'))
  THEN RAISE EXCEPTION 'social_account_disconnect_required'; END IF;
  INSERT INTO public.social_accounts(company_id,channel,account_id,page_id,name,token_ciphertext,enabled,connected_by,api_version,login_provider,token_expires_at)
  VALUES(p_company_id,'instagram',p_account_id,p_account_id,left(coalesce(p_name,''),200),p_token,true,p_actor_id,p_api_version,'instagram',p_expires_at)
  ON CONFLICT(channel,login_provider,account_id) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,enabled=true,name=excluded.name,
    connected_by=excluded.connected_by,api_version=excluded.api_version,token_expires_at=excluded.token_expires_at,updated_at=now()
  WHERE social_accounts.company_id=excluded.company_id RETURNING id INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'social_account_bound'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.configure_social_account(p_company_id uuid,p_actor_id uuid,p_channel text,p_action text,p_mode text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE account uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'social_owner_required'; END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('instagram','facebook') THEN RAISE EXCEPTION 'social_invalid'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('social-channel:'||p_company_id::text||':'||p_channel,0));
  SELECT id INTO account FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel AND enabled FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action='disconnect' THEN RETURN true; END IF;
    RAISE EXCEPTION 'social_connection_unavailable';
  END IF;
  IF p_action='disconnect' THEN
    IF EXISTS(SELECT 1 FROM public.social_messages m JOIN public.social_threads t ON t.id=m.thread_id AND t.company_id=m.company_id
      WHERE t.account_id=account AND m.status='sending' AND m.updated_at>now()-interval '2 minutes') THEN RAISE EXCEPTION 'social_sending'; END IF;
    UPDATE public.social_accounts SET enabled=false,token_ciphertext=NULL,default_mode='human',updated_at=now() WHERE id=account;
    UPDATE public.social_threads SET mode='human' WHERE company_id=p_company_id AND account_id=account;
    UPDATE public.social_messages SET status='failed',error_code='disconnected',error_message='O canal foi desconectado antes do envio.',updated_at=now()
      WHERE company_id=p_company_id AND thread_id IN(SELECT id FROM public.social_threads WHERE account_id=account) AND status='pending';
    -- Instagram Login has no dependency on the Page-selection authorization.
    -- Disconnecting either Instagram provider must not log Facebook out.
    IF p_channel='facebook' THEN DELETE FROM public.social_authorizations WHERE company_id=p_company_id; END IF;
  ELSIF p_action='mode' AND p_mode IN ('human','suggestions','automatic') THEN
    UPDATE public.social_accounts SET default_mode=p_mode,updated_at=now() WHERE id=account;
  ELSE RAISE EXCEPTION 'social_invalid'; END IF;
  RETURN true;
END $$;

-- Existing inbox/receive/enqueue/claim definitions below retain their tenant,
-- attendance, idempotency, AI and response-window rules.
CREATE OR REPLACE FUNCTION public.read_social_inbox(p_company_id uuid,p_actor_id uuid,p_channel text,p_thread_id uuid DEFAULT NULL,p_before_at timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,p_contacts_before_at timestamptz DEFAULT NULL,p_contacts_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor public.broker_accounts%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active;
 IF NOT FOUND OR p_channel NOT IN ('instagram','facebook') THEN RAISE EXCEPTION 'social_forbidden'; END IF;
 SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',t.id,'leadId',t.lead_id,'channel',a.channel,'loginProvider',a.login_provider,'name',l.name,'assignedTo',t.assigned_to,'assignedBrokerId',t.assigned_broker_id,'lastMessageAt',t.last_message_at,'lastInboundAt',t.last_inbound_at,'mode',t.mode,'enabled',public.social_account_is_ready(a),
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

CREATE OR REPLACE FUNCTION public.receive_social_message(p_account_id uuid,p_lead_id uuid,p_recipient_id text,p_external_id text,p_content text,p_media jsonb,p_media_type text,p_occurred_at timestamptz)
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
  IF EXISTS(SELECT 1 FROM public.social_threads WHERE company_id=a.company_id AND lead_id=p_lead_id AND (account_id<>a.id OR recipient_id<>p_recipient_id))
   OR EXISTS(SELECT 1 FROM public.leads WHERE company_id=a.company_id AND id=p_lead_id AND
    (coalesce(interest_profile->>'socialLoginProvider','facebook')<>a.login_provider
     OR (interest_profile->>'socialAccountId' IS NOT NULL AND interest_profile->>'socialAccountId'<>a.account_id)))
  THEN RAISE EXCEPTION 'social_identity_conflict'; END IF;
  INSERT INTO public.leads(id,company_id,name,phone,goal,property_type,region,details,summary,score,temperature,source,lifecycle_status,interest_profile)
  VALUES(p_lead_id,a.company_id,CASE WHEN a.channel='instagram' THEN 'Contato do Instagram' ELSE 'Contato do Facebook' END,'','Não informado','Não informado','Não informado',p_content,'Contato recebido pelo canal '||origin,0,'Frio',origin,'Novo',jsonb_build_object('socialChannel',a.channel,'socialLoginProvider',a.login_provider,'socialAccountId',a.account_id,'socialSenderId',p_recipient_id))
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO public.social_threads(company_id,account_id,lead_id,recipient_id,mode) VALUES(a.company_id,a.id,p_lead_id,p_recipient_id,a.default_mode) RETURNING * INTO t;
  -- The deterministic lead identity includes the company, Instagram account
  -- and scoped sender. Preserve its retained history without treating an old
  -- display timestamp as a fresh interaction or triggering retrospective AI.
  IF a.channel='instagram' AND a.login_provider='facebook' THEN
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
 UPDATE public.leads SET last_contact_at=greatest(last_contact_at,observed),interest_profile=coalesce(interest_profile,'{}'::jsonb)||jsonb_build_object('socialChannel',a.channel,'socialLoginProvider',a.login_provider,'socialAccountId',a.account_id,'socialSenderId',p_recipient_id) WHERE company_id=a.company_id AND id=t.lead_id;
 RETURN jsonb_build_object('saved',true,'companyId',a.company_id,'threadId',t.id,'leadId',t.lead_id,'messageId',mid,'mode',t.mode);
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_social_message(p_company_id uuid,p_thread_id uuid,p_actor_id uuid,p_key text,p_content text,p_media jsonb,p_source text,p_reply_to uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.social_threads%ROWTYPE; m public.social_messages%ROWTYPE; actor public.broker_accounts%ROWTYPE; mid uuid;
BEGIN
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=p_thread_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=t.account_id AND a.company_id=p_company_id AND public.social_account_is_ready(a)) THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
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

CREATE OR REPLACE FUNCTION public.claim_social_message(p_company_id uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.social_threads%ROWTYPE; m public.social_messages%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.social_accounts a WHERE a.company_id=p_company_id AND a.id=(
  SELECT thread.account_id FROM public.social_threads thread JOIN public.social_messages message ON message.company_id=thread.company_id AND message.thread_id=thread.id WHERE message.company_id=p_company_id AND message.id=p_message_id
 ) FOR SHARE;
 SELECT * INTO t FROM public.social_threads WHERE company_id=p_company_id AND id=(SELECT thread_id FROM public.social_messages WHERE company_id=p_company_id AND id=p_message_id) FOR UPDATE;
 SELECT * INTO m FROM public.social_messages WHERE company_id=p_company_id AND id=p_message_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF m.status='sending' AND m.updated_at<=now()-interval '2 minutes' THEN
  UPDATE public.social_messages SET status='unknown',error_code='dispatch_interrupted',error_message='O envio pode ter ocorrido. Confira no canal antes de enviar novamente.',updated_at=now() WHERE id=m.id; RETURN NULL;
 END IF;
 IF m.status<>'pending' THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.social_accounts a WHERE a.id=t.account_id AND a.company_id=p_company_id AND public.social_account_is_ready(a))
  OR (m.source='ai' AND (t.mode<>'automatic' OR t.last_inbound_message_id IS DISTINCT FROM m.reply_to_id OR EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=p_company_id AND document#>>'{settings,ai,automaticMode}'='human')))
  OR (m.source<>'ai' AND (t.assigned_broker_id IS DISTINCT FROM m.actor_id OR t.mode='automatic' OR NOT EXISTS(SELECT 1 FROM public.broker_accounts b JOIN public.leads l ON l.company_id=b.company_id AND l.id=t.lead_id WHERE b.id=m.actor_id AND b.company_id=p_company_id AND b.active AND (b.role='owner' OR nullif(btrim(l.assigned_to),'') IS NULL OR l.assigned_to=b.name))))
  OR t.last_inbound_at IS NULL OR t.last_inbound_at<now()-interval '24 hours' THEN
  UPDATE public.social_messages SET status='failed',error_code='dispatch_precondition',error_message='O atendimento, a conexão ou a janela de resposta mudou.',updated_at=now() WHERE id=m.id; RETURN NULL;
 END IF;
 UPDATE public.social_messages SET status='sending',updated_at=now() WHERE id=m.id;
 RETURN jsonb_build_object('messageId',m.id,'threadId',t.id,'accountId',t.account_id,'recipientId',t.recipient_id,'content',m.content,'mediaUrls',m.media_urls);
END $$;

CREATE OR REPLACE FUNCTION public.schedule_social_ai_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.direction='incoming' AND NEW.status='received' AND NEW.occurred_at>now()-interval '24 hours' THEN
  INSERT INTO public.social_ai_jobs(company_id,thread_id,message_id,lead_id)
  SELECT NEW.company_id,NEW.thread_id,NEW.id,t.lead_id FROM public.social_threads t JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id
   WHERE t.company_id=NEW.company_id AND t.id=NEW.thread_id AND t.mode='automatic' AND public.social_account_is_ready(a)
   AND NOT EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=t.company_id AND document#>>'{settings,ai,automaticMode}'='human')
  ON CONFLICT(message_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.claim_social_ai_job(p_lease_id uuid,p_company_id uuid DEFAULT NULL,p_message_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.social_ai_jobs%ROWTYPE;
BEGIN
 IF p_lease_id IS NULL THEN RAISE EXCEPTION 'social_invalid'; END IF;
 WITH exhausted AS (
  UPDATE public.social_ai_jobs SET status='failed',error_code='attempts_exhausted',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE status='running' AND lease_until<clock_timestamp() AND attempts>=3 AND (p_company_id IS NULL OR company_id=p_company_id) AND (p_message_id IS NULL OR message_id=p_message_id)
   RETURNING company_id,thread_id,message_id
 ), cancelled AS (
  UPDATE public.social_messages m SET status=CASE WHEN m.status='sending' THEN 'unknown' ELSE 'failed' END,error_code='ai_recovery_exhausted',error_message='A recuperação automática foi encerrada. Confira a conversa antes de responder.',updated_at=clock_timestamp()
   FROM exhausted e WHERE m.company_id=e.company_id AND m.thread_id=e.thread_id AND m.reply_to_id=e.message_id AND m.source='ai' AND (m.status='pending' OR (m.status='sending' AND m.updated_at<clock_timestamp()-interval '2 minutes')) RETURNING m.id
 ) UPDATE public.social_threads t SET mode='human' FROM exhausted e WHERE t.company_id=e.company_id AND t.id=e.thread_id AND t.mode='automatic' AND t.last_inbound_message_id=e.message_id
  AND NOT EXISTS(SELECT 1 FROM public.social_messages m WHERE m.company_id=t.company_id AND m.thread_id=t.id AND m.status='sending' AND m.updated_at>clock_timestamp()-interval '2 minutes');
 -- Jobs queued while a token was valid may outlive that credential. Cancel
 -- only pending/abandoned work; never revoke a live AI lease underneath a turn.
 WITH disconnected AS (
  UPDATE public.social_ai_jobs job SET status='failed',error_code='connection_unavailable',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
  WHERE (status='pending' OR (status='running' AND lease_until<clock_timestamp()))
   AND (p_company_id IS NULL OR company_id=p_company_id) AND (p_message_id IS NULL OR message_id=p_message_id)
   AND NOT EXISTS(SELECT 1 FROM public.social_threads t JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id
    WHERE t.company_id=job.company_id AND t.id=job.thread_id AND public.social_account_is_ready(a))
  RETURNING company_id,thread_id,message_id
 )
 UPDATE public.social_messages m SET status=CASE WHEN m.status='sending' THEN 'unknown' ELSE 'failed' END,
  error_code='connection_unavailable',error_message='A conexão expirou ou foi desconectada antes da resposta.',updated_at=clock_timestamp()
 FROM disconnected d WHERE m.company_id=d.company_id AND m.thread_id=d.thread_id AND m.reply_to_id=d.message_id AND m.source='ai'
  AND (m.status='pending' OR (m.status='sending' AND m.updated_at<clock_timestamp()-interval '2 minutes'));
 SELECT * INTO j FROM public.social_ai_jobs WHERE attempts<3 AND ((status='pending' AND next_attempt_at<=clock_timestamp()) OR (status='running' AND lease_until<clock_timestamp()))
  AND (p_company_id IS NULL OR company_id=p_company_id) AND (p_message_id IS NULL OR message_id=p_message_id)
  ORDER BY next_attempt_at,created_at,message_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Recheck after acquiring the job lock, and keep the account stable until
 -- this claim commits. The application rechecks before any paid provider call.
 PERFORM 1 FROM public.social_threads t JOIN public.social_accounts a ON a.company_id=t.company_id AND a.id=t.account_id
  WHERE t.company_id=j.company_id AND t.id=j.thread_id AND public.social_account_is_ready(a) FOR SHARE OF a;
 IF NOT FOUND THEN
  UPDATE public.social_ai_jobs SET status='failed',error_code='connection_unavailable',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp()
   WHERE message_id=j.message_id;
  RETURN NULL;
 END IF;
 UPDATE public.social_ai_jobs SET status='running',attempts=attempts+1,lease_id=p_lease_id,lease_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp() WHERE message_id=j.message_id RETURNING * INTO j;
 RETURN jsonb_build_object('companyId',j.company_id,'threadId',j.thread_id,'leadId',j.lead_id,'messageId',j.message_id,'leaseId',p_lease_id,'attempts',j.attempts);
END $$;

REVOKE ALL ON FUNCTION public.bind_instagram_account(uuid,uuid,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_instagram_account(uuid,uuid,text,text,text,text,timestamptz) TO service_role;
COMMIT;
