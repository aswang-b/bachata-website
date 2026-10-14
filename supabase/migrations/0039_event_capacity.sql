-- Run this in the Supabase SQL editor after 0001-0038, BEFORE deploying the
-- code that reads these columns (the homepage, calendar, and registration
-- pages all select them).
--
-- Capacity limit per class/event (stored on every occurrence of a series,
-- like its prices). Null = unlimited. show_capacity controls whether the
-- public sees "X spots remaining"; admins always see it.

alter table events add column if not exists capacity int check (capacity is null or capacity > 0);
alter table events add column if not exists show_capacity boolean not null default false;

-- The series a registration is for (`google_recurring_event_id ?? id`), so
-- spots can be counted per series even when two series share a title.
alter table class_registrations add column if not exists series_key text;
create index if not exists class_registrations_series_key_idx on class_registrations (series_key);

-- Backfill: drop-ins from the occurrence they picked, everything else from
-- its title when exactly one series has that title.
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

-- Cached spots taken per occurrence, so pages read one small row per class
-- instead of counting sign-ups on every view. Kept in its own table (not a
-- column on events) because any write to events bumps updated_at, which the
-- Google Calendar sync treats as a site-side edit.
create table if not exists event_spot_counts (
  event_id uuid primary key references events(id) on delete cascade,
  taken int not null default 0
);
alter table event_spot_counts enable row level security;

-- Recounts every occurrence of one series. A person (same first + last name,
-- ignoring case and spaces) counts once per class, however many times they
-- signed up; sign-ups in the Recycling Bin (including auto-detected
-- duplicate submissions) don't count. A Whole Series sign-up or event ticket
-- takes a spot in every occurrence; a Drop-In only in the date it picked.
create or replace function refresh_series_spot_counts(p_key text) returns void
language sql as $$
  insert into event_spot_counts (event_id, taken)
  select e.id, (
    select count(distinct lower(btrim(r.first_name)) || ' ' || lower(btrim(r.last_name)))
    from class_registrations r
    where r.series_key = p_key
      and r.deleted_at is null
      and (not r.is_drop_in or r.occurrence_event_id = e.id)
  )
  from events e
  where e.google_recurring_event_id = p_key or e.id::text = p_key
  on conflict (event_id) do update set taken = excluded.taken;
$$;

-- Any sign-up change (new, edited, deleted, restored) recounts its series.
create or replace function class_registrations_refresh_spots() returns trigger
language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.series_key is not null then
    perform refresh_series_spot_counts(old.series_key);
  end if;
  if tg_op = 'INSERT' and new.series_key is not null
     or tg_op = 'UPDATE' and new.series_key is distinct from old.series_key and new.series_key is not null then
    perform refresh_series_spot_counts(new.series_key);
  end if;
  return null;
end;
$$;

drop trigger if exists class_registrations_refresh_spots on class_registrations;
create trigger class_registrations_refresh_spots
  after insert or update or delete on class_registrations
  for each row execute function class_registrations_refresh_spots();

-- A new occurrence (e.g. a series pulled in from Google) starts with its
-- series' existing Whole Series sign-ups already counted.
create or replace function events_refresh_spots() returns trigger
language plpgsql as $$
begin
  perform refresh_series_spot_counts(coalesce(new.google_recurring_event_id, new.id::text));
  return null;
end;
$$;

drop trigger if exists events_refresh_spots on events;
create trigger events_refresh_spots
  after insert on events
  for each row execute function events_refresh_spots();

-- Fill the cache for every series that already has sign-ups.
select refresh_series_spot_counts(k)
from (select distinct series_key as k from class_registrations where series_key is not null) s;
