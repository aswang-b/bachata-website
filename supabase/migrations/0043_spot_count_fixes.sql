-- Run this in the Supabase SQL editor after 0001-0042. Safe to re-run: run it
-- once before deploying the capacity code and again right after, so sign-ups
-- the old code saved in between get their series too.
--
-- 1. Backfills class_registrations.series_key for sign-ups saved since 0039
--    by code that didn't set it (those never counted toward capacity), and
--    also places sign-ups whose title is shared by several series when only
--    one of them was still running when they signed up.
-- 2. Serializes spot recounts per series, so two sign-ups committing at the
--    same moment can't each count without the other and leave the cache one
--    short.
-- 3. Treats any whitespace in a name as insignificant when counting people
--    ("Mary Ann" and "MaryAnn" are one person), as 0039's comment intended.
-- 4. Refuses to restore a dancer or class whose sign-up (or dancer) is itself
--    still in the Recycling Bin, which used to bring back live classes under
--    a deleted sign-up.
-- 5. Locks 0039's functions down to the server like 0040's.

create or replace function refresh_series_spot_counts(p_key text) returns void
language plpgsql as $$
begin
  -- Held until commit. Each statement below then reads a fresh snapshot, so
  -- it sees the sign-up of any concurrent transaction that held this lock.
  perform pg_advisory_xact_lock(hashtext('series_spot_counts:' || p_key));

  insert into event_spot_counts (event_id, taken)
  select e.id, (
    select count(distinct lower(regexp_replace(r.first_name, '\s+', '', 'g')) || ' ' || lower(regexp_replace(r.last_name, '\s+', '', 'g')))
    from class_registrations r
    where r.series_key = p_key
      and r.deleted_at is null
      and (not r.is_drop_in or r.occurrence_event_id = e.id)
  )
  from events e
  where e.google_recurring_event_id = p_key or e.id::text = p_key
  on conflict (event_id) do update set taken = excluded.taken;
end;
$$;

-- Same backfill as 0039, for rows saved since.
update class_registrations r
set series_key = coalesce(e.google_recurring_event_id, e.id::text)
from events e
where r.series_key is null
  and r.occurrence_event_id = e.id;

update class_registrations r
set series_key = k.key
from (
  select title, min(coalesce(google_recurring_event_id, id::text)) as key
  from events
  group by title
  having count(distinct coalesce(google_recurring_event_id, id::text)) = 1
) k
where r.series_key is null
  and r.class_title = k.title;

-- A title several series share: the one series of that title that still had
-- a class on or after the sign-up date.
update class_registrations r
set series_key = m.key
from (
  select r2.id, min(coalesce(e.google_recurring_event_id, e.id::text)) as key
  from class_registrations r2
  join events e on e.title = r2.class_title and e.end_time >= r2.created_at
  where r2.series_key is null
  group by r2.id
  having count(distinct coalesce(e.google_recurring_event_id, e.id::text)) = 1
) m
where r.id = m.id
  and r.series_key is null;

-- Recount every series (the name rule changed, so not just the backfilled ones).
select refresh_series_spot_counts(k)
from (select distinct series_key as k from class_registrations where series_key is not null) s;

create or replace function restore_deletion(p_deletion_id uuid)
returns void
language plpgsql
as $$
begin
  -- A dancer (or class) deleted before its whole sign-up was: restoring it
  -- alone would leave live classes under a sign-up that's still in the bin.
  if exists (
    select 1 from intake_submissions s
    where s.deleted_at is not null
      and s.deletion_id is distinct from p_deletion_id
      and s.dancers @> jsonb_build_array(jsonb_build_object('deletionId', p_deletion_id::text))
  ) or exists (
    select 1 from class_registrations r
    join intake_submissions s on s.id = r.submission_id
    where r.deletion_id = p_deletion_id
      and s.deleted_at is not null
      and s.deletion_id is distinct from p_deletion_id
  ) then
    raise exception 'Restore the whole sign-up first: it is also in the Recycling Bin.' using errcode = 'P0001';
  end if;

  -- Likewise a class deleted before its dancer was.
  if exists (
    select 1 from class_registrations r
    join intake_submissions s on s.id = r.submission_id
    where r.deletion_id = p_deletion_id
      and r.dancer_index is not null
      and jsonb_typeof(s.dancers) = 'array'
      and coalesce((s.dancers -> r.dancer_index ->> 'deleted')::boolean, false)
      and (s.dancers -> r.dancer_index ->> 'deletionId') is distinct from p_deletion_id::text
  ) then
    raise exception 'Restore the dancer first: they are also in the Recycling Bin.' using errcode = 'P0001';
  end if;

  update intake_submissions set deleted_at = null, deleted_by = null, deletion_id = null where deletion_id = p_deletion_id;
  update class_registrations set deleted_at = null, deleted_by = null, deletion_id = null where deletion_id = p_deletion_id;
  update class_checkins set deleted_at = null, deleted_by = null, deletion_id = null where deletion_id = p_deletion_id;

  -- One statement, so each sign-up row is locked and re-read before its
  -- dancers list is rewritten.
  update intake_submissions s
  set dancers = (
    select jsonb_agg(
      case when d ->> 'deletionId' = p_deletion_id::text then d - 'deleted' - 'deletedAt' - 'deletedBy' - 'deletionId' else d end
      order by ord
    )
    from jsonb_array_elements(s.dancers) with ordinality t(d, ord)
  )
  where s.dancers @> jsonb_build_array(jsonb_build_object('deletionId', p_deletion_id::text));
end;
$$;

revoke all on function refresh_series_spot_counts(text) from public, anon, authenticated;
revoke all on function class_registrations_refresh_spots() from public, anon, authenticated;
revoke all on function events_refresh_spots() from public, anon, authenticated;
revoke all on function restore_deletion(uuid) from public, anon, authenticated;
grant execute on function refresh_series_spot_counts(text) to service_role;
grant execute on function restore_deletion(uuid) to service_role;
