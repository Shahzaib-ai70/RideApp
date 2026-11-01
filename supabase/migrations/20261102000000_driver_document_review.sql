insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sawaari-driver-documents',
  'sawaari-driver-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.driver_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.driver_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
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
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.driver_reviewers enable row level security;
alter table public.driver_applications enable row level security;

revoke all on public.driver_reviewers from public, anon, authenticated;
revoke all on public.driver_applications from public, anon, authenticated;
grant select on public.driver_applications to authenticated;

create or replace function public.is_driver_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.driver_reviewers
    where user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_driver_reviewer() from public, anon;
grant execute on function public.is_driver_reviewer() to authenticated;

drop policy if exists "Drivers read own application or reviewers read queue"
  on public.driver_applications;
create policy "Drivers read own application or reviewers read queue"
  on public.driver_applications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_driver_reviewer()));

drop policy if exists "Driver reads own private verification documents"
  on storage.objects;
create policy "Driver reads own private verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sawaari-driver-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Driver reviewers read private verification documents"
  on storage.objects;
create policy "Driver reviewers read private verification documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sawaari-driver-documents'
    and (select public.is_driver_reviewer())
  );

drop policy if exists "Drivers upload to own verification folder"
  on storage.objects;
create policy "Drivers upload to own verification folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sawaari-driver-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Drivers delete own verification files"
  on storage.objects;
create policy "Drivers delete own verification files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sawaari-driver-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create or replace function public.submit_driver_application(
  p_full_name text,
  p_vehicle_type text,
  p_vehicle_make text,
  p_vehicle_model text,
  p_vehicle_year integer,
  p_documents jsonb
)
returns table (application_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_application_id uuid;
  v_current_status text;
  v_document_count integer;
begin
  if v_user_id is null then raise exception 'Sign in before submitting driver documents'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) not between 2 and 80 then
    raise exception 'Enter your name as shown on your identification';
  end if;
  if p_vehicle_type not in ('Bike', 'Rickshaw', 'Car', 'Premium') then
    raise exception 'Select a supported vehicle type';
  end if;
  if char_length(trim(coalesce(p_vehicle_make, ''))) not between 1 and 80
    or char_length(trim(coalesce(p_vehicle_model, ''))) not between 1 and 80
    or p_vehicle_year not between 1980 and 2100
  then raise exception 'Enter valid vehicle make, model, and year'; end if;
  if jsonb_typeof(p_documents) <> 'array' then
    raise exception 'Upload all required verification documents';
  end if;

  select count(distinct item ->> 'doc_type')
  into v_document_count
  from jsonb_array_elements(p_documents) as docs(item);

  if v_document_count <> 4
    or exists (
      select required.doc_type
      from unnest(array['cnic', 'driving_license', 'vehicle_registration', 'vehicle_photo'])
        as required(doc_type)
      where not exists (
        select 1 from jsonb_array_elements(p_documents) as docs(item)
        where item ->> 'doc_type' = required.doc_type
      )
    )
  then raise exception 'Upload each of the four required document types'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_documents) as docs(item)
    where jsonb_typeof(item) <> 'object'
      or item ->> 'doc_type' not in ('cnic', 'driving_license', 'vehicle_registration', 'vehicle_photo')
      or item ->> 'path' !~ (
        '^' || v_user_id::text
        || '/[A-Za-z0-9_-]+/(cnic|driving_license|vehicle_registration|vehicle_photo)\.(pdf|jpg|jpeg|png)$'
      )
      or split_part(item ->> 'path', '/', 3) !~ (
        '^' || (item ->> 'doc_type') || '\.(pdf|jpg|jpeg|png)$'
      )
      or not (
        (item ->> 'path' ~ '\.pdf$' and item ->> 'content_type' = 'application/pdf')
        or (item ->> 'path' ~ '\.(jpg|jpeg)$' and item ->> 'content_type' = 'image/jpeg')
        or (item ->> 'path' ~ '\.png$' and item ->> 'content_type' = 'image/png')
      )
      or case
        when coalesce(item ->> 'size', '') ~ '^[0-9]{1,8}$'
          then (item ->> 'size')::bigint not between 1 and 10485760
        else true
      end
      or not exists (
        select 1 from storage.objects stored_object
        where stored_object.bucket_id = 'sawaari-driver-documents'
          and stored_object.name = item ->> 'path'
      )
  ) then raise exception 'A verification file is missing or has an invalid type'; end if;

  if (
    select count(distinct item ->> 'path')
    from jsonb_array_elements(p_documents) as docs(item)
  ) <> 4 then raise exception 'Each required document must be a separate file'; end if;

  select id, driver_applications.status
  into v_application_id, v_current_status
  from public.driver_applications
  where user_id = v_user_id
  for update;

  if v_current_status = 'pending' then
    raise exception 'Your driver application is already under review';
  elsif v_current_status = 'approved' then
    raise exception 'Your driver application has already been approved';
  elsif v_application_id is null then
    insert into public.driver_applications (
      user_id, full_name, vehicle_type, vehicle_make, vehicle_model,
      vehicle_year, documents, status
    )
    values (
      v_user_id, trim(p_full_name), p_vehicle_type, trim(p_vehicle_make),
      trim(p_vehicle_model), p_vehicle_year, p_documents, 'pending'
    )
    returning id into v_application_id;
  else
    update public.driver_applications set
      full_name = trim(p_full_name),
      vehicle_type = p_vehicle_type,
      vehicle_make = trim(p_vehicle_make),
      vehicle_model = trim(p_vehicle_model),
      vehicle_year = p_vehicle_year,
      documents = p_documents,
      status = 'pending',
      review_note = '',
      submitted_at = now(),
      reviewed_at = null,
      reviewed_by = null
    where id = v_application_id;
  end if;

  return query select v_application_id, 'pending'::text;
