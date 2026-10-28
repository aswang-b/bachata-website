-- Run this in the Supabase SQL editor after 0059.

-- The end-to-end suite's classes and events are saved with visibility 'test':
-- only its own dev server lists them (src/lib/testMode.ts), so a test run
-- never shows on the live site, and the Google Calendar sync (which reads
-- only 'public' and 'private') never touches them.
alter table events drop constraint if exists events_visibility_check;
alter table events add constraint events_visibility_check check (visibility in ('public', 'private', 'test'));
