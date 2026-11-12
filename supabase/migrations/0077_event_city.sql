-- The city a class is held in, so pages can name it when it isn't the home
-- city ("Santa Fe"). Filled by the editor from the venue it looks up; null
-- when unknown (nothing extra is shown).
alter table events add column if not exists city text;
alter table events add column if not exists state text;

-- Existing classes with a venue were all held in the current home city.
-- Backfill without bumping updated_at (0003's trigger): the calendar sync
-- would read a bumped row as "newer than Google" and overwrite Google edits.
alter table events disable trigger events_set_updated_at;
update events
set city = coalesce((select home_city from site_config where id), 'Madison'),
    state = coalesce((select home_state from site_config where id), 'WI')
where city is null and location is not null and btrim(location) <> '';
alter table events enable trigger events_set_updated_at;
