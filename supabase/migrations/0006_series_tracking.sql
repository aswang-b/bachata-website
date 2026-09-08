-- Run this in the Supabase SQL editor after 0001-0005.

alter table events add column if not exists google_recurring_event_id text;
