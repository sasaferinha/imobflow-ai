BEGIN;
SET LOCAL lock_timeout='5s';

-- Historical accounts retain their identity and tenant. Only the active slot
-- is reusable; a new account never inherits recipients, leads or messages.
ALTER TABLE public.social_accounts DROP CONSTRAINT social_accounts_company_id_channel_key;
CREATE UNIQUE INDEX social_accounts_one_active_channel ON public.social_accounts(company_id,channel) WHERE enabled;

CREATE OR REPLACE FUNCTION public.bind_social_account(p_company_id uuid,p_actor_id uuid,p_channel text,p_account_id text,p_page_id text,p_name text,p_token text,p_api_version text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 IF EXISTS(SELECT 1 FROM public.social_accounts WHERE page_id=p_page_id AND company_id<>p_company_id) THEN RAISE EXCEPTION 'social_account_bound'; END IF;
 SELECT * INTO existing FROM public.social_accounts WHERE channel=p_channel AND account_id=p_account_id FOR UPDATE;
 IF FOUND AND existing.company_id<>p_company_id THEN RAISE EXCEPTION 'social_account_bound'; END IF;
 IF p_actor_id IS NULL THEN
  IF existing.id IS NOT NULL THEN
   IF NOT existing.enabled THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
   RETURN existing.id;
  END IF;
  -- Legacy environment onboarding is permitted only before this channel has
  -- ever been managed in the panel; it cannot undo an explicit disconnect.
  IF EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel) THEN RAISE EXCEPTION 'social_connection_unavailable'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel AND enabled AND account_id<>p_account_id) THEN RAISE EXCEPTION 'social_account_disconnect_required'; END IF;
 INSERT INTO public.social_accounts(company_id,channel,account_id,page_id,name,token_ciphertext,enabled,connected_by,api_version)
 VALUES(p_company_id,p_channel,p_account_id,p_page_id,left(p_name,200),p_token,true,p_actor_id,p_api_version)
 ON CONFLICT(channel,account_id) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,enabled=true,name=excluded.name,page_id=excluded.page_id,connected_by=coalesce(excluded.connected_by,social_accounts.connected_by),api_version=excluded.api_version,updated_at=now()
 WHERE social_accounts.company_id=excluded.company_id
 RETURNING id INTO result;
 IF result IS NULL THEN RAISE EXCEPTION 'social_account_bound'; END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.configure_social_account(p_company_id uuid,p_actor_id uuid,p_channel text,p_action text,p_mode text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_actor_id AND active AND role='owner') THEN RAISE EXCEPTION 'social_owner_required'; END IF;
 IF p_channel IS NULL OR p_channel NOT IN ('instagram','facebook') THEN RAISE EXCEPTION 'social_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('social-channel:'||p_company_id::text||':'||p_channel,0));
 SELECT id INTO account FROM public.social_accounts WHERE company_id=p_company_id AND channel=p_channel AND enabled FOR UPDATE;
 IF NOT FOUND THEN
  -- A retry after a successful disconnect is harmless and cannot select a
  -- historical account or silently reconnect one.
  IF p_action='disconnect' THEN RETURN true; END IF;
  RAISE EXCEPTION 'social_connection_unavailable';
 END IF;
 IF p_action='disconnect' THEN
  IF EXISTS(SELECT 1 FROM public.social_messages m JOIN public.social_threads t ON t.id=m.thread_id AND t.company_id=m.company_id WHERE t.account_id=account AND m.status='sending' AND m.updated_at>now()-interval '2 minutes') THEN RAISE EXCEPTION 'social_sending'; END IF;
  UPDATE public.social_accounts SET enabled=false,token_ciphertext=NULL,default_mode='human',updated_at=now() WHERE id=account;
  UPDATE public.social_threads SET mode='human' WHERE company_id=p_company_id AND account_id=account;
  UPDATE public.social_messages SET status='failed',error_code='disconnected',error_message='O canal foi desconectado antes do envio.',updated_at=now() WHERE company_id=p_company_id AND thread_id IN(SELECT id FROM public.social_threads WHERE account_id=account) AND status='pending';
  DELETE FROM public.social_authorizations WHERE company_id=p_company_id;
 ELSIF p_action='mode' AND p_mode IN ('human','suggestions','automatic') THEN
  UPDATE public.social_accounts SET default_mode=p_mode,updated_at=now() WHERE id=account;
 ELSE RAISE EXCEPTION 'social_invalid'; END IF;
 RETURN true;
END $$;

-- Dispatch and disconnect use the same account -> thread -> message lock
-- ordering. A disconnect cannot pass its sending check while a claim starts.
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
 IF NOT EXISTS(SELECT 1 FROM public.social_accounts WHERE id=t.account_id AND company_id=p_company_id AND enabled)
  OR (m.source='ai' AND (t.mode<>'automatic' OR t.last_inbound_message_id IS DISTINCT FROM m.reply_to_id OR EXISTS(SELECT 1 FROM public.crm_evolution_workspaces WHERE company_id=p_company_id AND document#>>'{settings,ai,automaticMode}'='human')))
  OR (m.source<>'ai' AND (t.assigned_broker_id IS DISTINCT FROM m.actor_id OR t.mode='automatic' OR NOT EXISTS(SELECT 1 FROM public.broker_accounts b JOIN public.leads l ON l.company_id=b.company_id AND l.id=t.lead_id WHERE b.id=m.actor_id AND b.company_id=p_company_id AND b.active AND (b.role='owner' OR nullif(btrim(l.assigned_to),'') IS NULL OR l.assigned_to=b.name))))
  OR t.last_inbound_at IS NULL OR t.last_inbound_at<now()-interval '24 hours' THEN
  UPDATE public.social_messages SET status='failed',error_code='dispatch_precondition',error_message='O atendimento, a conexão ou a janela de resposta mudou.',updated_at=now() WHERE id=m.id; RETURN NULL;
 END IF;
 UPDATE public.social_messages SET status='sending',updated_at=now() WHERE id=m.id;
 RETURN jsonb_build_object('messageId',m.id,'threadId',t.id,'accountId',t.account_id,'recipientId',t.recipient_id,'content',m.content,'mediaUrls',m.media_urls);
END $$;

REVOKE ALL ON FUNCTION public.bind_social_account(uuid,uuid,text,text,text,text,text,text),public.configure_social_account(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_social_account(uuid,uuid,text,text,text,text,text,text),public.configure_social_account(uuid,uuid,text,text,text) TO service_role;
COMMIT;
