-- Run this in the Supabase SQL editor after 0001-0041.
-- Admin-chosen order of the homepage's two card sections ("Upcoming Events"
-- and the classes' "Current Lesson Offerings"), stored as an ordered JSON array
-- of 'events' / 'classes'. Empty = the default order (events first). Until this
-- runs, the homepage keeps using the default order and saving a section order
-- fails.

alter table homepage_content
  add column if not exists section_order jsonb not null default '[]'::jsonb;
