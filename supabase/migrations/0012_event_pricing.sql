-- Run this in the Supabase SQL editor after 0001-0011.

alter table events add column if not exists price_whole_series numeric;
alter table events add column if not exists price_drop_in numeric;
alter table events add column if not exists price_student numeric;
