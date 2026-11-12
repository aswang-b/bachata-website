-- Run this in the Supabase SQL editor after 0001-0075, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- Each class keeps its own time zone: the zone its date and times were typed
-- in (an IANA id such as 'America/Denver'). A class is shown in its own zone,
-- so changing the site's time zone (0051) no longer moves classes already
-- scheduled, and a class in another city shows that city's time.
--  * Every existing class gets the site's current zone (Central if unset).
--  * A new row without a zone gets the site's zone at that moment, whatever
--    inserts it (the editor, the Google Calendar sync, tests).

alter table events add column if not exists time_zone text;

-- Backfill without bumping updated_at (0003's trigger): the calendar sync
-- would read a bumped row as "newer than Google" and overwrite Google edits.
alter table events disable trigger events_set_updated_at;
update events
set time_zone = coalesce((select time_zone from site_config where id), 'America/Chicago')
where time_zone is null;
alter table events enable trigger events_set_updated_at;

create or replace function events_default_time_zone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.time_zone is null then
    new.time_zone := coalesce((select time_zone from site_config where id), 'America/Chicago');
  end if;
  return new;
end;
$$;

drop trigger if exists events_default_time_zone on events;
create trigger events_default_time_zone
  before insert on events
  for each row execute function events_default_time_zone();