end;
$$;

create or replace function public.get_my_driver_application()
returns table (
  application_id uuid,
  full_name text,
  vehicle_type text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  documents jsonb,
  status text,
  review_note text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.full_name, a.vehicle_type, a.vehicle_make, a.vehicle_model,
    a.vehicle_year, a.documents, a.status, a.review_note, a.submitted_at
  from public.driver_applications a
  where a.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.get_driver_review_queue()
returns table (
  application_id uuid,
  user_id uuid,
  full_name text,
  vehicle_type text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  documents jsonb,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_driver_reviewer()) then
    raise exception 'Only an authorized reviewer can view driver applications';
  end if;

  return query
  select a.id, a.user_id, a.full_name, a.vehicle_type, a.vehicle_make,
    a.vehicle_model, a.vehicle_year, a.documents, a.submitted_at
  from public.driver_applications a
  where a.status = 'pending'
  order by a.submitted_at;
end;
$$;

create or replace function public.review_driver_application(
  p_application_id uuid,
  p_decision text,
  p_review_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated_id uuid;
begin
  if v_user_id is null or not (select public.is_driver_reviewer()) then
    raise exception 'Only an authorized reviewer can update driver applications';
  end if;
  if p_decision not in ('approved', 'needs_changes', 'rejected') then
    raise exception 'Select a valid review decision';
  end if;
  if p_decision <> 'approved' and char_length(trim(coalesce(p_review_note, ''))) < 5 then
    raise exception 'Explain what the driver needs to change';
  end if;

  update public.driver_applications set
    status = p_decision,
    review_note = left(trim(coalesce(p_review_note, '')), 1000),
    reviewed_at = now(),
    reviewed_by = v_user_id
  where id = p_application_id and status = 'pending'
  returning id into v_updated_id;

  if v_updated_id is null then
    raise exception 'This application is no longer pending review';
  end if;
end;
$$;

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
  if p_is_online and not exists (
    select 1 from public.driver_applications
    where user_id = v_user_id and status = 'approved' and vehicle_type = p_vehicle
  ) then raise exception 'Your documents must be approved for this vehicle before going online'; end if;
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
    select 1 from public.driver_applications
    where user_id = v_user_id and status = 'approved'
  ) then raise exception 'Driver verification approval is required to accept rides'; end if;
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

update public.driver_presence dp set is_online = false, updated_at = now()
where dp.is_online and not exists (
  select 1 from public.driver_applications a
  where a.user_id = dp.user_id and a.status = 'approved'
);

revoke execute on function public.submit_driver_application(text, text, text, text, integer, jsonb) from public, anon;
revoke execute on function public.get_my_driver_application() from public, anon;
revoke execute on function public.get_driver_review_queue() from public, anon;
revoke execute on function public.review_driver_application(uuid, text, text) from public, anon;
grant execute on function public.submit_driver_application(text, text, text, text, integer, jsonb) to authenticated;
grant execute on function public.get_my_driver_application() to authenticated;
grant execute on function public.get_driver_review_queue() to authenticated;
grant execute on function public.review_driver_application(uuid, text, text) to authenticated;
grant execute on function public.set_driver_presence(text, text, boolean, double precision, double precision) to authenticated;
grant execute on function public.accept_ride_request(uuid) to authenticated;
