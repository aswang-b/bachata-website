-- Run this in the Supabase SQL editor after 0001-0055, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- An admin's own wording for a deal's note on the homepage card. Null shows
-- the default ("<name>: Both for $120, applied automatically when you register.").

alter table deals add column if not exists homepage_text text;
