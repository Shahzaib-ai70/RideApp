create index if not exists driver_applications_status_idx
  on public.driver_applications (status);

create index if not exists driver_presence_online_updated_idx
  on public.driver_presence (updated_at desc)
  where is_online;

create index if not exists ride_requests_active_status_idx
  on public.ride_requests (status)
  where status in ('searching', 'accepted');

create index if not exists ride_requests_completed_updated_idx
  on public.ride_requests (updated_at desc)
  where status = 'completed';

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
  if auth.uid() is null or not (select public.is_driver_reviewer()) then
    raise exception 'Only an authorized Sawaari admin can view dashboard data';
  end if;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'pending_applications', (
        select count(*) from public.driver_applications a
        where a.status = 'pending'
      ),
      'approved_drivers', (
        select count(*) from public.driver_applications a
        where a.status = 'approved'
      ),
      'online_drivers', (
        select count(*) from public.driver_presence dp
        where dp.is_online and dp.updated_at > v_now - interval '90 seconds'
      ),
      'searching_rides', (
        select count(*) from public.ride_requests rr
        where rr.status = 'searching'
      ),
      'active_rides', (
        select count(*) from public.ride_requests rr
        where rr.status = 'accepted'
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

revoke execute on function public.get_admin_dashboard_data() from public, anon;
grant execute on function public.get_admin_dashboard_data() to authenticated;
