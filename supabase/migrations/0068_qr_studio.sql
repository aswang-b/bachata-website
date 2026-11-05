-- Run this in the Supabase SQL editor after 0001-0067, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- Admin → QR Codes (/admin/qr): which short link and branded code on
-- qr.dancewithb.fun the door sign uses, where it was last pointed, and the
-- Venmo accounts it can show (Dance with B and artists looked up for collabs).
-- One JSON value on the single site_config row (0051); server only, like it.

alter table site_config add column if not exists qr_studio jsonb not null default '{}'::jsonb;
