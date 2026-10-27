-- Run this in the Supabase SQL editor after 0001-0056, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- The homepage's "Past Classes & Events" gallery: flyer images an admin
-- uploads by hand (admin → Homepage), in the order shown. Files live in the
-- event-images bucket.

alter table homepage_content add column if not exists gallery_flyers text[] not null default '{}';
