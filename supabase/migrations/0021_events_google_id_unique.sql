-- Run this in the Supabase SQL editor after 0001-0020.
--
-- Enforces that each Google Calendar event is represented by at most one
-- site row. Without this, a sync race or a leftover row pointing at a
-- deleted/regenerated Google event could silently accumulate duplicates
-- instead of being caught — this is what let a standalone leftover event
-- and a real recurring series both claim the same class slot. Partial index
-- (google_event_id is not null) because site-created rows start out with a
-- null google_event_id before their first push to Google.

create unique index if not exists events_google_event_id_key on events (google_event_id) where google_event_id is not null;
