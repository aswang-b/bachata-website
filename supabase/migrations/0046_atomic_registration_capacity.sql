-- Run this in the Supabase SQL editor after 0001-0045, BEFORE deploying the
-- code that calls register_submission (the public registration form). Safe to
-- re-run, and the code already deployed keeps working once it has run.
--
-- 1. register_submission saves a sign-up and its class registrations in one
--    transaction and enforces capacity there, on the rows actually saved. The
--    app used to check the cached counts first and insert afterwards, so two
--    people could both take the last spot, and the check looked at what the
--    browser sent rather than what got saved (a bogus Drop-In date, a class
--    picked by title alone, or a role spelled "LEADER" all got past it).
-- 2. Spot recounts take their per-series locks in one fixed (sorted) order,
--    once per statement instead of once per row, so two sign-ups for the same
--    classes in a different order can no longer deadlock each other.
-- 3. A recount finds a series' events by index instead of scanning every
--    event (events.id::text = key could not use the primary key).
-- 4. Deleting a dancer checks that the dancer is still there before deciding
--    to delete the whole sign-up, so a repeated delete (two admin tabs) can't
--    bin the other dancer with it.

create index if not exists events_google_recurring_event_id_idx on events (google_recurring_event_id);

create or replace function refresh_series_spot_counts(p_key text) returns void
language plpgsql as $$
declare
  -- A standalone event's key is its id; matching on the uuid lets the
  -- primary key find it.
  v_id uuid := case when p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_key::uuid end;
begin
  -- Held until commit (see 0043).
  perform pg_advisory_xact_lock(hashtext('series_spot_counts:' || p_key));

  insert into event_spot_counts (event_id, taken, leaders_taken, followers_taken)
  select e.id, c.taken, c.leaders, c.followers
  from events e
  cross join lateral (
    select
      count(distinct p.person) as taken,
      count(distinct p.person) filter (where p.role = 'leader') as leaders,
      count(distinct p.person) filter (where p.role = 'follower') as followers
    from (
      select
        lower(regexp_replace(r.first_name, '\s+', '', 'g')) || ' ' || lower(regexp_replace(r.last_name, '\s+', '', 'g')) as person,
        case
          when r.dancer_index is not null and jsonb_typeof(s.dancers) = 'array'
          then lower(s.dancers -> r.dancer_index ->> 'role')
        end as role
      from class_registrations r
      left join intake_submissions s on s.id = r.submission_id
      where r.series_key = p_key
        and r.deleted_at is null
        and (not r.is_drop_in or r.occurrence_event_id = e.id)
    ) p
  ) c
  where e.google_recurring_event_id = p_key or e.id = v_id
  on conflict (event_id) do update
    set taken = excluded.taken,
        leaders_taken = excluded.leaders_taken,
        followers_taken = excluded.followers_taken;
end;
$$;

-- Takes the recount locks of several series, always in the same order.
create or replace function lock_series_spot_counts(p_keys text[]) returns void
language plpgsql as $$
declare
  k text;
begin
  for k in select distinct x from unnest(p_keys) x where x is not null order by 1 loop
    perform pg_advisory_xact_lock(hashtext('series_spot_counts:' || k));
  end loop;
end;
$$;

-- Recounts several series, locking them in order first.
create or replace function refresh_spot_counts_for(p_keys text[]) returns void
language plpgsql as $$
declare
  k text;
begin
  perform lock_series_spot_counts(p_keys);
  for k in select distinct x from unnest(p_keys) x where x is not null order by 1 loop
    perform refresh_series_spot_counts(k);
  end loop;
end;
$$;

-- One recount per series a statement touched (it used to be one per row, in
-- row order). A trigger with transition tables handles a single event, so
-- insert, update and delete each get their own.
create or replace function class_registrations_spots_insert() returns trigger
language plpgsql as $$
begin
  perform refresh_spot_counts_for(array(select series_key from new_rows));
  return null;
end;
$$;

create or replace function class_registrations_spots_update() returns trigger
language plpgsql as $$
begin
  perform refresh_spot_counts_for(array(select series_key from old_rows union select series_key from new_rows));
  return null;
end;
$$;

create or replace function class_registrations_spots_delete() returns trigger
language plpgsql as $$
begin
  perform refresh_spot_counts_for(array(select series_key from old_rows));
  return null;
end;
$$;

drop trigger if exists class_registrations_refresh_spots on class_registrations;
drop trigger if exists class_registrations_spots_insert on class_registrations;
drop trigger if exists class_registrations_spots_update on class_registrations;
drop trigger if exists class_registrations_spots_delete on class_registrations;
create trigger class_registrations_spots_insert
  after insert on class_registrations
  referencing new table as new_rows
  for each statement execute function class_registrations_spots_insert();
create trigger class_registrations_spots_update
  after update on class_registrations
  referencing old table as old_rows new table as new_rows
  for each statement execute function class_registrations_spots_update();
create trigger class_registrations_spots_delete
  after delete on class_registrations
  referencing old table as old_rows
  for each statement execute function class_registrations_spots_delete();
