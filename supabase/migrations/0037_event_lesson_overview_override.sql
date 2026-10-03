-- Run this in the Supabase SQL editor after 0001-0036, BEFORE deploying the
-- code that reads these columns (the homepage and calendar sync select them).
-- Per-event/series override of the homepage card's "About This Class Format"
-- section: a custom header and/or body (rich HTML), and a switch that removes
-- the section from that card entirely. NULL title/body = use the default
-- header and the site-wide lesson overview text.

alter table events add column if not exists lesson_overview_title text;
alter table events add column if not exists lesson_overview_body text;
alter table events add column if not exists hide_lesson_overview boolean not null default false;
