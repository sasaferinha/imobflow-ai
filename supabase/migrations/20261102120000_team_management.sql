BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public.broker_presence (
 company_id uuid NOT NULL, broker_id uuid NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,broker_id),
 FOREIGN KEY(company_id,broker_id) REFERENCES public.broker_accounts(company_id,id) ON DELETE CASCADE
);
ALTER TABLE public.broker_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.broker_presence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.broker_presence TO service_role;
ALTER TABLE public.leads ADD COLUMN management_assigned_at timestamptz;
CREATE FUNCTION public.touch_broker_presence(p_company_id uuid,p_broker_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_broker_id AND active) THEN RETURN false; END IF;
 INSERT INTO public.broker_presence(company_id,broker_id,last_seen_at) VALUES(p_company_id,p_broker_id,clock_timestamp())
 ON CONFLICT(company_id,broker_id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at;
 RETURN true;
END $$;

-- Uses authoritative lead ownership; a saved JSON assignee cannot hide a backlog.
CREATE FUNCTION public.broker_management_blocked(p_company_id uuid,p_broker_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE doc jsonb; config jsonb; broker_name text; broker_role text; candidate record; grace interval; event_done boolean;
BEGIN
 SELECT name,role INTO broker_name,broker_role FROM public.broker_accounts WHERE company_id=p_company_id AND id=p_broker_id AND active;
 IF NOT FOUND THEN RETURN true; END IF;
 IF broker_role='owner' THEN RETURN false; END IF;
 SELECT document INTO doc FROM public.crm_evolution_workspaces WHERE company_id=p_company_id;
 config:=doc#>'{settings,management}';
 IF config->>'blockNewLeads' IS DISTINCT FROM 'true' THEN RETURN false; END IF;
 grace:=make_interval(hours=>greatest(1,least(8760,coalesce((config->>'graceHours')::integer,24))));
 FOR candidate IN
  SELECT 'case:'||l.id::text AS case_id, l.id AS lead_id, coalesce(l.management_assigned_at,l.created_at) AS assigned_at, 'Negociação'::text AS journey
  FROM public.leads l WHERE l.company_id=p_company_id AND public.crm_evolution_can_edit_lead(p_company_id,p_broker_id,l.id) AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
  UNION ALL
  SELECT r->>'id',NULL::uuid,coalesce(nullif(r#>>'{data,assignedAt}','')::timestamptz,(r->>'createdAt')::timestamptz),coalesce(r#>>'{data,journey}','Negociação')
  FROM jsonb_array_elements(coalesce(doc->'records','[]'::jsonb)) r WHERE r->>'kind'='cases' AND r#>>'{data,assignedTo}'=p_broker_id::text
   AND r#>>'{data,status}'='Aberto' AND r->'legacy' IS NULL
 LOOP
  IF candidate.assigned_at IS NULL OR candidate.assigned_at+grace>now() THEN CONTINUE; END IF;
  IF candidate.journey<>'Captação' AND coalesce(config->>'registrationRequired','true')='true' AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(coalesce(doc->'events','[]'::jsonb)) e
    WHERE coalesce(e->>'caseId',e->>'recordId')=candidate.case_id AND e->>'actorId'=p_broker_id::text AND nullif(e->>'at','')::timestamptz>=candidate.assigned_at AND (e#>>'{registration,action}' IN ('attendance','schedule','visit','proposal','close') OR nullif(e#>>'{changes,visitStartedAt,to}','') IS NOT NULL OR nullif(e#>>'{changes,visitEndedAt,to}','') IS NOT NULL)
  ) THEN RETURN true; END IF;
  IF config->>'overdueTasksBlock'='true' AND (
   EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(doc->'records','[]'::jsonb)) t WHERE t->>'kind'='tasks' AND t#>>'{data,caseId}'=candidate.case_id
    AND t#>>'{data,status}' IN ('Pendente','Confirmada') AND nullif(t#>>'{data,dueAt}','')::timestamptz+grace<=now())
   OR EXISTS(SELECT 1 FROM public.appointments a WHERE a.company_id=p_company_id AND a.lead_id=candidate.lead_id AND a.status IN ('Pendente','Confirmada','Aguardando','Agendada') AND a.scheduled_at+grace<=now())
  ) THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;
CREATE FUNCTION public.enforce_broker_management() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target_broker uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
 IF nullif(btrim(NEW.assigned_to),'') IS NULL THEN NEW.management_assigned_at:=NULL; RETURN NEW; END IF;
 SELECT id INTO target_broker FROM public.broker_accounts WHERE company_id=NEW.company_id AND regexp_replace(public.match_normalize(name),'\s+',' ','g')=regexp_replace(public.match_normalize(NEW.assigned_to),'\s+',' ','g') AND active;
 IF FOUND AND public.broker_management_blocked(NEW.company_id,target_broker) THEN RAISE EXCEPTION 'broker_compliance_pending'; END IF;
 NEW.management_assigned_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_broker_management BEFORE INSERT OR UPDATE OF assigned_to ON public.leads FOR EACH ROW EXECUTE FUNCTION public.enforce_broker_management();

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
 RETURN true;
END $$;

-- One function feeds on-screen alerts, push admission, and final pre-send revalidation.
CREATE OR REPLACE FUNCTION public.broker_unassigned_waiting(p_company_id uuid,p_broker_id uuid)
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
  'dutyPriorityUntil',CASE WHEN priority_enabled AND EXISTS(SELECT 1 FROM public.broker_presence bp JOIN public.broker_accounts active_broker ON active_broker.company_id=bp.company_id AND active_broker.id=bp.broker_id AND active_broker.active WHERE bp.company_id=p_company_id AND bp.broker_id=ANY(p.broker_ids) AND bp.last_seen_at>now()-interval '2 minutes' AND NOT public.broker_management_blocked(p_company_id,bp.broker_id)) AND c.assigned_broker_id IS NULL AND coalesce(c.assigned_to,'')='' THEN p.preferred_until END,
  'dutyPreferred',coalesce(p_broker_id=ANY(p.broker_ids),false) AND EXISTS(SELECT 1 FROM public.broker_presence bp WHERE bp.company_id=p_company_id AND bp.broker_id=p_broker_id AND bp.last_seen_at>now()-interval '2 minutes')
 ) ORDER BY i.last_message_at DESC,i.last_message_id DESC)
 FROM public.conversation_inbox i JOIN public.conversations c ON c.id=i.conversation_id AND c.company_id=i.company_id
 JOIN public.messages m ON m.id=i.last_message_id AND m.company_id=i.company_id
 LEFT JOIN public.conversation_reads r ON r.conversation_id=i.conversation_id AND r.broker_id=p_broker_id AND r.company_id=p_company_id
 LEFT JOIN public.lead_duty_priorities p ON p.lead_id=c.lead_id AND p.company_id=c.company_id
 WHERE i.company_id=p_company_id AND (p_lead_id IS NULL OR c.lead_id=p_lead_id)), '[]'::jsonb);
END $$;

CREATE FUNCTION public.team_management_ready() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$ SELECT true; $$;
REVOKE ALL ON FUNCTION public.touch_broker_presence(uuid,uuid),public.broker_management_blocked(uuid,uuid),public.enforce_broker_management(),public.team_management_ready() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enforce_broker_management() FROM service_role;
GRANT EXECUTE ON FUNCTION public.touch_broker_presence(uuid,uuid),public.broker_management_blocked(uuid,uuid),public.team_management_ready() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
