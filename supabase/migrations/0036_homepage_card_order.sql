-- Run this in the Supabase SQL editor after 0001-0035.
-- Admin-chosen order of the homepage offering cards, stored as an ordered JSON
-- array of series keys (google_recurring_event_id ?? id). Empty = the default
-- order (soonest first). Keys for classes that have passed are simply ignored,
-- and classes not in the list appear after the ordered ones. Until this runs,
-- the homepage keeps using the default order.

alter table homepage_content
  add column if not exists card_order jsonb not null default '[]'::jsonb;
