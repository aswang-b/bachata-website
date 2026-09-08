-- Run this in the Supabase SQL editor after 0001-0004.

alter table events add column if not exists visibility text not null default 'public';
alter table events add constraint events_visibility_check check (visibility in ('public', 'private'));

-- google_event_id is unique across the whole table today, but the same id
-- could theoretically collide across two different calendars. Scope
-- uniqueness to (visibility, google_event_id) instead.
drop index if exists events_google_event_id_idx;
create unique index if not exists events_visibility_google_event_id_idx
  on events (visibility, google_event_id)
  where google_event_id is not null;
