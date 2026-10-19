BEGIN;
SET LOCAL lock_timeout='5s';

-- Prefilter the queue before paging. Closed/invalid companies must not keep an
-- open company behind the same finite set of candidates on every scheduler run.
-- The authenticated API and dispatcher still revalidate with the JS helper.
CREATE FUNCTION public.web_push_business_hours_open(p_company_id uuid,p_checked_at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE config jsonb; zone_name text; local_time timestamp; item jsonb;
 start_clock text; end_clock text; day_number numeric; calendar_day text;
 holiday_year integer; holiday_month integer; holiday_day integer; away text;
BEGIN
 IF p_checked_at IS NULL OR NOT isfinite(p_checked_at) THEN RETURN false; END IF;
 SELECT business_hours INTO config FROM public.conversation_settings WHERE company_id=p_company_id;
 -- Match readBusinessHours: only an absent row or an empty object uses defaults.
 IF NOT FOUND OR config='{}'::jsonb THEN
  config:='{"timeZone":"America/Sao_Paulo","opens":"08:00","closes":"18:00","weekdays":[1,2,3,4,5],"holidays":[],"awayMessage":"Fora do horário de atendimento."}'::jsonb;
 END IF;
 IF jsonb_typeof(config) IS DISTINCT FROM 'object'
  OR jsonb_typeof(config->'timeZone') IS DISTINCT FROM 'string'
  OR length(config->>'timeZone')>100 THEN RETURN false; END IF;
 -- Use named IANA zones, never parse user-provided POSIX offsets with a reversed
 -- sign. Case-insensitive lookup matches Intl's canonicalization of zone names.
 SELECT name INTO zone_name FROM pg_catalog.pg_timezone_names
  WHERE lower(name)=lower(config->>'timeZone') LIMIT 1;
 IF zone_name IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(config->'opens') IS DISTINCT FROM 'string'
  OR jsonb_typeof(config->'closes') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 start_clock:=config->>'opens'; end_clock:=config->>'closes';
 IF start_clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  OR end_clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  OR start_clock>=end_clock THEN RETURN false; END IF;
 IF jsonb_typeof(config->'weekdays') IS DISTINCT FROM 'array'
  OR jsonb_typeof(config->'holidays') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(config->'weekdays')=0 OR jsonb_array_length(config->'holidays')>366 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(config->'weekdays') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  day_number:=(item#>>'{}')::numeric;
  IF day_number<>trunc(day_number) OR day_number<0 OR day_number>6 THEN RETURN false; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(config->'holidays') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  calendar_day:=item#>>'{}';
  IF calendar_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  holiday_year:=substring(calendar_day,1,4)::integer;
  holiday_month:=substring(calendar_day,6,2)::integer;
  holiday_day:=substring(calendar_day,9,2)::integer;
  -- JS accepts proleptic Gregorian year 0000; year 0400 has the same leap rule.
  -- make_date rejects normalized-but-invalid dates such as February 30.
  PERFORM make_date(CASE WHEN holiday_year=0 THEN 400 ELSE holiday_year END,holiday_month,holiday_day);
 END LOOP;
 IF jsonb_typeof(config->'awayMessage') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 away:=config->>'awayMessage';
 -- Match String.trim and the 1,000 UTF-16-code-unit limit in validation.
 IF btrim(away,E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=''
  OR length(away)+(SELECT count(*) FROM regexp_split_to_table(away,'') AS characters(value) WHERE ascii(value)>65535)>1000 THEN RETURN false; END IF;
 local_time:=p_checked_at AT TIME ZONE zone_name;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(config->'weekdays') days(value)
  WHERE (days.value#>>'{}')::numeric=extract(dow FROM local_time)) THEN RETURN false; END IF;
 calendar_day:=to_char(local_time,'YYYY-MM-DD');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(config->'holidays') holidays(value) WHERE holidays.value=calendar_day) THEN RETURN false; END IF;
 RETURN to_char(local_time,'HH24:MI')>=start_clock AND to_char(local_time,'HH24:MI')<end_clock;
EXCEPTION WHEN OTHERS THEN
 -- A malformed company's settings must not abort the other companies' queue.
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.list_web_push_candidates(p_limit integer DEFAULT 40,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH companies AS MATERIALIZED (
  SELECT DISTINCT company_id FROM public.web_push_subscriptions
 ), open_companies AS MATERIALIZED (
  SELECT company_id FROM companies WHERE public.web_push_business_hours_open(company_id,now())
 )
 SELECT coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) FROM (
  SELECT waiting.* FROM open_companies
  JOIN public.web_push_subscriptions subscription USING(company_id)
  CROSS JOIN LATERAL public.web_push_waiting(subscription.id) waiting
  LEFT JOIN public.web_push_cooldowns cooldown ON cooldown.company_id=subscription.company_id
   AND cooldown.broker_id=subscription.broker_id AND cooldown.endpoint_hash=subscription.endpoint_hash AND cooldown.lead_id=waiting.lead_id
  WHERE public.web_push_retry_due(cooldown.last_attempt_at,now())
  ORDER BY cooldown.last_attempt_at NULLS FIRST,waiting.waiting_since,waiting.subscription_id,waiting.lead_id
  LIMIT greatest(1,least(p_limit,100)) OFFSET greatest(0,least(coalesce(p_offset,0),10000))
 ) candidate;
$$;

CREATE OR REPLACE FUNCTION public.urgent_alert_policy_version()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT 3; $$;
REVOKE ALL ON FUNCTION public.web_push_business_hours_open(uuid,timestamptz),public.list_web_push_candidates(integer,integer),public.urgent_alert_policy_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_push_business_hours_open(uuid,timestamptz),public.list_web_push_candidates(integer,integer),public.urgent_alert_policy_version() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
