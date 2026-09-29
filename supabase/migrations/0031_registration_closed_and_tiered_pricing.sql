-- Run this in the Supabase SQL editor after 0001-0030.

-- Registration-closed flag, per event/series (mirrors intake_submissions.paid's pattern).
alter table events add column if not exists registration_closed boolean not null default false;

-- Early bird / flash sale pricing tiers. One shared expiration per row,
-- independent optional sub-prices per price type (whole/drop-in/student).
alter table events add column if not exists price_whole_series_early_bird numeric;
alter table events add column if not exists price_drop_in_early_bird numeric;
alter table events add column if not exists price_student_early_bird numeric;
alter table events add column if not exists early_bird_until timestamptz;

alter table events add column if not exists price_whole_series_flash_sale numeric;
alter table events add column if not exists price_drop_in_flash_sale numeric;
alter table events add column if not exists price_student_flash_sale numeric;
alter table events add column if not exists flash_sale_until timestamptz;

-- Which price tier was actually active when a registration was recorded.
alter table class_registrations add column if not exists price_tier text
  check (price_tier in ('regular', 'early_bird', 'flash_sale'));

-- Drop-in registrations now carry the specific occurrence the dancer chose,
-- instead of being guessed as "the series' last occurrence" at read time.
alter table class_registrations add column if not exists occurrence_event_id uuid
  references events(id) on delete set null;
alter table class_registrations add column if not exists is_drop_in boolean not null default false;
