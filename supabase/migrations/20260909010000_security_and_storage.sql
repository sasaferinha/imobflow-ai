-- ImobFlow production hardening: persistent rate limits and property image storage.

create table if not exists public.api_rate_limits (
  bucket text not null,
  identifier_hash text not null,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, identifier_hash)
);

alter table public.api_rate_limits enable row level security;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_identifier_hash text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_hits integer;
begin
  if length(p_bucket) not between 1 and 80
     or length(p_identifier_hash) not between 16 and 128
     or p_window_seconds not between 10 and 86400
     or p_limit not between 1 and 10000 then
    return false;
  end if;

  insert into public.api_rate_limits (bucket, identifier_hash, window_started_at, hits)
  values (p_bucket, p_identifier_hash, now(), 1)
  on conflict (bucket, identifier_hash) do update
  set window_started_at = case
        when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then now()
        else public.api_rate_limits.window_started_at
      end,
      hits = case
        when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then 1
        else public.api_rate_limits.hits + 1
      end
  returning hits into current_hits;

  return current_hits <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-images',
  'property-images',
  true,
  800000,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Align message values used by the application while preserving legacy rows.
alter table public.messages drop constraint if exists messages_direction_check;
alter table public.messages add constraint messages_direction_check
  check (direction in ('incoming', 'outgoing', 'Entrada', 'Saída'));

alter table public.messages drop constraint if exists messages_sender_type_check;
alter table public.messages add constraint messages_sender_type_check
  check (sender_type in ('client', 'ai', 'human', 'Cliente', 'Agente de IA', 'Corretor'));

alter table public.leads drop constraint if exists leads_temperature_check;
alter table public.leads add constraint leads_temperature_check
  check (temperature in ('Frio', 'Morno', 'Quente', 'Muito quente'));
