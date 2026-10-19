-- Run this in the Supabase SQL editor after 0001-0043, BEFORE deploying the
-- code that reads these columns (the homepage, calendar, registration pages
-- and the admin editor all select them).
--
-- 1. Separate Leader/Follower caps for classes. capacity_by_role picks which
--    caps are in force: false = the general `capacity` (as before), true =
--    leader_capacity / follower_capacity (null = that role is unlimited).
--    Both sets are kept so the admin can switch back and forth.
-- 2. Leaders/followers taken per occurrence, cached next to `taken`. A
--    dancer's role lives on their sign-up (intake_submissions.dancers), so a
--    role edit there recounts too.
-- 3. Community guidelines that event registrants agree to, and when they did.

alter table events add column if not exists capacity_by_role boolean not null default false;
alter table events add column if not exists leader_capacity int check (leader_capacity is null or leader_capacity > 0);
alter table events add column if not exists follower_capacity int check (follower_capacity is null or follower_capacity > 0);

alter table event_spot_counts add column if not exists leaders_taken int not null default 0;
alter table event_spot_counts add column if not exists followers_taken int not null default 0;

create or replace function refresh_series_spot_counts(p_key text) returns void
language plpgsql as $$
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
  where e.google_recurring_event_id = p_key or e.id::text = p_key
  on conflict (event_id) do update
    set taken = excluded.taken,
        leaders_taken = excluded.leaders_taken,
        followers_taken = excluded.followers_taken;
end;
$$;

-- A dancer's role changing (admin edit) recounts every class on that sign-up.
create or replace function intake_submissions_refresh_spots() returns trigger
language plpgsql as $$
declare
  k text;
begin
  for k in
    select distinct series_key from class_registrations
    where submission_id = new.id and series_key is not null
  loop
    perform refresh_series_spot_counts(k);
  end loop;
  return null;
end;
$$;

drop trigger if exists intake_submissions_refresh_spots on intake_submissions;
create trigger intake_submissions_refresh_spots
  after update of dancers on intake_submissions
  for each row
  when (old.dancers is distinct from new.dancers)
  execute function intake_submissions_refresh_spots();

-- Fill the new role counts for every series that has sign-ups.
select refresh_series_spot_counts(k)
from (select distinct series_key as k from class_registrations where series_key is not null) s;

revoke all on function refresh_series_spot_counts(text) from public, anon, authenticated;
revoke all on function intake_submissions_refresh_spots() from public, anon, authenticated;
grant execute on function refresh_series_spot_counts(text) to service_role;

-- Single-row table, like homepage_content. Blank by default; the event
-- registration form hides the guidelines section until there's text.
create table if not exists community_guidelines (
  id boolean primary key default true check (id),
  body text not null default '',
  updated_at timestamptz not null default now()
);
alter table community_guidelines enable row level security;

-- When an event registrant ticked "I have read the community guidelines".
alter table intake_submissions add column if not exists guidelines_agreed_at timestamptz;
