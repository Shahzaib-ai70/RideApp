create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 80)
);

create table if not exists public.driver_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  vehicle text not null check (vehicle in ('Bike', 'Rickshaw', 'Car', 'Premium')),
  is_online boolean not null default false,
  location extensions.geography(point, 4326) not null,
  updated_at timestamptz not null default now()
);

create index if not exists driver_presence_location_idx
  on public.driver_presence using gist (location);

create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.profiles(id) on delete set null,
  pickup_address text not null,
  destination_address text not null,
  pickup_location extensions.geography(point, 4326) not null,
  destination_location extensions.geography(point, 4326) not null,
  vehicle text not null check (vehicle in ('Bike', 'Rickshaw', 'Car', 'Premium')),
  offered_fare integer not null check (offered_fare between 1 and 1000000),
  status text not null default 'searching'
    check (status in ('searching', 'accepted', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ride_requests_pickup_location_idx
  on public.ride_requests using gist (pickup_location);
create index if not exists ride_requests_searching_created_idx
  on public.ride_requests (created_at desc) where status = 'searching';

alter table public.profiles enable row level security;
alter table public.driver_presence enable row level security;
alter table public.ride_requests enable row level security;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile"
  on public.profiles for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
  on public.profiles for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users read their own rides" on public.ride_requests;
create policy "Users read their own rides"
  on public.ride_requests for select to authenticated using ((select auth.uid()) = rider_id);

revoke all on public.driver_presence from anon, authenticated;
revoke all on public.ride_requests from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.ride_requests to authenticated;

create or replace function public.handle_new_sawaari_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sawaari on auth.users;
create trigger on_auth_user_created_sawaari
  after insert on auth.users
  for each row execute function public.handle_new_sawaari_user();

create or replace function public.set_driver_presence(
  p_display_name text,
  p_vehicle text,
  p_is_online boolean,
  p_latitude double precision,
  p_longitude double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Sign in before enabling driver mode'; end if;
  if p_vehicle not in ('Bike', 'Rickshaw', 'Car', 'Premium') then
    raise exception 'Select a supported vehicle';
  end if;
  if p_is_online and (
    p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
  ) then raise exception 'A valid live location is required to go online'; end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, left(trim(coalesce(p_display_name, '')), 80))
  on conflict (id) do update
    set display_name = excluded.display_name;

  insert into public.driver_presence (user_id, vehicle, is_online, location, updated_at)
  values (
    v_user_id,
    p_vehicle,
    p_is_online,
    extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography,
    now()
  )
  on conflict (user_id) do update set
    vehicle = excluded.vehicle,
    is_online = excluded.is_online,
    location = excluded.location,
    updated_at = now();
end;
$$;

create or replace function public.create_ride_request(
  p_pickup_address text,
  p_destination_address text,
  p_pickup_latitude double precision,
  p_pickup_longitude double precision,
  p_destination_latitude double precision,
  p_destination_longitude double precision,
  p_vehicle text,
  p_offered_fare integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before requesting a live ride'; end if;
  if p_vehicle not in ('Bike', 'Rickshaw', 'Car', 'Premium') then
    raise exception 'Select a supported vehicle';
  end if;
  if p_pickup_latitude not between -90 and 90 or p_destination_latitude not between -90 and 90
    or p_pickup_longitude not between -180 and 180 or p_destination_longitude not between -180 and 180
  then raise exception 'The selected coordinates are invalid'; end if;
  if p_offered_fare not between 1 and 1000000 then raise exception 'The fare offer is invalid'; end if;

  insert into public.ride_requests (
    rider_id, pickup_address, destination_address, pickup_location, destination_location,
    vehicle, offered_fare
  )
  values (
    v_user_id, left(trim(p_pickup_address), 300), left(trim(p_destination_address), 300),
    extensions.st_setsrid(extensions.st_makepoint(p_pickup_longitude, p_pickup_latitude), 4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(p_destination_longitude, p_destination_latitude), 4326)::extensions.geography,
    p_vehicle, p_offered_fare
  )
  returning id into v_ride_id;
  return v_ride_id;
end;
$$;

create or replace function public.get_nearby_drivers(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_m integer default 5000
)
returns table (
  driver_id uuid,
  driver_name text,
  vehicle text,
  distance_m double precision,
  latitude double precision,
  longitude double precision,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select dp.user_id, p.display_name, dp.vehicle,
    extensions.st_distance(dp.location, origin.location),
    extensions.st_y(dp.location::extensions.geometry),
    extensions.st_x(dp.location::extensions.geometry),
    dp.updated_at
  from public.driver_presence dp
  join public.profiles p on p.id = dp.user_id
  cross join (
    select extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography as location
  ) origin
  where dp.is_online
    and dp.user_id <> (select auth.uid())
    and dp.updated_at > now() - interval '90 seconds'
    and extensions.st_dwithin(dp.location, origin.location, least(greatest(p_radius_m, 500), 10000))
    and exists (
      select 1 from public.ride_requests rr
      where rr.rider_id = (select auth.uid())
        and rr.status = 'searching'
        and rr.vehicle = dp.vehicle
        and extensions.st_dwithin(rr.pickup_location, origin.location, 100)
    )
  order by extensions.st_distance(dp.location, origin.location)
  limit 20;
$$;

create or replace function public.get_nearby_ride_requests(p_radius_m integer default 5000)
returns table (
  request_id uuid,
  rider_name text,
  pickup_address text,
  destination_address text,
  vehicle text,
  offered_fare integer,
  distance_m double precision,
  pickup_latitude double precision,
  pickup_longitude double precision,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select rr.id, p.display_name, rr.pickup_address, rr.destination_address,
    rr.vehicle, rr.offered_fare,
    extensions.st_distance(dp.location, rr.pickup_location),
    extensions.st_y(rr.pickup_location::extensions.geometry),
    extensions.st_x(rr.pickup_location::extensions.geometry),
    rr.created_at
  from public.ride_requests rr
  join public.driver_presence dp on dp.user_id = (select auth.uid())
  join public.profiles p on p.id = rr.rider_id
  where dp.is_online
    and dp.updated_at > now() - interval '90 seconds'
    and rr.status = 'searching'
    and rr.vehicle = dp.vehicle
    and rr.rider_id <> (select auth.uid())
    and extensions.st_dwithin(
      dp.location,
      rr.pickup_location,
      least(greatest(p_radius_m, 500), 20000)
    )
  order by extensions.st_distance(dp.location, rr.pickup_location), rr.created_at;
$$;

create or replace function public.accept_ride_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ride_id uuid;
begin
  if v_user_id is null then raise exception 'Sign in before accepting a ride'; end if;
  if not exists (
    select 1 from public.driver_presence dp
    where dp.user_id = v_user_id and dp.is_online
      and dp.updated_at > now() - interval '90 seconds'
  ) then raise exception 'Go online with location enabled before accepting a ride'; end if;

  update public.ride_requests rr set
    status = 'accepted',
    driver_id = v_user_id,
    updated_at = now()
  where rr.id = p_request_id
    and rr.status = 'searching'
    and rr.vehicle = (
      select dp.vehicle from public.driver_presence dp where dp.user_id = v_user_id
    )
    and extensions.st_dwithin(
      rr.pickup_location,
      (select dp.location from public.driver_presence dp where dp.user_id = v_user_id),
      20000
    )
  returning rr.id into v_ride_id;

  if v_ride_id is null then
    raise exception 'This request is no longer available or is outside your service area';
  end if;

  update public.driver_presence set is_online = false, updated_at = now()
  where user_id = v_user_id;
  return v_ride_id;
end;
$$;

create or replace function public.get_my_ride_status(p_request_id uuid)
returns table (status text, driver_name text, driver_vehicle text)
language sql
stable
security definer
set search_path = ''
as $$
  select rr.status, coalesce(p.display_name, ''), coalesce(dp.vehicle, '')
  from public.ride_requests rr
  left join public.profiles p on p.id = rr.driver_id
  left join public.driver_presence dp on dp.user_id = rr.driver_id
  where rr.id = p_request_id and rr.rider_id = (select auth.uid());
$$;

create or replace function public.cancel_ride_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  update public.ride_requests set status = 'cancelled', updated_at = now()
  where id = p_request_id
    and rider_id = (select auth.uid())
    and status = 'searching'
  returning id into v_updated_id;
  if v_updated_id is null then raise exception 'This request is no longer available to cancel'; end if;
end;
$$;

create or replace function public.complete_ride_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  update public.ride_requests set status = 'completed', updated_at = now()
  where id = p_request_id
    and driver_id = (select auth.uid())
    and status = 'accepted'
  returning id into v_updated_id;
  if v_updated_id is null then raise exception 'This accepted ride could not be completed'; end if;
end;
$$;

create or replace function public.get_my_active_driver_ride()
returns table (
  request_id uuid,
  rider_name text,
  pickup_address text,
  destination_address text,
  vehicle text,
  offered_fare integer,
  distance_m double precision,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select rr.id, p.display_name, rr.pickup_address, rr.destination_address,
    rr.vehicle, rr.offered_fare, 0::double precision, rr.created_at
  from public.ride_requests rr
  join public.profiles p on p.id = rr.rider_id
  where rr.driver_id = (select auth.uid()) and rr.status = 'accepted'
  order by rr.updated_at desc
  limit 1;
$$;

revoke execute on function public.set_driver_presence(text, text, boolean, double precision, double precision) from public, anon;
revoke execute on function public.create_ride_request(text, text, double precision, double precision, double precision, double precision, text, integer) from public, anon;
revoke execute on function public.get_nearby_drivers(double precision, double precision, integer) from public, anon;
revoke execute on function public.get_nearby_ride_requests(integer) from public, anon;
revoke execute on function public.accept_ride_request(uuid) from public, anon;
revoke execute on function public.get_my_ride_status(uuid) from public, anon;
revoke execute on function public.cancel_ride_request(uuid) from public, anon;
revoke execute on function public.complete_ride_request(uuid) from public, anon;
revoke execute on function public.get_my_active_driver_ride() from public, anon;
grant execute on function public.set_driver_presence(text, text, boolean, double precision, double precision) to authenticated;
grant execute on function public.create_ride_request(text, text, double precision, double precision, double precision, double precision, text, integer) to authenticated;
grant execute on function public.get_nearby_drivers(double precision, double precision, integer) to authenticated;
grant execute on function public.get_nearby_ride_requests(integer) to authenticated;
grant execute on function public.accept_ride_request(uuid) to authenticated;
grant execute on function public.get_my_ride_status(uuid) to authenticated;
grant execute on function public.cancel_ride_request(uuid) to authenticated;
grant execute on function public.complete_ride_request(uuid) to authenticated;
grant execute on function public.get_my_active_driver_ride() to authenticated;
