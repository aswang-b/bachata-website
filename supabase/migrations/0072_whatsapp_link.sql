-- Run this in the Supabase SQL editor after 0001-0071, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- The WhatsApp community link (Admin → Admin → WhatsApp Community): the
-- footer's WhatsApp icon and the "Join Our WhatsApp Community" button on
-- dancer confirmations (pages and email) open it. Empty hides them both.
-- On the single site_config row (0051), read on its own (lib/siteConfig.ts)
-- so the time zone still loads before this runs.

alter table site_config add column if not exists whatsapp_url text;
