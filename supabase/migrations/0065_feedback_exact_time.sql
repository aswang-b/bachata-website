-- Run this in the Supabase SQL editor after 0001-0064.
--
-- Feedback answers keep the exact time they came in (0064 rounded it down to
-- the hour), for troubleshooting and analytics. Answers already saved keep
-- their rounded time.

alter table feedback_responses alter column created_at set default now();
