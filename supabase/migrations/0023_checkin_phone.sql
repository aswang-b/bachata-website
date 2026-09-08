-- Run this in the Supabase SQL editor after 0001-0022.
--
-- The check-in form now collects Phone instead of Email. Email is kept
-- (nullable) so historical check-ins don't lose data, but is no longer
-- collected or required going forward.

alter table class_checkins add column if not exists phone text;
alter table class_checkins alter column email drop not null;
