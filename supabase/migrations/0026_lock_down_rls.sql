-- Run this in the Supabase SQL editor after 0001-0025.
--
-- Pre-launch security hardening: every table the app talks to is read and
-- written exclusively through server-side API routes using the service-role
-- key (confirmed by grep — no page ever queries these via the anon/browser
-- client), so enabling RLS with zero policies costs nothing functionally
-- but closes off direct access to Supabase's auto-generated REST API using
-- the public anon key, which is embedded in the client bundle by design.
--
-- 0001/0003/0019 already did this for intake_submissions, events, and
-- admin_google_tokens, and deletion_audit. This migration catches every
-- table added since then that missed it — class_checkins in particular
-- holds attendee names and phone numbers.

alter table site_settings enable row level security;
alter table api_usage_daily enable row level security;
alter table class_checkins enable row level security;
alter table site_banner enable row level security;
alter table edit_locks enable row level security;
alter table homepage_content enable row level security;
alter table faqs enable row level security;