drop function if exists class_registrations_refresh_spots();

-- A new occurrence starts with its series' Whole Series sign-ups counted.
create or replace function events_spots_insert() returns trigger
language plpgsql as $$
begin
  perform refresh_spot_counts_for(array(select coalesce(google_recurring_event_id, id::text) from new_rows));
  return null;
end;
$$;

drop trigger if exists events_refresh_spots on events;
drop trigger if exists events_spots_insert on events;
create trigger events_spots_insert
  after insert on events
  referencing new table as new_rows
  for each statement execute function events_spots_insert();
drop function if exists events_refresh_spots();

-- A dancer's role changing recounts every class on that sign-up, in order.
create or replace function intake_submissions_refresh_spots() returns trigger
language plpgsql as $$
begin
  perform refresh_spot_counts_for(array(select series_key from class_registrations where submission_id = new.id));
  return null;
end;
$$;

-- Saves a public sign-up (p_submission: intake_submissions columns) and its
-- class registrations (p_rows: class_registrations columns, without
-- submission_id) together, or neither. Refuses, with SQLSTATE P0001 and
-- message 'capacity_exceeded', when the new rows would take an upcoming class
-- past its capacity (per role when capped by role). DETAIL is JSON:
-- {"title", "role" ('' for the general cap), "remaining"} from before this
-- sign-up. Someone already counted in a class (same name) doesn't take a
-- second spot, so re-registering when it's full still goes through.
-- Returns the new sign-up's id.
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
    series_key, series_mode, price, price_tier, occurrence_event_id, is_drop_in
  )
  select
    v_submission_id, dancer_index, first_name, last_name, email, phone, class_title, class_label,
    series_key, series_mode, price, price_tier, occurrence_event_id, coalesce(is_drop_in, false)
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
    and e.start_time >= now()
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

-- Same as 0040, but a dancer that's gone (already deleted, or never there) is
-- "not found" before anything else: the "last dancer left, delete the whole
-- sign-up" rule only applies to a dancer that's actually still on it.
create or replace function soft_delete_dancer(p_submission_id uuid, p_dancer_index int, p_deleted_by text)
returns void
language plpgsql
as $$
declare
  v_dancers jsonb;
  v_live int;
  v_at timestamptz := now();
  v_deletion_id uuid := gen_random_uuid();
begin
  select dancers into v_dancers
  from intake_submissions
  where id = p_submission_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Sign-up not found.' using errcode = 'P0002';
  end if;

  if p_dancer_index is not null and jsonb_typeof(v_dancers) = 'array'
     and (p_dancer_index < 0 or p_dancer_index >= jsonb_array_length(v_dancers)
          or coalesce((v_dancers -> p_dancer_index ->> 'deleted')::boolean, false)) then
    raise exception 'Dancer not found.' using errcode = 'P0002';
  end if;

  if jsonb_typeof(v_dancers) = 'array' then
    select count(*) into v_live from jsonb_array_elements(v_dancers) d where not coalesce((d ->> 'deleted')::boolean, false);
  else
    v_live := 0;
  end if;

  if p_dancer_index is null or jsonb_typeof(v_dancers) is distinct from 'array' or v_live <= 1 then
    update intake_submissions
    set deleted_at = v_at, deleted_by = p_deleted_by, deletion_id = v_deletion_id
    where id = p_submission_id;
    update class_registrations
    set deleted_at = v_at, deleted_by = p_deleted_by, deletion_id = v_deletion_id
    where submission_id = p_submission_id and deleted_at is null;
    return;
  end if;

  update intake_submissions
  set dancers = jsonb_set(v_dancers, array[p_dancer_index::text], bin_mark_dancer(v_dancers -> p_dancer_index, v_at, p_deleted_by, v_deletion_id))
  where id = p_submission_id;
  update class_registrations
  set deleted_at = v_at, deleted_by = p_deleted_by, deletion_id = v_deletion_id
  where submission_id = p_submission_id and dancer_index = p_dancer_index and deleted_at is null;
end;
$$;

-- Server only, like 0040's functions.
revoke all on function refresh_series_spot_counts(text) from public, anon, authenticated;
revoke all on function lock_series_spot_counts(text[]) from public, anon, authenticated;
revoke all on function refresh_spot_counts_for(text[]) from public, anon, authenticated;
revoke all on function class_registrations_spots_insert() from public, anon, authenticated;
revoke all on function class_registrations_spots_update() from public, anon, authenticated;
revoke all on function class_registrations_spots_delete() from public, anon, authenticated;
revoke all on function events_spots_insert() from public, anon, authenticated;
revoke all on function intake_submissions_refresh_spots() from public, anon, authenticated;
revoke all on function register_submission(jsonb, jsonb) from public, anon, authenticated;
revoke all on function soft_delete_dancer(uuid, int, text) from public, anon, authenticated;
grant execute on function refresh_series_spot_counts(text) to service_role;
grant execute on function register_submission(jsonb, jsonb) to service_role;
grant execute on function soft_delete_dancer(uuid, int, text) to service_role;
