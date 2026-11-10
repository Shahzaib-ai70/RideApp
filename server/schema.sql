create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null default '',
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_users_display_name_length check (char_length(display_name) <= 80)
);

create table if not exists email_verification_tokens (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_expiry_idx
  on email_verification_tokens (expires_at);

create table if not exists email_send_limits (
  email text primary key,
  window_started_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists email_send_limits_updated_idx on email_send_limits (updated_at);

create table if not exists user_sessions (
  token_hash text primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists user_sessions_user_idx on user_sessions (user_id);
create index if not exists user_sessions_expiry_idx on user_sessions (expires_at);

create table if not exists driver_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references app_users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  vehicle_type text not null check (vehicle_type in ('Bike', 'Rickshaw', 'Car', 'Premium')),
  vehicle_make text not null check (char_length(vehicle_make) between 1 and 80),
  vehicle_model text not null check (char_length(vehicle_model) between 1 and 80),
  vehicle_year integer not null check (vehicle_year between 1980 and 2100),
  documents jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'needs_changes', 'rejected')),
  review_note text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists driver_applications_status_idx
  on driver_applications (status, submitted_at desc);

create table if not exists driver_presence (
  user_id uuid primary key references app_users(id) on delete cascade,
  vehicle text not null check (vehicle in ('Bike', 'Rickshaw', 'Car', 'Premium')),
  is_online boolean not null default false,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  updated_at timestamptz not null default now()
);

create index if not exists driver_presence_online_idx
  on driver_presence (vehicle, updated_at desc) where is_online;

create table if not exists ride_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references app_users(id) on delete cascade,
  driver_id uuid references app_users(id) on delete set null,
  pickup_address text not null check (char_length(pickup_address) between 1 and 300),
  destination_address text not null check (char_length(destination_address) between 1 and 300),
  pickup_latitude double precision not null check (pickup_latitude between -90 and 90),
  pickup_longitude double precision not null check (pickup_longitude between -180 and 180),
  destination_latitude double precision not null check (destination_latitude between -90 and 90),
  destination_longitude double precision not null check (destination_longitude between -180 and 180),
  vehicle text not null check (vehicle in ('Bike', 'Rickshaw', 'Car', 'Premium')),
  offered_fare integer not null check (offered_fare between 1 and 1000000),
  cash_collected boolean not null default false,
  status text not null default 'searching'
    check (status in ('searching', 'accepted', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table ride_requests
  add column if not exists cash_collected boolean not null default false;

alter table ride_requests
  add column if not exists driver_offer_id uuid references app_users(id) on delete set null,
  add column if not exists driver_offer_fare integer,
  add column if not exists driver_offer_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ride_requests_driver_offer_fare_check'
  ) then
    alter table ride_requests
      add constraint ride_requests_driver_offer_fare_check
      check (driver_offer_fare is null or driver_offer_fare between 1 and 1000000);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ride_requests_driver_offer_status_check'
  ) then
    alter table ride_requests
      add constraint ride_requests_driver_offer_status_check
      check (driver_offer_status is null or driver_offer_status in ('pending', 'rejected', 'accepted'));
  end if;
end $$;

create index if not exists ride_requests_searching_idx
  on ride_requests (vehicle, created_at desc) where status = 'searching';
create index if not exists ride_requests_rider_idx
  on ride_requests (rider_id, created_at desc);
create index if not exists ride_requests_driver_idx
  on ride_requests (driver_id, updated_at desc) where driver_id is not null;

create index if not exists app_users_email_idx on app_users (lower(email));
