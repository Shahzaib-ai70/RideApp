create or replace function public.get_admin_dashboard_summary()
returns table (
  pending_applications bigint,
  approved_drivers bigint,
  online_drivers bigint,
  searching_rides bigint,
  active_rides bigint,
  completed_today bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.is_driver_reviewer()) then
    raise exception 'Only an authorized Sawaari admin can view dashboard data';
  end if;

  return query
  select
    (select count(*) from public.driver_applications a where a.status = 'pending'),
    (select count(*) from public.driver_applications a where a.status = 'approved'),
    (select count(*) from public.driver_presence dp
      where dp.is_online and dp.updated_at > now() - interval '90 seconds'),
    (select count(*) from public.ride_requests rr where rr.status = 'searching'),
    (select count(*) from public.ride_requests rr where rr.status = 'accepted'),
    (select count(*) from public.ride_requests rr
      where rr.status = 'completed' and rr.updated_at >= date_trunc('day', now()));
end;
$$;

create or replace function public.get_admin_live_drivers()
returns table (
  driver_id uuid,
  driver_name text,
  vehicle text,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.is_driver_reviewer()) then
    raise exception 'Only an authorized Sawaari admin can view live drivers';
  end if;

  return query
  select dp.user_id, coalesce(p.display_name, ''), dp.vehicle, dp.updated_at
  from public.driver_presence dp
  join public.profiles p on p.id = dp.user_id
  where dp.is_online and dp.updated_at > now() - interval '90 seconds'
  order by dp.updated_at desc
  limit 100;
end;
$$;

create or replace function public.get_admin_live_rides()
returns table (
  request_id uuid,
  status text,
  rider_name text,
  driver_name text,
  pickup_address text,
  destination_address text,
  vehicle text,
  offered_fare integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select public.is_driver_reviewer()) then
    raise exception 'Only an authorized Sawaari admin can view active rides';
  end if;

  return query
  select rr.id, rr.status, coalesce(rider.display_name, ''),
    coalesce(driver.display_name, ''), rr.pickup_address, rr.destination_address,
    rr.vehicle, rr.offered_fare, rr.created_at, rr.updated_at
  from public.ride_requests rr
  join public.profiles rider on rider.id = rr.rider_id
  left join public.profiles driver on driver.id = rr.driver_id
  where rr.status in ('searching', 'accepted')
  order by rr.updated_at desc
  limit 100;
end;
$$;

revoke execute on function public.get_admin_dashboard_summary() from public, anon;
revoke execute on function public.get_admin_live_drivers() from public, anon;
revoke execute on function public.get_admin_live_rides() from public, anon;
grant execute on function public.get_admin_dashboard_summary() to authenticated;
grant execute on function public.get_admin_live_drivers() to authenticated;
grant execute on function public.get_admin_live_rides() to authenticated;

create table if not exists public.admin_dashboard_events (
  event_type text primary key check (
    event_type in ('driver_applications', 'driver_presence', 'ride_requests')
  ),
  updated_at timestamptz not null default now()
);

insert into public.admin_dashboard_events (event_type)
values ('driver_applications'), ('driver_presence'), ('ride_requests')
on conflict (event_type) do nothing;

alter table public.admin_dashboard_events enable row level security;
revoke all on public.admin_dashboard_events from public, anon, authenticated;
grant select on public.admin_dashboard_events to authenticated;
drop policy if exists "Sawaari admins read dashboard change signals"
  on public.admin_dashboard_events;
create policy "Sawaari admins read dashboard change signals"
  on public.admin_dashboard_events for select to authenticated
  using ((select public.is_driver_reviewer()));

create or replace function public.notify_admin_dashboard_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_dashboard_events (event_type, updated_at)
  values (tg_table_name, clock_timestamp())
  on conflict (event_type) do update
    set updated_at = excluded.updated_at;
  return null;
end;
$$;

revoke execute on function public.notify_admin_dashboard_change() from public, anon, authenticated;

drop trigger if exists notify_admin_dashboard_change
  on public.driver_applications;
create trigger notify_admin_dashboard_change
  after insert or update or delete on public.driver_applications
  for each statement execute function public.notify_admin_dashboard_change();

drop trigger if exists notify_admin_dashboard_change
  on public.driver_presence;
create trigger notify_admin_dashboard_change
  after insert or update or delete on public.driver_presence
  for each statement execute function public.notify_admin_dashboard_change();

drop trigger if exists notify_admin_dashboard_change
  on public.ride_requests;
create trigger notify_admin_dashboard_change
  after insert or update or delete on public.ride_requests
  for each statement execute function public.notify_admin_dashboard_change();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'admin_dashboard_events'
    ) then
      alter publication supabase_realtime
        add table public.admin_dashboard_events;
    end if;
  end if;
end;
$$;
