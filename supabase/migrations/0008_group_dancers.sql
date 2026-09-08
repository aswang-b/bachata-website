-- Run this in the Supabase SQL editor after 0001-0007.

alter table intake_submissions add column if not exists dancers jsonb;

-- Group registrations now collect contact info per-dancer, and phone/email
-- are optional per dancer, so a submission may have no top-level email at all.
alter table intake_submissions alter column email drop not null;
