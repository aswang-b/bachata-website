-- Run this in the Supabase SQL editor after 0001-0047, BEFORE deploying the
-- code that ships with it. Safe to re-run.
--
-- Spot counts treated two registrations as the same person when only their
-- names matched. That let anyone get into a full class by signing up under
-- the name of a dancer already in it (register_submission saw no new spot
-- taken), and two different people with the same name shared one spot. A
-- person is now their name plus their email and phone, so a repeat sign-up
-- with the same details still takes no second spot, but a namesake does.

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
        lower(regexp_replace(r.first_name, '\s+', '', 'g')) || ' ' || lower(regexp_replace(r.last_name, '\s+', '', 'g'))
          || ' ' || lower(btrim(coalesce(r.email, '')))
          || ' ' || regexp_replace(coalesce(r.phone, ''), '\D', '', 'g') as person,
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

revoke all on function refresh_series_spot_counts(text) from public, anon, authenticated;
grant execute on function refresh_series_spot_counts(text) to service_role;

-- Recount every series under the new rule.
select refresh_series_spot_counts(k)
from (select distinct series_key as k from class_registrations where series_key is not null) s;
