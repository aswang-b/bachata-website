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
