-- Run this in the Supabase SQL editor after 0001-0062, BEFORE deploying the
-- code that reads these columns (the homepage, calendar and calendar sync
-- select them).
-- Per-event/series switches for whether the homepage shows when its early
-- bird / flash sale ends ("ends Nov 3" beside the price, and the end time in
-- its bubble). Off, the price just names the deal ("Early Bird").

alter table events add column if not exists show_early_bird_end boolean not null default true;
alter table events add column if not exists show_flash_sale_end boolean not null default true;
