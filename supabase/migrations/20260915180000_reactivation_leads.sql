BEGIN;
-- Read-only detection. No outbound messages, no changes to property matching.
CREATE OR REPLACE FUNCTION public.list_reactivation_leads(p_company_id uuid,p_broker_id uuid,p_offset int DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(row_data),'[]'::jsonb) FROM (
   SELECT jsonb_build_object(
     'id',l.id,'name',l.name,'goal',l.goal,'propertyType',l.property_type,
     'region',l.region,'budgetMax',l.budget_max,'assignedTo',l.assigned_to,
     'lastContactAt',contact.last_at,'createdAt',l.created_at,
     'inactivityDays',floor(extract(epoch FROM now()-coalesce(contact.last_at,l.created_at))/86400)::int
   ) row_data
   FROM public.leads l
   LEFT JOIN LATERAL (
     SELECT max(greatest(m.created_at,CASE WHEN o.state='sent' THEN o.updated_at END)) last_at
     FROM public.conversations c
     JOIN public.messages m ON m.company_id=c.company_id AND m.conversation_id=c.id
     LEFT JOIN public.message_outbox o ON o.company_id=m.company_id AND o.id=m.id
     WHERE c.company_id=l.company_id AND c.lead_id=l.id
       AND (m.direction='incoming' OR (m.direction='outgoing' AND
         (m.delivery_status='sent' OR (m.delivery_status IS NULL AND m.external_message_id IS NOT NULL))))
   ) history ON true
   CROSS JOIN LATERAL (SELECT greatest(l.last_contact_at,history.last_at) last_at) contact
   WHERE l.company_id=p_company_id
     AND l.lifecycle_status IN ('Novo','Em atendimento','Visita','Proposta')
     AND public.can_access_opportunity(p_company_id,p_broker_id,l.id)
     AND coalesce(contact.last_at,l.created_at)<=now()-interval '15 days'
   ORDER BY coalesce(contact.last_at,l.created_at),l.id
   LIMIT 51 OFFSET greatest(0,least(coalesce(p_offset,0),1000000))
 ) page
$$;
REVOKE ALL ON FUNCTION public.list_reactivation_leads(uuid,uuid,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_reactivation_leads(uuid,uuid,int) TO service_role;
COMMIT;
