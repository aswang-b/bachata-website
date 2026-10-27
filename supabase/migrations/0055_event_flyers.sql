-- Run this in the Supabase SQL editor after 0001-0054, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- The uncropped flyer advertising a class or event (stored in the existing
-- event-images bucket). Separate from image_url, which is the cropped 16:3
-- homepage banner. Classes advertised on the same flyer share one URL, and the
-- flyer homepage groups them into one block by it.

alter table events add column if not exists flyer_url text;
