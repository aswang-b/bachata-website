-- Run this in the Supabase SQL editor after 0001-0074, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- Where we are (Admin → Admin → Where we are): the city and state shown on
-- the homepage, in page titles and search results, and in the structured data
-- search engines read, plus an optional short note for the homepage
-- ("Santa Fe all February"). Empty city means Madison, WI, as before.
-- On the single site_config row (0051), read on its own (lib/siteConfig.ts)
-- so the time zone and WhatsApp link still load before this runs.

alter table site_config
  add column if not exists home_city text,
  add column if not exists home_state text,
  add column if not exists location_note text;
