-- Run this in the Supabase SQL editor after 0001-0052, BEFORE deploying the
-- code that takes event registrations at the door. Safe to re-run.
--
-- Events take registrations until 30 minutes after they end (people sign up
-- at the door), so register_submission keeps enforcing an event's capacity
-- through that window too; classes still stop at their start. Otherwise the
-- same as 0047.

create or replace function register_submission(p_submission jsonb, p_rows jsonb) returns uuid
language plpgsql as $$
declare
  v_keys text[];
  v_ids uuid[];
  v_before jsonb;
  v_submission_id uuid;
  v_over record;
begin
  select coalesce(array_agg(distinct r ->> 'series_key'), '{}')
  into v_keys
  from jsonb_array_elements(coalesce(p_rows, '[]')) r
  where r ->> 'series_key' is not null;
  v_ids := array(
    select k::uuid from unnest(v_keys) k
    where k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

  -- No one else can change these series' counts until this commits.
  perform lock_series_spot_counts(v_keys);

  select coalesce(jsonb_object_agg(c.event_id::text, jsonb_build_array(c.taken, c.leaders_taken, c.followers_taken)), '{}')
  into v_before
  from event_spot_counts c
  join events e on e.id = c.event_id
  where e.google_recurring_event_id = any(v_keys) or e.id = any(v_ids);

  insert into intake_submissions (
    registration_type, first_name, last_name, email, phone, instagram, whatsapp,
    class, comments, dancers, payment_method, guidelines_agreed_at
  )
  select
    registration_type, first_name, last_name, email, phone, instagram, whatsapp,
    class, comments, dancers, payment_method, guidelines_agreed_at
  from jsonb_populate_record(null::intake_submissions, p_submission)
  returning id into v_submission_id;

  insert into class_registrations (
    submission_id, dancer_index, first_name, last_name, email, phone, class_title, class_label,
    series_key, series_mode, price, price_tier, occurrence_event_id, is_drop_in,
    deal_id, deal_name, deal_discount
  )
  select
    v_submission_id, dancer_index, first_name, last_name, email, phone, class_title, class_label,
    series_key, series_mode, price, price_tier, occurrence_event_id, coalesce(is_drop_in, false),
    deal_id, deal_name, deal_discount
  from jsonb_populate_recordset(null::class_registrations, coalesce(p_rows, '[]'));

  -- The insert trigger has recounted. Any upcoming class whose count went up
  -- past its cap refuses the whole sign-up.
  select e.title, o.role, greatest(o.cap - o.before, 0) as remaining
  into v_over
  from events e
  join event_spot_counts c on c.event_id = e.id
  cross join lateral (
    values
      ('', e.capacity, c.taken, coalesce((v_before -> e.id::text ->> 0)::int, 0), not e.capacity_by_role),
      ('leader', e.leader_capacity, c.leaders_taken, coalesce((v_before -> e.id::text ->> 1)::int, 0), e.capacity_by_role),
      ('follower', e.follower_capacity, c.followers_taken, coalesce((v_before -> e.id::text ->> 2)::int, 0), e.capacity_by_role)
  ) o(role, cap, now_taken, before, in_force)
  where (e.google_recurring_event_id = any(v_keys) or e.id = any(v_ids))
    -- Classes until they start; events until 30 minutes after they end (door sign-ups).
    and (e.start_time >= now() or (e.event_type = 'event' and e.end_time + interval '30 minutes' >= now()))
    and o.in_force
    and o.cap > 0
    and o.now_taken > o.cap
    and o.now_taken > o.before
  order by e.start_time, o.role
  limit 1;

  if found then
    raise exception 'capacity_exceeded'
      using errcode = 'P0001',
            detail = jsonb_build_object('title', v_over.title, 'role', v_over.role, 'remaining', v_over.remaining)::text;
  end if;

  return v_submission_id;
end;
$$;

revoke all on function register_submission(jsonb, jsonb) from public, anon, authenticated;
grant execute on function register_submission(jsonb, jsonb) to service_role;
