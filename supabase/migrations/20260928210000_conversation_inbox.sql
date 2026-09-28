BEGIN;
SET LOCAL lock_timeout = '5s';
-- Pause inserts during the one-time backfill so no arrival can fall between it and the trigger.
LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.conversation_inbox (
  conversation_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  incoming_count bigint NOT NULL DEFAULT 0 CHECK(incoming_count >= 0),
  last_message_id uuid NOT NULL,
  last_message_at timestamptz NOT NULL,
  FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,conversation_id,last_message_id) REFERENCES public.messages(company_id,conversation_id,id)
);
CREATE INDEX conversation_inbox_company_recent ON public.conversation_inbox(company_id,last_message_at DESC,conversation_id);
CREATE TABLE public.conversation_reads (
  company_id uuid NOT NULL,
  broker_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  read_position bigint NOT NULL CHECK(read_position >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(broker_id,conversation_id),
  FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,conversation_id) REFERENCES public.conversations(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.conversation_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_inbox,public.conversation_reads FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.conversation_inbox,public.conversation_reads TO service_role;

INSERT INTO public.conversation_inbox(company_id,conversation_id,incoming_count,last_message_id,last_message_at)
SELECT company_id,conversation_id,incoming_count,id,created_at FROM (
  SELECT company_id,conversation_id,id,created_at,
    count(*) FILTER(WHERE direction IN ('incoming','Entrada')) OVER(PARTITION BY company_id,conversation_id) AS incoming_count,
    row_number() OVER(PARTITION BY company_id,conversation_id ORDER BY created_at DESC,id DESC) AS rownum
  FROM public.messages
) ranked WHERE rownum=1;

CREATE FUNCTION public.track_conversation_inbox() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.conversation_inbox AS inbox(company_id,conversation_id,incoming_count,last_message_id,last_message_at)
  VALUES(NEW.company_id,NEW.conversation_id,CASE WHEN NEW.direction IN ('incoming','Entrada') THEN 1 ELSE 0 END,NEW.id,NEW.created_at)
  ON CONFLICT(conversation_id) DO UPDATE SET
    incoming_count=inbox.incoming_count+EXCLUDED.incoming_count,
    last_message_id=CASE WHEN (EXCLUDED.last_message_at,EXCLUDED.last_message_id)>(inbox.last_message_at,inbox.last_message_id) THEN EXCLUDED.last_message_id ELSE inbox.last_message_id END,
    last_message_at=greatest(inbox.last_message_at,EXCLUDED.last_message_at);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.track_conversation_inbox() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER track_conversation_inbox AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.track_conversation_inbox();

CREATE FUNCTION public.get_conversation_inbox(p_company_id uuid,p_broker_id uuid,p_lead_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active) THEN RAISE EXCEPTION 'account_required'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'conversationId',c.id,'leadId',c.lead_id,'lastMessageId',i.last_message_id,
    'lastMessageAt',i.last_message_at,'lastMessageText',left(m.content,300),
    'incomingCount',i.incoming_count,'unread',greatest(0,i.incoming_count-COALESCE(r.read_position,0))
  ) ORDER BY i.last_message_at DESC,i.last_message_id DESC)
  FROM public.conversation_inbox i
  JOIN public.conversations c ON c.id=i.conversation_id AND c.company_id=i.company_id
  JOIN public.messages m ON m.id=i.last_message_id AND m.company_id=i.company_id
  LEFT JOIN public.conversation_reads r ON r.conversation_id=i.conversation_id AND r.broker_id=p_broker_id AND r.company_id=p_company_id
  WHERE i.company_id=p_company_id AND (p_lead_id IS NULL OR c.lead_id=p_lead_id)), '[]'::jsonb);
END; $$;

CREATE FUNCTION public.mark_conversation_read(p_company_id uuid,p_broker_id uuid,p_lead_id uuid,p_positions jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; target uuid; position bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE id=p_broker_id AND company_id=p_company_id AND active) THEN RAISE EXCEPTION 'account_required'; END IF;
  IF jsonb_typeof(p_positions)<>'array' OR jsonb_array_length(p_positions)>100 THEN RAISE EXCEPTION 'invalid_read_boundary'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_positions) LOOP
    target:=(item->>'conversationId')::uuid; position:=(item->>'position')::bigint;
    IF position IS NULL OR position<0 OR NOT EXISTS(
      SELECT 1 FROM public.conversation_inbox i JOIN public.conversations c ON c.id=i.conversation_id AND c.company_id=i.company_id
      WHERE i.company_id=p_company_id AND i.conversation_id=target AND c.lead_id=p_lead_id AND position<=i.incoming_count
    ) THEN RAISE EXCEPTION 'invalid_read_boundary'; END IF;
    INSERT INTO public.conversation_reads AS receipt(company_id,broker_id,conversation_id,read_position)
    VALUES(p_company_id,p_broker_id,target,position)
    ON CONFLICT(broker_id,conversation_id) DO UPDATE SET read_position=greatest(receipt.read_position,EXCLUDED.read_position),updated_at=now();
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.get_conversation_inbox(uuid,uuid,uuid),public.mark_conversation_read(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_inbox(uuid,uuid,uuid),public.mark_conversation_read(uuid,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
