-- Run this in the Supabase SQL editor after 0001-0037, BEFORE deploying the
-- code that reads these columns (the dancer dashboard and attendance data
-- filter on them).
--
-- Soft delete for the dancer dashboard's Recycling Bin. Deleting a sign-up,
-- one dancer of a group sign-up, a single class registration, or a check-in
-- flags its rows instead of removing them: deleted_at is the flag, and every
-- row flagged by the same delete shares one deletion_id so a restore can
-- clear exactly that group. Emptying the bin hard-deletes everything flagged.
-- (One dancer of a group sign-up is flagged inside intake_submissions.dancers
-- with the same fields, since that dancer isn't a row of its own.)

alter table intake_submissions add column if not exists deleted_at timestamptz;
alter table intake_submissions add column if not exists deleted_by text;
alter table intake_submissions add column if not exists deletion_id uuid;

alter table class_registrations add column if not exists deleted_at timestamptz;
alter table class_registrations add column if not exists deleted_by text;
alter table class_registrations add column if not exists deletion_id uuid;

alter table class_checkins add column if not exists deleted_at timestamptz;
alter table class_checkins add column if not exists deleted_by text;
alter table class_checkins add column if not exists deletion_id uuid;

-- The bin lists (and empties) only flagged rows, so index just those.
create index if not exists intake_submissions_deleted_idx on intake_submissions (deletion_id) where deleted_at is not null;
create index if not exists class_registrations_deleted_idx on class_registrations (deletion_id) where deleted_at is not null;
create index if not exists class_checkins_deleted_idx on class_checkins (deletion_id) where deleted_at is not null;
