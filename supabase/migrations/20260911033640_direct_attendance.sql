BEGIN;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS bot_paused boolean NOT NULL DEFAULT false;
CREATE TABLE public.attendance_replies (
 company_id uuid NOT NULL REFERENCES public.companies(id), dedup_key text NOT NULL CHECK(length(dedup_key) BETWEEN 1 AND 600),
 conversation_id uuid NOT NULL, state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','accepted','uncertain')),
 provider_message_id text CHECK(provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 500), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,dedup_key),
 FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id) ON DELETE CASCADE,
 UNIQUE(company_id,provider_message_id)
);
CREATE INDEX attendance_replies_conversation_fk ON public.attendance_replies(company_id,conversation_id);
ALTER TABLE public.attendance_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_replies FROM PUBLIC,anon,authenticated,service_role;
-- Reserve only verified, persisted inbound messages. Never release a reservation
-- after an ambiguous send: retries could contact the same client twice.
CREATE FUNCTION public.claim_attendance_reply(p_company_id uuid,p_conversation_id uuid,p_external_id text,p_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inserted_key text;
BEGIN
 IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 600 OR p_external_id IS NULL OR length(p_external_id) NOT BETWEEN 1 AND 512 THEN RETURN false; END IF;
 PERFORM 1 FROM public.conversations c JOIN public.leads l ON l.company_id=c.company_id AND l.id=c.lead_id
 JOIN public.messages m ON m.company_id=c.company_id AND m.conversation_id=c.id
 WHERE c.company_id=p_company_id AND c.id=p_conversation_id AND m.external_message_id=p_external_id
 AND m.direction='incoming' AND m.created_at>now()-interval '24 hours' AND m.created_at<now()+interval '5 minutes'
 AND l.lifecycle_status NOT IN ('Convertido','Perdido') AND coalesce(c.assigned_to,'')='' AND NOT c.bot_paused AND c.status IN ('open','Aberta')
 AND NOT EXISTS(SELECT 1 FROM public.messages h WHERE h.company_id=c.company_id AND h.conversation_id=c.id AND h.sender_type='human' AND h.created_at>m.created_at)
 FOR UPDATE OF c;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.attendance_replies(company_id,conversation_id,dedup_key) VALUES(p_company_id,p_conversation_id,p_key)
 ON CONFLICT DO NOTHING RETURNING dedup_key INTO inserted_key;
 RETURN inserted_key IS NOT NULL;
END $$;
CREATE FUNCTION public.finish_attendance_reply(p_company_id uuid,p_key text,p_provider_id text,p_content text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.attendance_replies%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.attendance_replies WHERE company_id=p_company_id AND dedup_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'reply_not_found'; END IF;
 IF r.state='accepted' THEN RETURN; END IF;
 IF p_provider_id IS NULL THEN UPDATE public.attendance_replies SET state='uncertain' WHERE company_id=p_company_id AND dedup_key=p_key;RETURN; END IF;
 IF length(p_provider_id) NOT BETWEEN 1 AND 500 OR length(p_content) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 INSERT INTO public.messages(company_id,conversation_id,direction,sender_type,content,external_message_id)
 VALUES(p_company_id,r.conversation_id,'outgoing','ai',p_content,p_provider_id);
 UPDATE public.conversations SET last_message_at=greatest(last_message_at,now()) WHERE company_id=p_company_id AND id=r.conversation_id;
 UPDATE public.attendance_replies SET state='accepted',provider_message_id=p_provider_id WHERE company_id=p_company_id AND dedup_key=p_key;
END $$;
-- Optimistic concurrency: a delayed extraction must not replace a newer profile.
CREATE FUNCTION public.merge_attendance_profile(p_company_id uuid,p_lead_id uuid,p_version timestamptz,p_profile jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE l public.leads%ROWTYPE; q jsonb;
BEGIN
 IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 SELECT * INTO l FROM public.leads WHERE company_id=p_company_id AND id=p_lead_id FOR UPDATE;
 IF NOT FOUND OR l.updated_at IS DISTINCT FROM p_version THEN RETURN false; END IF;
 q:=l.interest_profile||jsonb_strip_nulls(p_profile);
 UPDATE public.leads SET interest_profile=q,updated_at=clock_timestamp(),
 goal=CASE p_profile->>'purpose' WHEN 'Venda' THEN 'Comprar' WHEN 'Aluguel' THEN 'Alugar' ELSE goal END,
 property_type=coalesce(nullif(p_profile->>'propertyType',''),property_type),
 region=CASE WHEN jsonb_array_length(coalesce(p_profile->'regions','[]'))>0 THEN (SELECT string_agg(value,', ') FROM jsonb_array_elements_text(p_profile->'regions')) ELSE region END,
 budget_max=coalesce((p_profile->>'budgetMax')::numeric,budget_max)
 WHERE company_id=p_company_id AND id=p_lead_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_attendance_reply(uuid,uuid,text,text),public.finish_attendance_reply(uuid,text,text,text),public.merge_attendance_profile(uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_attendance_reply(uuid,uuid,text,text),public.finish_attendance_reply(uuid,text,text,text),public.merge_attendance_profile(uuid,uuid,timestamptz,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
