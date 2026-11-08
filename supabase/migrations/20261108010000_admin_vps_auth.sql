create or replace function public.get_admin_dashboard_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_today_start timestamptz := date_trunc('day', now());
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and (auth.uid() is null or not (select public.is_driver_reviewer())) then
    raise exception 'Only an authorized Sawaari admin can view dashboard data';
  end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'pending_applications', (
        select count(*) from public.driver_applications a where a.status = 'pending'
      ),
      'approved_drivers', (
        select count(*) from public.driver_applications a where a.status = 'approved'
      ),
      'online_drivers', (
        select count(*) from public.driver_presence dp
        where dp.is_online and dp.updated_at > v_now - interval '90 seconds'
      ),
      'searching_rides', (
        select count(*) from public.ride_requests rr where rr.status = 'searching'
      ),
      'active_rides', (
        select count(*) from public.ride_requests rr where rr.status = 'accepted'
      ),
      'completed_today', (
        select count(*) from public.ride_requests rr
        where rr.status = 'completed' and rr.updated_at >= v_today_start
      )
    ),
    'drivers', coalesce((
      select jsonb_agg(to_jsonb(driver_rows) order by driver_rows.last_seen_at desc)
      from (
        select dp.user_id as driver_id,
          coalesce(p.display_name, '') as driver_name,
          dp.vehicle,
          dp.updated_at as last_seen_at
        from public.driver_presence dp
        join public.profiles p on p.id = dp.user_id
        where dp.is_online and dp.updated_at > v_now - interval '90 seconds'
        order by dp.updated_at desc
        limit 100
      ) as driver_rows
    ), '[]'::jsonb),
    'rides', coalesce((
      select jsonb_agg(to_jsonb(ride_rows) order by ride_rows.updated_at desc)
      from (
        select rr.id as request_id,
          rr.status,
          coalesce(rider.display_name, '') as rider_name,
          coalesce(driver.display_name, '') as driver_name,
          rr.pickup_address,
          rr.destination_address,
          rr.vehicle,
          rr.offered_fare,
          rr.created_at,
          rr.updated_at
        from public.ride_requests rr
        join public.profiles rider on rider.id = rr.rider_id
        left join public.profiles driver on driver.id = rr.driver_id
        where rr.status in ('searching', 'accepted')
        order by rr.updated_at desc
        limit 100
      ) as ride_rows
    ), '[]'::jsonb)
  );
end;
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
  if coalesce(auth.role(), '') <> 'service_role'
    and not (select public.is_driver_reviewer()) then
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

create or replace function public.review_driver_application_for_vps(
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
  if coalesce(auth.role(), '') <> 'service_role'
    and (v_user_id is null or not (select public.is_driver_reviewer())) then
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

revoke execute on function public.get_admin_dashboard_data() from public, anon;
revoke execute on function public.get_driver_review_queue() from public, anon;
revoke execute on function public.review_driver_application_for_vps(uuid, text, text) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_data() to authenticated, service_role;
grant execute on function public.get_driver_review_queue() to authenticated, service_role;
grant execute on function public.review_driver_application_for_vps(uuid, text, text) to service_role;
